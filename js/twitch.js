// Cliente EventSub de Twitch para recibir cheers de forma oficial.
// Se adapta del patron ya usado en goal-overlay (js/twitch.js).
import { TWITCH_CLIENT_ID, TWITCH_OAUTH_BASE, SUPABASE_KEY } from './config.js';

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENT_SUB_WS = 'wss://eventsub.wss.twitch.tv/ws';
// Si el Edge Function no entrega el token en este tiempo, se aborta y reintenta.
const TOKEN_TIMEOUT_MS = 10000;
// Margen extra sobre el keepalive antes de dar la conexion por muerta
// (cubre el throttle de timers de OBS con la fuente oculta).
const WATCHDOG_MARGIN_S = 10;
// Intentos de resolver un 409 por sesion antes de esperar al proximo reconectar.
const CONFLICT_ATTEMPTS = 3;

// ---- Token: obtenido del Edge Function (maneja refresh server-side) ----
export async function getAccessToken(broadcasterId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
    try {
        const res = await fetch(`${TWITCH_OAUTH_BASE}/token?broadcaster_id=${encodeURIComponent(broadcasterId)}`, {
            headers: {
                Authorization: `Bearer ${SUPABASE_KEY}`,
            },
            signal: controller.signal,
        });
        if (res.status === 401) {
            throw new Error('token_expired');
        }
        if (!res.ok) {
            throw new Error(`token request failed (${res.status})`);
        }
        const data = await res.json();
        return data.access_token;
    } finally {
        clearTimeout(timer);
    }
}

// ---- EventSub WebSocket client para canal.cheer ----
export class EventSubClient {
    constructor(broadcasterId, onCheer, onAffiliateRequired, options = {}) {
        this.broadcasterId = broadcasterId;
        this.onCheer = onCheer;
        this.onAffiliateRequired = onAffiliateRequired;
        // Dependencias inyectables para pruebas; en produccion son las globales.
        this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
        this.wsImpl = options.wsImpl ?? WebSocket;
        this.getToken = options.getToken ?? ((id) => getAccessToken(id));
        this.ws = null;
        this.sessionId = null;
        this.reconnectTimer = null;
        this.subscribed = false;
        this.seenMessageIds = new Set();
        this.accessToken = null;
        this.affiliateRequired = false;
        this.keepaliveSeconds = null;
        this.watchdogTimer = null;
        this.lastTrafficSocket = null;
        // session_reconnect: socket viejo que se esta retirando y socket nuevo
        // pendiente de su mensaje welcome.
        this.retiringSocket = null;
        this.pendingSocket = null;
        this.reconnectBaseMs = 3000;
        this.conflictAttempts = 0;
    }

    connect(accessToken) {
        this.accessToken = accessToken;
        this.openSocket(EVENT_SUB_WS);
    }

    openSocket(url) {
        const ws = new this.wsImpl(url);
        ws.onopen = () => {
            console.log('[eventsub] websocket opened', url);
            // El watchdog arranca desde la apertura: un socket que nunca recibe
            // su session_welcome tambien debe terminar reconectando.
            this.armWatchdog();
        };
        ws.onmessage = (event) => {
            this.noteTraffic(ws);
            try {
                this.handleMessage(JSON.parse(event.data), ws);
            } catch (e) {
                console.warn('[eventsub] failed to parse message', e);
            }
        };
        ws.onclose = this.makeCloseHandler(ws);
        ws.onerror = (e) => {
            console.warn('[eventsub] websocket error', e);
        };
        this.ws = ws;
    }

    makeCloseHandler(ws) {
        return (ev) => {
            // Un cierre tardio de un socket ya reemplazado no debe tumbar el actual.
            if (this.ws !== ws) return;
            const swapping = this.retiringSocket === ws && this.pendingSocket;
            this.clearWatchdog();
            this.ws = null;
            this.sessionId = null;
            this.subscribed = false;
            this.lastTrafficSocket = null;
            if (swapping) {
                // El socket viejo murio a mitad del swap de session_reconnect:
                // descartar el pendiente y reconectar desde cero.
                const pending = this.pendingSocket;
                this.pendingSocket = null;
                this.retiringSocket = null;
                if (pending) {
                    try { pending.onclose = null; } catch (e) {}
                    try { pending.close(); } catch (e) {}
                }
            }
            console.log('[eventsub] websocket closed', ev && ev.code);
            if (this.affiliateRequired) {
                console.log('[eventsub] affiliate required, stopping reconnect loop');
                return;
            }
            this.scheduleReconnect();
        };
    }

    handleMessage(msg, ws) {
        const { metadata, payload } = msg;
        const type = metadata && metadata.message_type;

        switch (type) {
            case 'session_welcome': {
                const session = payload && payload.session;
                if (!session || !session.id) break;
                this.sessionId = session.id;
                if (Number.isFinite(session.keepalive_timeout_seconds)) {
                    this.keepaliveSeconds = session.keepalive_timeout_seconds;
                }
                this.armWatchdog();
                if (ws === this.pendingSocket) {
                    // Twitch arrastra las suscripciones del socket viejo al
                    // nuevo: completar el swap sin volver a suscribir.
                    this.completeReconnectSwap(ws);
                } else {
                    this.conflictAttempts = 0;
                    this.subscribe();
                }
                break;
            }
            case 'session_keepalive':
                break;
            case 'notification': {
                const sub = payload && payload.subscription;
                const event = payload && payload.event;
                const messageId = metadata && metadata.message_id;

                if (messageId && this.seenMessageIds.has(messageId)) {
                    return;
                }
                if (messageId) {
                    this.seenMessageIds.add(messageId);
                    if (this.seenMessageIds.size > 1000) {
                        this.seenMessageIds.clear();
                    }
                }

                if (sub && sub.type === 'channel.cheer' && event) {
                    this.onCheer(event);
                }
                break;
            }
            case 'session_reconnect': {
                const reconnectUrl = payload && payload.session && payload.session.reconnect_url;
                if (reconnectUrl) {
                    this.beginReconnectSwap(reconnectUrl);
                } else {
                    this.scheduleReconnect();
                }
                break;
            }
            case 'websocket_disconnect': {
                const w = payload && payload.websocket;
                console.warn('[eventsub] server disconnect', w && w.code, w && w.disconnect_reason);
                break;
            }
            case 'revocation': {
                console.warn('[eventsub] subscription revoked');
                this.subscribed = false;
                break;
            }
        }
    }

    beginReconnectSwap(url) {
        if (this.pendingSocket) return;
        this.retiringSocket = this.ws;
        const pending = new this.wsImpl(url);
        this.pendingSocket = pending;
        console.log('[eventsub] reconnect requested; opening new socket before closing old one');
        pending.onopen = () => {
            console.log('[eventsub] reconnect socket opened');
            this.armWatchdog();
        };
        pending.onmessage = (event) => {
            this.noteTraffic(pending);
            try {
                this.handleMessage(JSON.parse(event.data), pending);
            } catch (e) {
                console.warn('[eventsub] parse error', e);
            }
        };
        pending.onclose = () => {
            if (this.pendingSocket !== pending) return;
            // El socket nuevo murio antes de su welcome: el viejo sigue vivo y
            // recibiendo; cuando Twitch lo cierre, su onclose reactiva el ciclo.
            console.warn('[eventsub] reconnect socket failed before welcome');
            this.pendingSocket = null;
            this.retiringSocket = null;
        };
        pending.onerror = (e) => {
            console.warn('[eventsub] reconnect ws error', e);
        };
    }

    completeReconnectSwap(pending) {
        const retiring = this.retiringSocket;
        this.pendingSocket = null;
        this.retiringSocket = null;
        this.ws = pending;
        // A partir de aqui el socket nuevo es el autoritativo: su cierre debe
        // seguir el camino normal de reconexion, no el del swap.
        pending.onclose = this.makeCloseHandler(pending);
        console.log('[eventsub] reconnect swap complete, session:', this.sessionId);
        if (retiring && retiring !== pending) {
            try { retiring.close(); } catch (e) {}
        }
    }

    async subscribe() {
        if (this.subscribed || !this.sessionId || !this.accessToken || !this.ws) return;
        const headers = {
            Authorization: `Bearer ${this.accessToken}`,
            'Client-Id': TWITCH_CLIENT_ID,
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify({
            type: 'channel.cheer',
            version: '1',
            condition: { broadcaster_user_id: this.broadcasterId },
            transport: { method: 'websocket', session_id: this.sessionId },
        });
        console.log('[eventsub] subscribe', { broadcasterId: this.broadcasterId, sessionId: this.sessionId });
        try {
            const res = await this.fetchImpl(`${TWITCH_API}/eventsub/subscriptions`, {
                method: 'POST',
                headers,
                body,
            });
            if (res.ok) {
                console.log('[eventsub] subscribed to channel.cheer');
                this.subscribed = true;
                this.reconnectBaseMs = 3000;
                return;
            }
            if (res.status === 409) {
                // Ya existe una suscripcion channel.cheer para el canal: puede
                // ser un duplicado de este socket o de otro (p.ej. una pestana
                // vieja del overlay). Solo en el segundo caso hay que borrarla
                // y re-suscribir para que ESTE socket reciba los cheers.
                const mine = await this.reconcileConflict(headers);
                if (mine) {
                    this.subscribed = true;
                    return;
                }
                this.conflictAttempts += 1;
                if (this.conflictAttempts >= CONFLICT_ATTEMPTS) {
                    console.warn('[eventsub] 409 persiste tras ' + CONFLICT_ATTEMPTS + ' intentos; esperando reconexion');
                    return;
                }
                return this.subscribe();
            }
            const text = await res.text();
            let errorMessage = '';
            try {
                errorMessage = JSON.parse(text)?.message || text;
            } catch (e) {
                errorMessage = text;
            }
            console.warn('[eventsub] subscribe failed', res.status, errorMessage, { broadcasterId: this.broadcasterId });
            if (res.status === 403 && /affiliate|partner/i.test(errorMessage)) {
                this.affiliateRequired = true;
                this.onAffiliateRequired?.();
            } else if (res.status === 403) {
                // 403 de autorizacion/token: no es permanente ni de afiliado;
                // reintentar despacio en vez de morir para siempre.
                console.warn('[eventsub] 403 no es por afiliado/partner; se reintentara despacio');
                this.reconnectBaseMs = 30000;
            }
        } catch (e) {
            console.warn('[eventsub] subscribe error', e);
        }
    }

    async reconcileConflict(headers) {
        try {
            const res = await this.fetchImpl(
                `${TWITCH_API}/eventsub/subscriptions?type=channel.cheer&status=enabled`,
                { method: 'GET', headers },
            );
            if (!res.ok) {
                console.warn('[eventsub] could not list subscriptions', res.status);
                return false;
            }
            const data = await res.json();
            const ours = (data.data || []).filter((s) =>
                s.type === 'channel.cheer' &&
                s.condition &&
                s.condition.broadcaster_user_id === this.broadcasterId);
            if (!ours.length) {
                // El conflicto ya no existe (Twitch lo recolecto): reintentar el POST.
                return false;
            }
            if (ours.some((s) => s.transport && s.transport.session_id === this.sessionId)) {
                console.log('[eventsub] 409 era de este mismo socket; nada que hacer');
                return true;
            }
            for (const s of ours) {
                // OTRA instancia (pestana del overlay o fuente de OBS duplicada)
                // tenia la suscripcion. Se borra para que ESTE overlay reciba los
                // cheers; si el aviso se repite, hay que cerrar la otra instancia.
                console.warn('[eventsub] suscripcion channel.cheer de OTRA sesion (' + s.id + '): borrando; cierra la otra instancia del overlay si esto se repite');
                await this.fetchImpl(`${TWITCH_API}/eventsub/subscriptions?id=${s.id}`, {
                    method: 'DELETE',
                    headers,
                });
            }
            return false;
        } catch (e) {
            console.warn('[eventsub] reconcile error', e);
            return false;
        }
    }

    scheduleReconnect(delayMs) {
        if (this.reconnectTimer) return;
        const delay = delayMs ?? this.reconnectBaseMs;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                const token = await this.getToken(this.broadcasterId);
                this.accessToken = token;
                this.openSocket(EVENT_SUB_WS);
            } catch (e) {
                console.warn('[eventsub] reconnect token failed', e);
                const msg = (e && e.message) || '';
                if (msg.includes('(404)') || msg.includes('no_token')) {
                    // Token revocado (logout real): nada mas que hacer.
                    console.log('[eventsub] token revoked, stopping reconnect loop');
                    return;
                }
                this.scheduleReconnect(Math.min(delay * 2, 60000));
            }
        }, delay);
    }

    // ---- keepalive watchdog ----

    noteTraffic(ws) {
        // Solo el socket autoritativo (o el pendiente del swap) cuenta como
        // vida: un mensaje tardio de un socket retirado no debe rearmar el
        // watchdog ni desviar su victima.
        if (ws !== this.ws && ws !== this.pendingSocket) return;
        this.lastTrafficSocket = ws;
        this.armWatchdog();
    }

    armWatchdog() {
        if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
        const seconds = (this.keepaliveSeconds ?? 10) + WATCHDOG_MARGIN_S;
        this.watchdogTimer = setTimeout(() => {
            this.watchdogTimer = null;
            const victim = this.ws || this.lastTrafficSocket;
            if (!victim) return;
            console.warn('[eventsub] keepalive timeout (' + seconds + 's sin mensajes); reconectando');
            try { victim.close(); } catch (e) {}
        }, seconds * 1000);
    }

    clearWatchdog() {
        if (this.watchdogTimer) {
            clearTimeout(this.watchdogTimer);
            this.watchdogTimer = null;
        }
    }

    async disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.clearWatchdog();
        const sockets = [this.ws, this.pendingSocket, this.retiringSocket];
        this.ws = null;
        this.pendingSocket = null;
        this.retiringSocket = null;
        this.lastTrafficSocket = null;
        this.sessionId = null;
        this.subscribed = false;
        this.affiliateRequired = false;
        for (const s of sockets) {
            if (!s) continue;
            try { s.onclose = null; } catch (e) {}
            try { s.close(); } catch (e) {}
        }
    }
}

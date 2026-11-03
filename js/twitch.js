// Cliente EventSub de Twitch para recibir cheers de forma oficial.
// Se adapta del patron ya usado en goal-overlay (js/twitch.js).
import { TWITCH_CLIENT_ID, TWITCH_OAUTH_BASE, SUPABASE_KEY } from './config.js';

const TWITCH_API = 'https://api.twitch.tv/helix';
const EVENT_SUB_WS = 'wss://eventsub.wss.twitch.tv/ws';

// ---- Token: obtenido del Edge Function (maneja refresh server-side) ----
export async function getAccessToken(broadcasterId) {
    console.log('[eventsub] getAccessToken', { broadcasterId });
    const res = await fetch(`${TWITCH_OAUTH_BASE}/token?broadcaster_id=${encodeURIComponent(broadcasterId)}`, {
        headers: {
            Authorization: `Bearer ${SUPABASE_KEY}`,
        },
    });
    if (res.status === 401) {
        throw new Error('token_expired');
    }
    if (!res.ok) {
        throw new Error(`token request failed (${res.status})`);
    }
    const data = await res.json();
    return data.access_token;
}

// ---- EventSub WebSocket client para canal.cheer ----
export class EventSubClient {
    constructor(broadcasterId, onCheer, onAffiliateRequired) {
        this.broadcasterId = broadcasterId;
        this.onCheer = onCheer;
        this.onAffiliateRequired = onAffiliateRequired;
        this.ws = null;
        this.sessionId = null;
        this.reconnectTimer = null;
        this.subscribed = false;
        this.seenMessageIds = new Set();
        this.accessToken = null;
        this.affiliateRequired = false;
        this.subscriptionFailed = false;
    }

    async connect(accessToken) {
        this.accessToken = accessToken;
        this.ws = new WebSocket(EVENT_SUB_WS);

        this.ws.onopen = () => {
            console.log('[eventsub] websocket opened');
        };

        this.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                this.handleMessage(msg);
            } catch (e) {
                console.warn('[eventsub] failed to parse message', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[eventsub] websocket closed');
            this.ws = null;
            this.sessionId = null;
            this.subscribed = false;
            if (this.affiliateRequired) {
                console.log('[eventsub] affiliate required, stopping reconnect loop');
                return;
            }
            if (this.subscriptionFailed) {
                console.log('[eventsub] subscription failed permanently, stopping reconnect loop');
                return;
            }
            this.scheduleReconnect();
        };

        this.ws.onerror = (e) => {
            console.warn('[eventsub] websocket error', e);
        };
    }

    handleMessage(msg) {
        const { metadata, payload } = msg;
        const type = metadata && metadata.message_type;

        switch (type) {
            case 'session_welcome': {
                const session = payload && payload.session;
                if (session && session.id) {
                    this.sessionId = session.id;
                    console.log('[eventsub] welcome, session:', session.id);
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
                    this.reconnect(reconnectUrl);
                } else {
                    this.scheduleReconnect();
                }
                break;
            }
            case 'revocation': {
                console.warn('[eventsub] subscription revoked');
                this.subscribed = false;
                break;
            }
        }
    }

    async subscribe() {
        if (this.subscribed || !this.sessionId || !this.accessToken) return;
        const body = {
            type: 'channel.cheer',
            version: '1',
            condition: { broadcaster_user_id: this.broadcasterId },
            transport: { method: 'websocket', session_id: this.sessionId },
        };
        console.log('[eventsub] subscribe', { broadcasterId: this.broadcasterId, body });
        try {
            // Check for existing subscriptions to avoid conflicts
            const existingRes = await fetch(`${TWITCH_API}/eventsub/subscriptions`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Client-Id': TWITCH_CLIENT_ID,
                },
            });
            if (existingRes.ok) {
                const existing = await existingRes.json();
                const existingCheer = existing.data?.find((s) => s.type === 'channel.cheer' && s.status === 'enabled');
                if (existingCheer) {
                    console.log('[eventsub] existing channel.cheer subscription found, reusing', { id: existingCheer.id });
                    this.subscribed = true;
                    return;
                }
            }
            const validateRes = await fetch('https://id.twitch.tv/oauth2/validate', {
                headers: { Authorization: `Bearer ${this.accessToken}` },
            });
            if (validateRes.ok) {
                const tokenInfo = await validateRes.json();
                console.log('[eventsub] token info', {
                    broadcasterId: this.broadcasterId,
                    tokenUserId: tokenInfo.user_id,
                    tokenLogin: tokenInfo.login,
                    scopes: tokenInfo.scopes,
                    clientId: tokenInfo.client_id,
                });
            }
            const res = await fetch(`${TWITCH_API}/eventsub/subscriptions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Client-Id': TWITCH_CLIENT_ID,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });
            if (!res.ok) {
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
                    // 403 por falta de autorizacion/token/scope: no es un problema de afiliado.
                    console.warn('[eventsub] 403 no es por afiliado/partner; revisar token y scopes');
                    this.subscriptionFailed = true;
                }
                return;
            }
            const data = await res.json();
            console.log('[eventsub] subscribed to channel.cheer', data);
            this.subscribed = true;
        } catch (e) {
            console.warn('[eventsub] subscribe error', e);
        }
    }

    scheduleReconnect(delayMs = 3000) {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(async () => {
            this.reconnectTimer = null;
            try {
                const token = await getAccessToken(this.broadcasterId);
                this.connect(token);
            } catch (e) {
                console.warn('[eventsub] reconnect token failed', e);
                // Token was revoked (404) — stop reconnecting, nothing left to do.
                if (e?.message?.includes('(404)') || e?.message?.includes('no_token')) {
                    console.log('[eventsub] token revoked, stopping reconnect loop');
                    return;
                }
                this.scheduleReconnect(Math.min(delayMs * 2, 30000));
            }
        }, delayMs);
    }

    reconnect(url) {
        if (this.ws) {
            try { this.ws.close(); } catch (e) {}
        }
        this.ws = new WebSocket(url);
        this.ws.onopen = () => {
            console.log('[eventsub] reconnected');
            this.subscribed = false;
            this.subscribe();
        };
        this.ws.onmessage = (event) => {
            try {
                this.handleMessage(JSON.parse(event.data));
            } catch (e) { console.warn('[eventsub] parse error', e); }
        };
        this.ws.onclose = () => {
            this.ws = null;
            this.scheduleReconnect();
        };
        this.ws.onerror = (e) => {
            console.warn('[eventsub] reconnect ws error', e);
        };
    }

    async disconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            try { this.ws.close(); } catch (e) {}
        }
        this.ws = null;
        this.sessionId = null;
        this.subscribed = false;
        this.affiliateRequired = false;
        this.subscriptionFailed = false;
    }
}

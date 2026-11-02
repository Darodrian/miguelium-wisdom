// Versiones fijas de CDN: la sala usa Supabase Realtime, el chat lo escucha ComfyJS.
import { cfg } from './config.js';

const SUPA_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

const AMOUNT_PFX = 'mw_amount_';
const PREVIEW_MUTE_STORE = 'mw_preview_mute';

function storageGet(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, String(val)); } catch (e) { /* modo privado */ }
}

function norm(id) {
  return String(id || '').trim().toLowerCase();
}

// ---- monto (umbral de cheers) por broadcaster ----
function savedAmount(broadcasterId, def) {
  const raw = storageGet(AMOUNT_PFX + norm(broadcasterId), '');
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : (def || 100);
}
function saveAmount(broadcasterId, n) {
  storageSet(AMOUNT_PFX + norm(broadcasterId), Math.max(1, Math.floor(Number(n) || 100)));
}

// ---- mute del preview (estado solo del panel) ----
function savedPreviewMute() { return storageGet(PREVIEW_MUTE_STORE, '') === '1'; }
function savePreviewMute(v) { storageSet(PREVIEW_MUTE_STORE, v ? '1' : '0'); }

function configured() {
  return !!(cfg.supabaseUrl && cfg.supabaseKey);
}

// URL absoluta del overlay con el broadcaster_id en el query string.
function overlayUrl(broadcasterId) {
  const base = new URL('index.html', location.href);
  base.search = 'broadcaster_id=' + encodeURIComponent(broadcasterId);
  return base.href;
}

// ---- sala realtime (panel <-> overlay) ----
export function createBridge(room) {
  const handlers = { status: [], hello: [], ping: [], set: [], flip: [], test: [], disconnect: [] };
  let channel = null;
  let client = null;

  async function getClient() {
    if (!configured()) throw new Error('Falta configuracion de Supabase');
    if (!client) {
      const mod = await import(SUPA_URL);
      client = mod.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    }
    return client;
  }

  function listen(event, fn) {
    channel.on('broadcast', { event }, (msg) => fn((msg && msg.payload) || {}));
  }

  async function connect() {
    const c = await getClient();
    channel = c.channel(room, { config: { broadcast: { self: false } } });
    listen('hello', (p) => handlers.hello.forEach((h) => h(p)));
    listen('ping', (p) => handlers.ping.forEach((h) => h(p)));
    listen('set', (p) => handlers.set.forEach((h) => h(p)));
    listen('flip', (p) => handlers.flip.forEach((h) => h(p)));
    listen('test', (p) => handlers.test.forEach((h) => h(p)));
  listen('disconnect', (p) => handlers.disconnect.forEach((h) => h(p)));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(arg);
      };
      const timer = setTimeout(() => finish(reject, new Error('TIMED_OUT')), 15000);
      channel.subscribe((status) => {
        handlers.status.forEach((h) => h(status));
        if (status === 'SUBSCRIBED') finish(resolve);
        else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') finish(reject, new Error(status));
      });
    });
  }

  function send(type, payload) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: type, payload });
  }

  return {
    connect,
    async leave() {
      if (channel && client) await client.removeChannel(channel);
      channel = null;
    },
    sendHello() { send('hello', { at: Date.now() }); },
    sendPing() { send('ping', { at: Date.now() }); },
    sendSet(amount) { send('set', { amount: Math.max(1, Math.floor(Number(amount) || 100)) }); },
    sendFlip(flip) { send('flip', { flip: !!flip }); },
    sendTest() { send('test', { at: Date.now() }); },
    sendDisconnect() { send('disconnect', { at: Date.now() }); },
    onStatus(fn) { handlers.status.push(fn); },
    onHello(fn) { handlers.hello.push(fn); },
    onPing(fn) { handlers.ping.push(fn); },
    onSet(fn) { handlers.set.push(fn); },
    onFlip(fn) { handlers.flip.push(fn); },
    onTest(fn) { handlers.test.push(fn); },
    onDisconnect(fn) { handlers.disconnect.push(fn); },
  };
}

export {
  cfg, configured,
  savedAmount, saveAmount, overlayUrl,
  savedPreviewMute, savePreviewMute,
};
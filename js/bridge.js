// Versiones fijas de CDN: la sala usa Supabase Realtime, el chat lo escucha ComfyJS.
import { cfg } from './config.js';

const SUPA_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';

const CHANNEL_STORE = 'mw_channel';
const KEY_PFX = 'mw_key_';
const AMOUNT_PFX = 'mw_amount_';
const KEY_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

function storageGet(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : v; } catch (e) { return def; }
}
function storageSet(key, val) {
  try { localStorage.setItem(key, String(val)); } catch (e) { /* modo privado */ }
}

function hashParam(name) {
  return String(new URLSearchParams(location.hash.slice(1)).get(name) || '').trim();
}

// Los canales de Twitch son insensibles a mayusculas: normaliza para que
// 'MiCan' en el panel y 'mican' en la URL compartan clave y monto guardados.
function norm(channel) {
  return String(channel || '').trim().toLowerCase();
}

// ---- canal ----
function savedChannel() { return norm(storageGet(CHANNEL_STORE, '')); }
function saveChannel(v) { storageSet(CHANNEL_STORE, norm(v)); }
// El overlay lee el canal de la URL; el panel lo guarda por instalacion.
function overlayChannel() { return hashParam('c').toLowerCase(); }
function overlayKey() { return hashParam('k'); }

// ---- clave por canal ----
function savedKey(channel) { return storageGet(KEY_PFX + norm(channel), ''); }
function saveKey(channel, v) { storageSet(KEY_PFX + norm(channel), v); }
function hasKey(channel) { return savedKey(channel).length > 0; }

function generateKey(len = 24) {
  const n = KEY_ALPHABET.length;
  const limit = 256 - (256 % n);
  const out = [];
  while (out.length < len) {
    const bytes = new Uint8Array(len * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) out.push(KEY_ALPHABET[b % n]);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

// ---- monto (redencion) por canal ----
function savedAmount(channel, def) {
  const raw = storageGet(AMOUNT_PFX + norm(channel), '');
  const n = Number(raw);
  return raw !== '' && Number.isFinite(n) && n > 0 ? Math.floor(n) : (def || 100);
}
function saveAmount(channel, n) {
  storageSet(AMOUNT_PFX + norm(channel), Math.max(1, Math.floor(Number(n) || 100)));
}

function configured() {
  return !!(cfg.supabaseUrl && cfg.supabaseKey);
}

// URL absoluta del overlay con el canal y la clave en el hash.
function overlayUrl(channel, key) {
  const base = new URL('index.html', location.href);
  base.hash = 'c=' + encodeURIComponent(norm(channel)) + '&k=' + encodeURIComponent(key);
  return base.href;
}

// ---- sala realtime (panel <-> overlay) ----
export function createBridge(room) {
  const handlers = { status: [], hello: [], ping: [], set: [], flip: [] };
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
    onStatus(fn) { handlers.status.push(fn); },
    onHello(fn) { handlers.hello.push(fn); },
    onPing(fn) { handlers.ping.push(fn); },
    onSet(fn) { handlers.set.push(fn); },
    onFlip(fn) { handlers.flip.push(fn); },
  };
}

export {
  cfg, configured,
  savedChannel, saveChannel, overlayChannel, overlayKey,
  savedKey, saveKey, hasKey, generateKey,
  savedAmount, saveAmount, overlayUrl,
};
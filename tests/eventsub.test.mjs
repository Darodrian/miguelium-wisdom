import test from 'node:test';
import assert from 'node:assert/strict';

import { EventSubClient, getAccessToken } from '../js/twitch.js';

// ---- helpers ----

const flush = () => new Promise((r) => setImmediate(r));
async function settle(n = 2) {
  for (let i = 0; i < n; i++) await flush();
}

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});

const WELCOME = (id, keepalive = 10) => ({
  metadata: {
    message_id: 'w-' + id,
    message_type: 'session_welcome',
    message_timestamp: '2026-01-01T00:00:00Z',
  },
  payload: {
    session: {
      id,
      status: 'connected',
      keepalive_timeout_seconds: keepalive,
      reconnect_url: null,
    },
  },
});

const KEEPALIVE = (id) => ({
  metadata: {
    message_id: 'k-' + id,
    message_type: 'session_keepalive',
    message_timestamp: '2026-01-01T00:00:00Z',
  },
  payload: {},
});

const CHEER = (msgId, bits = 100) => ({
  metadata: {
    message_id: msgId,
    message_type: 'notification',
    message_timestamp: '2026-01-01T00:00:00Z',
  },
  payload: {
    subscription: {
      id: 'sub-x',
      type: 'channel.cheer',
      version: '1',
      status: 'enabled',
      condition: { broadcaster_user_id: 'B1' },
    },
    event: { user_name: 'viewer', user_id: '1', bits, message: 'cheer' },
  },
});

const FOLLOW = (msgId) => ({
  metadata: {
    message_id: msgId,
    message_type: 'notification',
    message_timestamp: '2026-01-01T00:00:00Z',
  },
  payload: {
    subscription: {
      id: 'sub-y',
      type: 'channel.follow',
      version: '2',
      status: 'enabled',
      condition: { broadcaster_user_id: 'B1', moderator_user_id: 'B1' },
    },
    event: { user_name: 'viewer', user_id: '1' },
  },
});

const RECONNECT_MSG = (url) => ({
  metadata: {
    message_id: 'r-1',
    message_type: 'session_reconnect',
    message_timestamp: '2026-01-01T00:00:00Z',
  },
  payload: { session: { id: 's1', reconnect_url: url } },
});

class FakeWebSocket {
  static instances = [];
  static reset() { FakeWebSocket.instances = []; }
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    FakeWebSocket.instances.push(this);
  }
  open() { if (this.onopen) this.onopen(); }
  message(obj) { if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) }); }
  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.onclose) this.onclose({ code: 1000 });
  }
}

function makeClient({ onCheer = () => {} } = {}) {
  const calls = [];
  const responses = [];
  const getTokenCalls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected fetch: ' + url);
    return next;
  };
  const getToken = async (id) => {
    getTokenCalls.push(id);
    return 'tok-' + (getTokenCalls.length + 1);
  };
  const client = new EventSubClient('B1', onCheer, undefined, {
    fetchImpl,
    wsImpl: FakeWebSocket,
    getToken,
  });
  return { client, calls, responses, getTokenCalls };
}

const posts = (calls) =>
  calls.filter((c) => c.init.method === 'POST').map((c) => JSON.parse(c.init.body));

async function connectAndWelcome(client, responses, wsId = 's1', keepalive = 10) {
  responses.push(jsonResponse(201, { data: [{}] }));
  client.connect('tok');
  const ws = FakeWebSocket.instances.at(-1);
  ws.open();
  ws.message(WELCOME(wsId, keepalive));
  await settle();
  return ws;
}

// ---- tests ----

test('welcome suscribe channel.cheer para esta sesion y entrega cada cheer una vez', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const cheers = [];
  const { client, responses, calls } = makeClient({ onCheer: (e) => cheers.push(e) });
  try {
    const ws = await connectAndWelcome(client, responses);
    const bodies = posts(calls);
    assert.equal(bodies.length, 1, 'un solo POST de suscripcion');
    assert.equal(bodies[0].type, 'channel.cheer');
    assert.equal(bodies[0].version, '1');
    assert.equal(bodies[0].condition.broadcaster_user_id, 'B1');
    assert.equal(bodies[0].transport.method, 'websocket');
    assert.equal(bodies[0].transport.session_id, 's1');

    ws.message(CHEER('m1', 100));
    ws.message(CHEER('m1', 100)); // duplicado: mismo message_id
    ws.message(CHEER('m2', 100));
    ws.message(FOLLOW('m3')); // otro tipo de evento: ignorado
    ws.message({
      metadata: { message_id: 'd1', message_type: 'websocket_disconnect', message_timestamp: '2026-01-01T00:00:00Z' },
      payload: { websocket: { code: 4003, disconnect_reason: 'Connection unused' } },
    });
    await settle();
    assert.equal(cheers.length, 2, 'dos cheers distintos, sin duplicados ni eventos ajenos');
    assert.equal(cheers[0].bits, 100);
    assert.equal(cheers[0].user_name, 'viewer');
  } finally {
    client.disconnect();
  }
});

test('409 con suscripcion de esta misma sesion: se acepta sin borrar ni reintentar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, calls } = makeClient();
  try {
    responses.push(
      jsonResponse(409, { error: 'Conflict', status: 409, message: 'subscription already exists', id: 'sub-own' }),
      jsonResponse(200, {
        data: [{
          id: 'sub-own',
          type: 'channel.cheer',
          status: 'enabled',
          condition: { broadcaster_user_id: 'B1' },
          transport: { method: 'websocket', session_id: 's1' },
        }],
      }),
    );
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.message(WELCOME('s1'));
    await settle();
    assert.equal(posts(calls).length, 1, 'no re-POST para un duplicado propio');
    assert.ok(!calls.some((c) => c.init.method === 'DELETE'), 'no borra su propia suscripcion');
  } finally {
    client.disconnect();
  }
});

test('409 con suscripcion de OTRA sesion: la borra y re-suscribe para esta sesion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, calls } = makeClient();
  try {
    responses.push(
      jsonResponse(409, { error: 'Conflict', status: 409, message: 'subscription already exists', id: 'sub-old' }),
      jsonResponse(200, {
        data: [{
          id: 'sub-old',
          type: 'channel.cheer',
          status: 'enabled',
          condition: { broadcaster_user_id: 'B1' },
          transport: { method: 'websocket', session_id: 'OTHER' },
        }],
      }),
      jsonResponse(204, undefined),
      jsonResponse(201, { data: [{}] }),
    );
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.message(WELCOME('s1'));
    await settle();
    const bodies = posts(calls);
    assert.equal(bodies.length, 2, 're-intenta el POST despues de borrar la ajena');
    assert.equal(bodies[1].transport.session_id, 's1', 'la nueva suscripcion es de esta sesion');
    const del = calls.find((c) => c.init.method === 'DELETE');
    assert.ok(del, 'borra la suscripcion de la sesion ajena');
    assert.ok(del.url.includes('sub-old'), 'borra por id: ' + del.url);
  } finally {
    client.disconnect();
  }
});

test('409 cuando el conflicto ya desaparecio: reintenta el POST', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, calls } = makeClient();
  try {
    responses.push(
      jsonResponse(409, { error: 'Conflict', status: 409, message: 'subscription already exists' }),
      jsonResponse(200, { data: [] }),
      jsonResponse(201, { data: [{}] }),
    );
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.message(WELCOME('s1'));
    await settle();
    assert.equal(posts(calls).length, 2, 're-POST cuando el GET ya no ve conflicto');
    assert.ok(!calls.some((c) => c.init.method === 'DELETE'), 'nada que borrar');
  } finally {
    client.disconnect();
  }
});

test('409 persistente: se limita a 3 intentos por sesion antes de esperar reconexion', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, calls } = makeClient();
  try {
    for (let i = 0; i < 3; i++) {
      responses.push(
        jsonResponse(409, { error: 'Conflict', status: 409, message: 'subscription already exists' }),
        jsonResponse(200, {
          data: [{
            id: 'sub-' + i,
            type: 'channel.cheer',
            status: 'enabled',
            condition: { broadcaster_user_id: 'B1' },
            transport: { method: 'websocket', session_id: 'OTHER' },
          }],
        }),
        jsonResponse(204, undefined),
      );
    }
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.message(WELCOME('s1'));
    await settle();
    assert.equal(posts(calls).length, 3, 'no mas de 3 POST por ciclo');
    assert.equal(calls.length, 9, 'exactamente 3 ciclos POST+GET+DELETE');
  } finally {
    client.disconnect();
  }
});

test('session_reconnect: el socket viejo se cierra solo tras el welcome del nuevo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, calls } = makeClient();
  try {
    const ws1 = await connectAndWelcome(client, responses);
    ws1.message(RECONNECT_MSG('wss://eventsub.wss.twitch.tv/ws?reconnect=x'));
    await settle();
    const ws2 = FakeWebSocket.instances.at(-1);
    assert.equal(ws2.url, 'wss://eventsub.wss.twitch.tv/ws?reconnect=x');
    assert.equal(ws1.closed, false, 'no cierra el socket viejo antes del welcome del nuevo');
    assert.notEqual(ws2, ws1);

    ws2.open();
    ws2.message(WELCOME('s2'));
    await settle();
    assert.equal(ws1.closed, true, 'cierra el socket viejo tras el welcome');
    assert.equal(client.ws, ws2, 'el socket nuevo es el autoritativo');
    assert.equal(posts(calls).length, 1, 'no re-suscribe: las suscripciones se arrastran al socket nuevo');

    // El cierre (tardio) del socket viejo no debe tumbar al nuevo.
    ws1.onclose({ code: 1000 });
    assert.equal(client.ws, ws2, 'un cierre tardio del viejo no derriba al nuevo');
    assert.equal(FakeWebSocket.instances.length, 2, 'no spawnea sockets extra');
  } finally {
    client.disconnect();
  }
});

test('session_reconnect con socket nuevo muerto antes del welcome: el viejo sigue mandando', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const cheers = [];
  const { client, responses } = makeClient({ onCheer: (e) => cheers.push(e) });
  try {
    const ws1 = await connectAndWelcome(client, responses);
    ws1.message(RECONNECT_MSG('wss://eventsub.wss.twitch.tv/ws?reconnect=y'));
    await settle();
    const ws2 = FakeWebSocket.instances.at(-1);
    ws2.close(); // falla antes del welcome
    await settle();
    assert.equal(client.ws, ws1, 'el socket viejo sigue siendo el autoritativo');
    assert.equal(ws1.closed, false, 'el viejo sigue abierto');
    ws1.message(CHEER('mx', 100));
    await settle();
    assert.equal(cheers.length, 1, 'los cheers siguen llegando por el socket viejo');

    ws1.close(); // Twitch cierra el viejo a los ~30s
    await settle();
    t.mock.timers.tick(3000); // reconnect programado
    await settle();
    assert.equal(FakeWebSocket.instances.length, 3, 'abre socket nuevo tras la caida del viejo');
  } finally {
    client.disconnect();
  }
});

test('silencio mas alla del keepalive: el watchdog cierra el socket muerto y reconecta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses, getTokenCalls } = makeClient();
  try {
    const ws = await connectAndWelcome(client, responses, 's1', 10);
    t.mock.timers.tick(20000); // keepalive 10s + margen 10s
    assert.equal(ws.closed, true, 'el watchdog cierra el socket silencioso');
    t.mock.timers.tick(3000); // reconnect programado
    await settle();
    assert.equal(FakeWebSocket.instances.length, 2, 'abre un socket nuevo');
    assert.equal(getTokenCalls.length, 1, 'renueva el token para reconectar');
  } finally {
    client.disconnect();
  }
});

test('los keepalives rearman el watchdog y mantienen el socket vivo', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses } = makeClient();
  try {
    const ws = await connectAndWelcome(client, responses, 's1', 10);
    t.mock.timers.tick(15000);
    ws.message(KEEPALIVE('a'));
    t.mock.timers.tick(15000);
    assert.equal(ws.closed, false, 'un socket con trafico no se cierra');
  } finally {
    client.disconnect();
  }
});

test('403 generico no es permanente: reintenta despacio en vez de morir para siempre', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses } = makeClient();
  try {
    responses.push(
      jsonResponse(403, { error: 'Forbidden', status: 403, message: 'insufficient user permissions' }),
      jsonResponse(201, { data: [{}] }),
    );
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    ws.message(WELCOME('s1'));
    await settle();
    ws.close(); // Twitch cierra con 4003 al no haber suscripcion
    await settle();
    t.mock.timers.tick(30000); // reintento lento
    await settle();
    assert.equal(FakeWebSocket.instances.length, 2, 'reconecta tras el 403 generico');
  } finally {
    client.disconnect();
  }
});

test('socket que nunca recibe welcome: el watchdog lo cierra y reconecta', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client } = makeClient();
  try {
    client.connect('tok');
    const ws = FakeWebSocket.instances.at(-1);
    ws.open();
    await settle();
    t.mock.timers.tick(20000); // sin welcome: keepalive por defecto 10s + margen 10s
    assert.equal(ws.closed, true, 'el watchdog no depende de haber recibido mensajes');
    t.mock.timers.tick(3000);
    await settle();
    assert.equal(FakeWebSocket.instances.length, 2, 'reconecta sin welcome');
  } finally {
    client.disconnect();
  }
});

test('mensaje tardio del socket retirado no desvia el watchdog del socket actual', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  FakeWebSocket.reset();
  const { client, responses } = makeClient();
  try {
    const ws1 = await connectAndWelcome(client, responses);
    ws1.message(RECONNECT_MSG('wss://eventsub.wss.twitch.tv/ws?reconnect=z'));
    await settle();
    const ws2 = FakeWebSocket.instances.at(-1);
    ws2.open();
    ws2.message(WELCOME('s2'));
    await settle();
    assert.equal(client.ws, ws2, 'swap completado');

    ws1.message(CHEER('late', 100)); // mensaje tardio del socket ya retirado
    t.mock.timers.tick(20000); // el socket actual (ws2) queda en silencio
    assert.equal(ws2.closed, true, 'el watchdog cierra el socket actual, no el retirado');
    t.mock.timers.tick(3000);
    await settle();
    assert.equal(FakeWebSocket.instances.length, 3, 'reconecta tras cerrar el socket actual');
  } finally {
    client.disconnect();
  }
});

test('getAccessToken aborta la peticion de token que no responde', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal = null;
  t.mock.method(globalThis, 'fetch', (url, init) => {
    signal = init && init.signal;
    return new Promise((resolve, reject) => {
      if (signal) signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  });
  const pending = getAccessToken('123').then(
    () => 'resolved',
    (e) => 'rejected:' + e.message,
  );
  await settle();
  assert.ok(signal, 'la peticion de token debe llevar signal de aborto');
  t.mock.timers.tick(10001);
  await settle();
  assert.equal(await pending, 'rejected:aborted');
});

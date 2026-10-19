import test from 'node:test';
import assert from 'node:assert/strict';

import { forSpeech, perCharMs, schedulePacing } from '../js/speech.js';

test('forSpeech strips Spanish accents and maps ñ to n', () => {
  assert.equal(forSpeech('El niño comió piñata'), 'El nino comio pinata');
});

test('forSpeech turns ¿ and ¡ into ? and ! and keeps the length', () => {
  const s = '¿Qué dicen? ¡Ja!';
  assert.equal(forSpeech(s), '?Que dicen? !Ja!');
  assert.equal(forSpeech(s).length, s.length);
});

test('forSpeech keeps the length of every phrase in refranes.json', async () => {
  const { readFile } = await import('node:fs/promises');
  const refranes = JSON.parse(await readFile(new URL('../refranes.json', import.meta.url), 'utf8'));
  for (const r of refranes) assert.equal(forSpeech(r).length, r.length, r);
});

test('perCharMs divides the duration by the character count', () => {
  assert.equal(perCharMs(1000, 50), 20);
});

test('perCharMs clamps to the 18-140ms band and never divides by zero', () => {
  assert.equal(perCharMs(100, 50), 18);
  assert.equal(perCharMs(10000, 5), 140);
  assert.equal(perCharMs(1000, 0), 140);
});

test('schedulePacing paces to the reported audio duration', async () => {
  const calls = [];
  const cancel = schedulePacing({
    text: 'x'.repeat(50),
    speak: (text, opts) => { opts.onDuration(1000); return Promise.resolve(); },
    fallbackPerChar: 35,
    graceMs: 50,
    onPace: (ms) => calls.push(ms),
  });
  await new Promise((r) => setImmediate(r));
  cancel();
  assert.deepEqual(calls, [20]);
});

test('schedulePacing falls back to the fixed pace when speak rejects', async () => {
  const calls = [];
  const cancel = schedulePacing({
    text: 'hola',
    speak: () => Promise.reject(new Error('sin red')),
    fallbackPerChar: 35,
    graceMs: 50,
    onPace: (ms) => calls.push(ms),
  });
  await new Promise((r) => setImmediate(r));
  cancel();
  assert.deepEqual(calls, [35]);
});

test('schedulePacing falls back when speak never settles, then ignores a late answer', async () => {
  const calls = [];
  let opts;
  const cancel = schedulePacing({
    text: 'hola',
    speak: (text, o) => { opts = o; return new Promise(() => {}); },
    fallbackPerChar: 35,
    graceMs: 25,
    onPace: (ms) => calls.push(ms),
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(calls, [35]);
  opts.onDuration(1000);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, [35]);
  cancel();
});

test('cancel silences a speak that answers afterwards', async () => {
  const calls = [];
  let opts;
  const cancel = schedulePacing({
    text: 'hola',
    speak: (t, o) => { opts = o; return new Promise(() => {}); },
    fallbackPerChar: 35,
    graceMs: 1000,
    onPace: (ms) => calls.push(ms),
  });
  cancel();
  opts.onDuration(1000);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, []);
});

test('schedulePacing hands speak an isCancelled that flips with cancel', async () => {
  let opts;
  const cancel = schedulePacing({
    text: 'hola',
    speak: (t, o) => { opts = o; return new Promise(() => {}); },
    fallbackPerChar: 35,
    graceMs: 1000,
    onPace: () => {},
  });
  assert.equal(typeof opts.isCancelled, 'function');
  assert.equal(opts.isCancelled(), false);
  cancel();
  assert.equal(opts.isCancelled(), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('a late gesture still unlocks audio after the retry interval gives up', async () => {
  const listeners = new Set();
  let ctx;
  globalThis.window = {
    AudioContext: class {
      constructor() { ctx = this; this.state = 'suspended'; }
      async resume() { if (this.armed) this.state = 'running'; }
    },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  try {
    const { unlockAudio } = await import('../js/tts.js');
    await unlockAudio({ attempts: 1, intervalMs: 5 });
    await sleep(30); // el intervalo agoto sus reintentos
    assert.equal(ctx.state, 'suspended');

    // Un clic tardio del usuario (preview del dashboard) debe destrabar aun asi.
    ctx.armed = true;
    for (const fn of [...listeners]) fn();
    await sleep(20);

    assert.equal(ctx.state, 'running');
    assert.equal(listeners.size, 0);
  } finally {
    delete globalThis.window;
  }
});

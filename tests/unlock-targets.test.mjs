import test from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('gesture resumes registered playback contexts, not just the probe', async () => {
  const listeners = new Set();
  let armed = false;
  let probeCtx;

  globalThis.window = {
    AudioContext: class {
      constructor() { probeCtx = this; this.state = 'suspended'; }
      async resume() { if (armed) this.state = 'running'; }
    },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };

  try {
    const { unlockAudio, addPlaybackTarget } = await import('../js/tts.js');
    assert.equal(typeof addPlaybackTarget, 'function');

    await unlockAudio({ attempts: 1, intervalMs: 5 });

    // El contexto real del WebPlayer aparece en el primer speak, ya colgado:
    const playerCtx = {
      state: 'suspended',
      async resume() { if (armed) this.state = 'running'; },
    };
    addPlaybackTarget(playerCtx);

    await sleep(30); // el intervalo agota sus reintentos
    assert.equal(probeCtx.state, 'suspended');
    assert.equal(playerCtx.state, 'suspended');

    armed = true;
    for (const fn of [...listeners]) fn();
    await sleep(20);

    assert.equal(probeCtx.state, 'running');
    assert.equal(playerCtx.state, 'running');
    assert.equal(listeners.size, 0);
  } finally {
    delete globalThis.window;
  }
});

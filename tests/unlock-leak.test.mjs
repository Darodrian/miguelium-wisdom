import test from 'node:test';
import assert from 'node:assert/strict';

test('unlockAudio removes its gesture listeners once audio is running', async () => {
  const listeners = new Set();
  globalThis.window = {
    AudioContext: class { state = 'running'; async resume() {} },
    addEventListener: (type, fn) => listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
  };
  try {
    const { unlockAudio } = await import('../js/tts.js');
    const state = await unlockAudio();
    assert.equal(state, 'running');
    assert.equal(listeners.size, 0);
  } finally {
    delete globalThis.window;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

test('muted starts off and setMuted toggles it', async () => {
  const tts = await import('../js/tts.js');
  assert.equal(typeof tts.setMuted, 'function');
  assert.equal(typeof tts.isMuted, 'function');

  assert.equal(tts.isMuted(), false);

  tts.setMuted(true);
  assert.equal(tts.isMuted(), true);

  tts.setMuted('');
  assert.equal(tts.isMuted(), false);
});

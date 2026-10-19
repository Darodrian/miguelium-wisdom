import test from 'node:test';
import assert from 'node:assert/strict';

test('VoiceChain uses the injected PitchManager instead of a free variable', async () => {
  const { VoiceChain } = await import('../js/tts.js');
  assert.equal(typeof VoiceChain, 'function');

  let lastChain = null;
  class FakePitchManager {
    constructor(chain) { lastChain = chain; }
    calculatePitch(i) { return 100 + i; }
    apply(buffer, ratio) { buffer.ratio = ratio; return buffer; }
  }

  const chain = new VoiceChain(FakePitchManager);
  assert.equal(lastChain, chain);
  assert.equal(chain.calculatePitch(3), 103);

  // setVoice recrea el manager: tiene que usar el ctor inyectado, no una
  // referencia libre a PitchManager (ReferenceError en tiempo de carga).
  chain.setVoice({ pitch: 2, speed: 3, randomness: 0.2, melodyRate: 0.1, melodyAmplitude: 0.2 });
  assert.equal(chain.pitch, 2);
  assert.equal(chain.calculatePitch(7), 107);

  const buf = new Float32Array(4);
  assert.equal(chain.apply(buf, 1.5), buf);
  assert.equal(buf.ratio, 1.5);
});

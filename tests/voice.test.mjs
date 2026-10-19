import test from 'node:test';
import assert from 'node:assert/strict';

import { drawVoice, DEFAULT_PUNCTUATIONS } from '../js/voice.js';

test('drawVoice pitch spans the full demo range [0.5, 3.0]', () => {
  const draws = Array.from({ length: 600 }, () => drawVoice());
  for (const v of draws) {
    assert.ok(v.pitch >= 0.5 && v.pitch <= 3.0, `pitch ${v.pitch} outside demo range`);
  }
  const pitches = draws.map((v) => v.pitch);
  assert.ok(Math.min(...pitches) < 0.8, 'draws should reach deep voices');
  assert.ok(Math.max(...pitches) > 2.6, 'draws should reach high voices');
});

test('drawVoice keeps speed and minor params in their bands', () => {
  for (let i = 0; i < 100; i += 1) {
    const v = drawVoice();
    assert.ok(v.speed >= 3.3 && v.speed <= 4.5, `speed ${v.speed} out of band`);
    assert.ok(v.randomness >= 0.05 && v.randomness <= 0.15);
    assert.ok(v.melodyRate >= 0.03 && v.melodyRate <= 0.08);
    assert.ok(v.melodyAmplitude >= 0.05 && v.melodyAmplitude <= 0.15);
    assert.equal(v.punctuations, DEFAULT_PUNCTUATIONS);
  }
});

test('drawVoice rounds every numeric to 3 decimals', () => {
  const v = drawVoice();
  for (const key of ['pitch', 'speed', 'randomness', 'melodyRate', 'melodyAmplitude', 'spaceDelay', 'punctuationDelay']) {
    const s = String(v[key]);
    const decimals = s.includes('.') ? s.split('.')[1].length : 0;
    assert.ok(decimals <= 3, `${key}=${v[key]} has more than 3 decimals`);
  }
});

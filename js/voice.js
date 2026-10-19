const RANGES = {
  pitch: [0.5, 3.0],
  speed: [3.3, 4.5],
  randomness: [0.05, 0.15],
  melodyRate: [0.03, 0.08],
  melodyAmplitude: [0.05, 0.15],
  spaceDelay: [0.02, 0.05],
  punctuationDelay: [0.2, 0.4],
};

const DEFAULT_PUNCTUATIONS = [
  '.', ',', '!', '?', "'", '"', '(', ')', '~',
  '。', '、', '！', '？', 'っ', 'ッ', 'ー',
];

const PITCH_FLOOR = 0.05;
const PITCH_CEIL = 4;

const SPEED_FLOOR = 0.1;
const SPEED_CEIL = 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round = (n) => Math.round(n * 1000) / 1000;
const draw = ([lo, hi]) => (lo === hi ? lo : lo + Math.random() * (hi - lo));

export { DEFAULT_PUNCTUATIONS };

const SAFE = {
  pitch: RANGES.pitch.map((n) => clamp(n, PITCH_FLOOR, PITCH_CEIL)),
  speed: RANGES.speed.map((n) => clamp(n, SPEED_FLOOR, SPEED_CEIL)),
  randomness: RANGES.randomness.map((n) => clamp(n, 0, 1)),
  melodyRate: RANGES.melodyRate.map((n) => clamp(n, 0, 1)),
  melodyAmplitude: RANGES.melodyAmplitude.map((n) => clamp(n, 0, 1)),
  spaceDelay: RANGES.spaceDelay.map((n) => clamp(n, 0, 5)),
  punctuationDelay: RANGES.punctuationDelay.map((n) => clamp(n, 0, 10)),
};

export function drawVoice() {
  const pitch = draw(SAFE.pitch);
  const speed = draw(SAFE.speed);

  return {
    pitch: round(pitch),
    speed: round(speed),
    randomness: round(draw(SAFE.randomness)),
    melodyRate: round(draw(SAFE.melodyRate)),
    melodyAmplitude: round(draw(SAFE.melodyAmplitude)),
    spaceDelay: round(draw(SAFE.spaceDelay)),
    punctuationDelay: round(draw(SAFE.punctuationDelay)),
    punctuations: DEFAULT_PUNCTUATIONS,
  };
}

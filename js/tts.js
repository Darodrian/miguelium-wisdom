import { drawVoice, DEFAULT_PUNCTUATIONS } from './voice.js';

// Sprite fijado a un commit concreto de izure1/animalese-tts (bytes validados en loadEngine).
const SHA = 'befec7bb8545a7ecc2b72164cf9d04b6359a5f3f';
const SPRITE_WAV = `https://raw.githubusercontent.com/izure1/animalese-tts/${SHA}/docs/sounds/english-sprite.wav`;
const SPRITE_MAP = `https://raw.githubusercontent.com/izure1/animalese-tts/${SHA}/docs/sounds/english-sprite.json`;
const SPRITE_WAV_BYTES = 1279244;

// El ctor viene inyectado desde loadEngine: VoiceChain es codigo de modulo y
// la libreria solo es visible dentro de loadEngine (import dinamico del CDN).
export class VoiceChain {
  constructor(PitchManagerCtor) {
    this.pitch = 1.5;
    this.speed = 4;
    this.randomness = 0.1;
    this.melodyRate = 0.05;
    this.melodyAmplitude = 0.1;
    this.#pitchManagerCtor = PitchManagerCtor;
    this.#manager = new PitchManagerCtor(this);
  }

  #manager;
  #pitchManagerCtor;

  setVoice(voice) {
    if (Number.isFinite(voice.pitch)) this.pitch = voice.pitch;
    if (Number.isFinite(voice.speed)) this.speed = voice.speed;
    if (Number.isFinite(voice.randomness)) this.randomness = voice.randomness;
    if (Number.isFinite(voice.melodyRate)) this.melodyRate = voice.melodyRate;
    if (Number.isFinite(voice.melodyAmplitude)) this.melodyAmplitude = voice.melodyAmplitude;
    this.#manager = new (this.#pitchManagerCtor)(this);
  }

  calculatePitch(charIndex) {
    return this.#manager.calculatePitch(charIndex);
  }

  apply(buffer, pitchRatio) {
    return this.#manager.apply(buffer, pitchRatio);
  }
}

let engine = null;
let player = null;
let voiceChain = null;
let loadPromise = null;
let spriteRate = 0;

// Mudo del preview: silencia la reproduccion sin perder el ritmo de tecleo.
let muted = false;

export function setMuted(v) { muted = !!v; }
export function isMuted() { return muted; }

export function playerAudioState() {
  try {
    // Con sampleRate puesto el contexto del jugador ya existe; sin el, no lo
    // crees aqui (se crea en el primer speak, tras el primer gesto posible).
    if (!player || !player.sampleRate) return 'none';
    return player.audioContext?.state ?? 'none';
  } catch {
    return 'none';
  }
}

export async function loadEngine() {
  if (engine) return engine;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Import diferido: si el CDN cae, solo falla la voz y el overlay sigue vivo.
    const {
      AnimaleseEngine,
      EnglishAnalyzer,
      WebSampler,
      PitchManager,
      WebPlayer,
    } = await import('https://cdn.jsdelivr.net/npm/animalese-tts@1.1.3/dist/animalese.browser.mjs');

    const map = await (await fetch(SPRITE_MAP)).json();

    const wav = await (await fetch(SPRITE_WAV)).blob();
    if (wav.size !== SPRITE_WAV_BYTES) {
      console.warn(`[animalese] sprite wav: ${wav.size} bytes, esperados ${SPRITE_WAV_BYTES}`);
    }
    const spriteUrl = URL.createObjectURL(wav);

    const sampler = new WebSampler(spriteUrl, map);
    voiceChain = new VoiceChain(PitchManager);
    player = new WebPlayer();

    engine = new AnimaleseEngine({
      analyzer: new EnglishAnalyzer(),
      sampler,
      effect: voiceChain,
      spaceDelay: 0.03,
      punctuationDelay: 0.3,
      punctuations: DEFAULT_PUNCTUATIONS,
    });

    await engine.load();
    // El contexto del WebPlayer se crea en el primer speak (ya con posible
    // activacion de usuario), no aqui en arranque sin ningun gesto.
    spriteRate = sampler.sampleRate;

    return engine;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

async function speakNow(message, { onDuration, isCancelled } = {}) {
  // Frases ya descartadas (globo anterior cancelado) no deben sonar nunca.
  if (isCancelled && isCancelled()) return { samples: 0, voice: null };
  await loadEngine();
  // Cubre el caso en que la frase se cancela mientras el motor carga:
  // al destrabarse, esta comprobacion corta antes de sintetizar y sonar.
  if (isCancelled && isCancelled()) return { samples: 0, voice: null };

  // Contexto del jugador: crearlo tarde (en el primer speak, con posible
  // activacion de usuario) y apuntarlo como destrabe para unlockAudio.
  if (!player.sampleRate && spriteRate) player.sampleRate = spriteRate;
  addPlaybackTarget(player.audioContext);

  const voice = drawVoice();
  voiceChain.setVoice(voice);

  const cfg = engine.config;
  cfg.spaceDelay = voice.spaceDelay;
  cfg.punctuationDelay = voice.punctuationDelay;
  cfg.punctuations = voice.punctuations;

  const buffers = [];
  for await (const output of engine.synthesize(message).speak()) {
    if (output.buffer?.length) buffers.push(output.buffer);
  }
  const total = buffers.reduce((n, b) => n + b.length, 0);
  if (!total) return { samples: 0, voice };

  onDuration?.(Math.round((total / (player.sampleRate || 48000)) * 1000));

  // Mudo: el globo sigue al ritmo calculado, pero no se reproduce audio y
  // la cadena queda libre al instante.
  if (muted) return { samples: total, voice };

  // Mejor esfuerzo: si ya hay activacion, suena ya; si no, unlockAudio lo
  // destrabara con el siguiente gesto (el sonido pendiente arranca al
  // reanudarse y la cadena no se queda colgada).
  try { await player.audioContext.resume(); } catch {}

  await player.drainAndPlay(buffers);
  return { samples: total, voice };
}

let chain = Promise.resolve();

export function speak(message, opts) {
  const run = chain.then(() => speakNow(message, opts));
  chain = run.catch(() => {});
  return run;
}

let probe = null;
let unlockTimer = null;
let unlockAttempts = 0;

// Contextos reales de reproduccion: unlockAudio los destraba junto al probe.
const playbackTargets = new Set();

export function addPlaybackTarget(ctx) {
  if (ctx) playbackTargets.add(ctx);
}

export function audioState() {
  return probe?.state ?? 'none';
}

export async function unlockAudio({ attempts = 40, intervalMs = 250 } = {}) {
  if (!probe) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return 'unsupported';
    probe = new Ctor();
  }

  clearInterval(unlockTimer);
  unlockTimer = null;
  unlockAttempts = attempts;

  // Limpia el intervalo y los gestos: nada queda colgado cuando ya hay audio.
  const cleanup = () => {
    clearInterval(unlockTimer);
    unlockTimer = null;
    window.removeEventListener('pointerdown', onGesture);
    window.removeEventListener('keydown', onGesture);
  };

  const nudge = async () => {
    const ctxs = [probe, ...playbackTargets].filter((c) => c && typeof c.resume === 'function');
    await Promise.all(ctxs.map(async (c) => {
      try { await c.resume(); } catch {}
    }));
    if (probe.state === 'running') { cleanup(); return true; }
    return false;
  };

  const onGesture = () => { nudge(); };
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);

  if (await nudge()) return probe.state;

  // El intervalo solo acelera los primeros reintentos; los gestos se quedan
  // hasta destrabar, para que un clic tardio (preview) siga valiendo.
  unlockTimer = setInterval(() => {
    unlockAttempts -= 1;
    nudge();
    if (unlockAttempts <= 0) { clearInterval(unlockTimer); unlockTimer = null; }
  }, intervalMs);

  return probe.state;
}


// Normaliza texto español para la voz: el sprite y el analizador son
// ingleses, asi que los acentos y los signos invertidos se descartarian.
// La longitud se conserva para que el globo y el audio avanzen al mismo ritmo.
export function forSpeech(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/¿/g, '?')
    .replace(/¡/g, '!');
}

// Milisegundos por caracter dentro del globo para que la escritura dure
// exacto lo que suena el frase: ni flash ni arrastre.
export function perCharMs(durationMs, charCount) {
  const per = durationMs / Math.max(1, charCount);
  return Math.max(18, Math.min(140, per));
}

// Decide el ritmo del globo: si la voz responde con su duracion, al ritmo
// del audio; si rechaza o no contesta en graceMs, al ritmo fijo tipico.
// onPace se dispara una sola vez y cancel() silencia respuestas tardias,
// para que una frase vieja nunca arranque un typewriter de la nueva.
export function schedulePacing({ text, speak, fallbackPerChar, graceMs, onPace }) {
  let settled = false;
  const fire = (perChar) => {
    if (settled) return;
    settled = true;
    clearTimeout(grace);
    onPace(perChar);
  };
  const grace = setTimeout(() => fire(fallbackPerChar), graceMs);
  speak(text, {
    onDuration: (ms) => fire(perCharMs(ms, text.length)),
    isCancelled: () => settled,
  }).catch(() => fire(fallbackPerChar));
  return () => { settled = true; clearTimeout(grace); };
}

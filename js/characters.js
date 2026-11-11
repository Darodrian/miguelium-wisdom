// Ajustes por personaje: cada uno tiene su umbral de bits, apariencia y
// voz. Todo se guarda en localStorage con alcance por broadcaster y
// personaje, igual que el umbral global anterior (mw_amount_<id>).

export const CHARACTER_MIGUELIUM = 'miguelium';
export const CHARACTER_ROWLET = 'ms-rowlet';

function norm(id) {
  return String(id || '').trim().toLowerCase();
}

export const CHARACTERS = {
  [CHARACTER_MIGUELIUM]: {
    src: 'assets/miguelium.png',
    alt: 'Miguelium',
    label: 'Miguelium',
  },
  [CHARACTER_ROWLET]: {
    src: 'assets/ms-rowlet.png',
    alt: 'Ms. Rowlet',
    label: 'Ms. Rowlet',
  },
};

export const DEFAULT_AMOUNT = 100;

export const DEFAULT_SETTINGS = {
  amount: DEFAULT_AMOUNT,
  font: 'Georgia',
  fontSize: 22,
  movement: 'off',
  palette: 'default',
  flip: false,
};

const PFX = 'mwchar_';

function settingKey(broadcasterId, character, setting) {
  return PFX + norm(broadcasterId) + '_' + character + '_' + setting;
}

function storageGet(key, def) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? def : v;
  } catch (e) {
    return def;
  }
}
function storageSet(key, val) {
  try {
    localStorage.setItem(key, String(val));
  } catch (e) {
    /* modo privado */
  }
}

// Lee un ajuste de un personaje concreto. broadcasterId vacio usa claves
// sin alcance (preview / sobrescritura local simple).
export function readSetting(broadcasterId, character, setting, def) {
  const key = settingKey(broadcasterId, character, setting);
  const raw = storageGet(key, undefined);
  if (raw !== undefined) return raw;
  // Herencia del antiguo ajuste global mw_<setting> para que ambos
  // personajes nazcan con el look ya configurado del streamer.
  const legacy = storageGet('mw_' + setting, undefined);
  return legacy !== undefined ? legacy : def;
}

export function saveSetting(broadcasterId, character, setting, value) {
  storageSet(settingKey(broadcasterId, character, setting), value);
}

export function readAllSettings(broadcasterId, character) {
  const s = {};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const raw = readSetting(broadcasterId, character, key, undefined);
    if (raw === undefined) {
      s[key] = DEFAULT_SETTINGS[key];
      continue;
    }
    if (key === 'amount' || key === 'fontSize') {
      const n = Number(raw);
      s[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SETTINGS[key];
    } else if (key === 'flip') {
      s[key] = String(raw) === 'true';
    } else {
      s[key] = raw;
    }
  }
  return s;
}

export function saveAllSettings(broadcasterId, character, settings) {
  for (const [key, value] of Object.entries(settings)) {
    saveSetting(broadcasterId, character, key, value);
  }
}

// El umbral de miguelium se semilla del valor global guardado antes de este
// cambio (mw_amount_<id>) para que no se resetee. ms-rowlet empieza por
// defecto hasta que el streamer lo ajuste en el panel.
export function defaultAmountFor(broadcasterId, character) {
  if (character === CHARACTER_MIGUELIUM) {
    const legacy = storageGet('mw_amount_' + norm(broadcasterId), '');
    const n = Number(legacy);
    if (legacy !== '' && Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_AMOUNT;
}

// Migra el antiguo ajuste global mw_character ('rowlet') al id canonico
// 'ms-rowlet' para que las frases y los ajustes encajen.
export function migrateLegacyCharacter(broadcasterId) {
  try {
    const raw = localStorage.getItem('mw_character');
    if (raw === 'rowlet') {
      localStorage.setItem('mw_character', CHARACTER_ROWLET);
    }
  } catch (e) {
    /* sin almacenamiento */
  }
}

export function isValidCharacter(character) {
  return Object.prototype.hasOwnProperty.call(CHARACTERS, character);
}

export function allCharacters() {
  return [CHARACTER_MIGUELIUM, CHARACTER_ROWLET];
}

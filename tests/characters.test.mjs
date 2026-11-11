import test from 'node:test';
import assert from 'node:assert/strict';

// localStorage no existe en node: lo simulamos para probar el modulo.
const store = new Map();
globalThis.localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
};

import {
  CHARACTER_MIGUELIUM, CHARACTER_ROWLET, CHARACTERS,
  readAllSettings, saveAllSettings, saveSetting, readSetting,
  defaultAmountFor, migrateLegacyCharacter, isValidCharacter,
} from '../js/characters.js';

test('CHARACTERS expone ambos personajes con sus assets', () => {
  assert.equal(CHARACTERS[CHARACTER_MIGUELIUM].src, 'assets/miguelium.png');
  assert.equal(CHARACTERS[CHARACTER_ROWLET].src, 'assets/ms-rowlet.png');
  assert.equal(CHARACTERS[CHARACTER_ROWLET].label, 'Ms. Rowlet');
});

test('readAllSettings devuelve valores por defecto sin almacenamiento', () => {
  store.clear();
  const s = readAllSettings('B1', CHARACTER_MIGUELIUM);
  assert.equal(s.amount, 100);
  assert.equal(s.font, 'Georgia');
  assert.equal(s.fontSize, 22);
  assert.equal(s.movement, 'off');
  assert.equal(s.palette, 'default');
  assert.equal(s.flip, false);
});

test('saveAllSettings y readAllSettings ronda de guarda', () => {
  store.clear();
  saveAllSettings('B1', CHARACTER_ROWLET, {
    amount: 250, font: 'ZPix', fontSize: 30, movement: 'bob', palette: 'emerald', flip: true,
  });
  const s = readAllSettings('B1', CHARACTER_ROWLET);
  assert.equal(s.amount, 250);
  assert.equal(s.font, 'ZPix');
  assert.equal(s.fontSize, 30);
  assert.equal(s.movement, 'bob');
  assert.equal(s.palette, 'emerald');
  assert.equal(s.flip, true);
});

test('defaultAmountFor semilla a miguelium desde el umbral legado', () => {
  store.clear();
  localStorage.setItem('mw_amount_b1', '150');
  assert.equal(defaultAmountFor('B1', CHARACTER_MIGUELIUM), 150);
  assert.equal(defaultAmountFor('B1', CHARACTER_ROWLET), 100);
  localStorage.removeItem('mw_amount_b1');
});

test('defaultAmountFor devuelve el defecto cuando no hay legado valido', () => {
  store.clear();
  localStorage.setItem('mw_amount_b1', 'abc');
  assert.equal(defaultAmountFor('B1', CHARACTER_MIGUELIUM), 100);
});

test('migrateLegacyCharacter mueve rowlet a ms-rowlet', () => {
  store.clear();
  localStorage.setItem('mw_character', 'rowlet');
  migrateLegacyCharacter('B1');
  assert.equal(localStorage.getItem('mw_character'), 'ms-rowlet');
});

test('migrateLegacyCharacter no toca miguelium', () => {
  store.clear();
  localStorage.setItem('mw_character', 'miguelium');
  migrateLegacyCharacter('B1');
  assert.equal(localStorage.getItem('mw_character'), 'miguelium');
});

test('scoped save is not visible through an un-scoped read (per-character isolation)', () => {
  store.clear();
  saveAllSettings('B1', CHARACTER_MIGUELIUM, { amount: 150, font: 'ZPix' });
  const scoped = readAllSettings('B1', CHARACTER_MIGUELIUM);
  const unscoped = readAllSettings('', CHARACTER_MIGUELIUM);
  assert.equal(scoped.amount, 150);
  assert.equal(scoped.font, 'ZPix');
  assert.notEqual(unscoped.amount, scoped.amount);
});

test('isValidCharacter reconoce solo los dos personajes', () => {
  assert.equal(isValidCharacter('miguelium'), true);
  assert.equal(isValidCharacter('ms-rowlet'), true);
  assert.equal(isValidCharacter('rowlet'), false);
  assert.equal(isValidCharacter('otro'), false);
});

test('ms-rowlet no hereda el umbral legado de miguelium', () => {
  store.clear();
  localStorage.setItem('mw_amount_b1', '153');
  assert.equal(readAllSettings('b1', CHARACTER_ROWLET).amount, 100);
  assert.equal(defaultAmountFor('b1', CHARACTER_ROWLET), 100);
  assert.equal(defaultAmountFor('b1', CHARACTER_MIGUELIUM), 153);
});

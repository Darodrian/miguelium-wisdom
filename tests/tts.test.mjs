import test from 'node:test';
import assert from 'node:assert/strict';

// El overlay no puede depender de que el CDN conteste para arrancar:
// una importacion estatica de jsdelivr mata el modulo completo (y con el,
// el overlay entero) si el CDN cae. La carga del motor debe ser diferida.
test('tts module imports with no network access (no static CDN import)', async () => {
  await assert.doesNotReject(() => import('../js/tts.js'));
});

test('speak honors isCancelled before touching engine or network', async () => {
  const { speak } = await import('../js/tts.js');
  const res = await speak('hola', { isCancelled: () => true });
  assert.equal(res.samples, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VECTOR_DIM,
  VectorMemoryStore,
  compressAndNormalizeEmbedding,
  cosineSimilarity,
  embedTextLocal,
} from './vectorMemory';

test('embedTextLocal produces unit-norm 64-dim vector deterministically', () => {
  const v1 = embedTextLocal('Order of the Astrolabe clockwork meridian');
  const v2 = embedTextLocal('Order of the Astrolabe clockwork meridian');
  assert.equal(v1.length, VECTOR_DIM);
  assert.deepEqual(v1, v2);
  const norm = Math.sqrt(v1.reduce((acc, n) => acc + n * n, 0));
  assert.ok(Math.abs(norm - 1) < 1e-3, `Expected unit norm, got ${norm}`);
});

test('cosineSimilarity ranks semantically aligned memories higher', () => {
  const store = new VectorMemoryStore();
  store.addMemory({
    summary: 'Unsealed ancient verdant forest roots to heal the sacred grove.',
    category: 'choice',
    factionTag: 'verdant',
    importance: 8,
  });
  store.addMemory({
    summary: 'Shattered obsidian cores during intense sentinel storm combat.',
    category: 'combat',
    factionTag: 'unbound',
    importance: 8,
  });

  const verdantResults = store.query('verdant forest roots growth', 2);
  assert.equal(verdantResults[0].entry.factionTag, 'verdant');

  const combatResults = store.query('sentinel storm combat obsidian', 2);
  assert.equal(combatResults[0].entry.factionTag, 'unbound');
});

test('compressAndNormalizeEmbedding compresses 768-dim vector to 64-dim unit vector', () => {
  const raw = Array.from({ length: 768 }, (_, i) => Math.sin(i * 0.13));
  const compressed = compressAndNormalizeEmbedding(raw);
  assert.equal(compressed.length, VECTOR_DIM);
  const simSelf = cosineSimilarity(compressed, compressed);
  assert.ok(Math.abs(simSelf - 1) < 1e-3);
});

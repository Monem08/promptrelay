'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { rankModels, recommend, avgPrice, PROFILES } = require('../src/models/ranking');
const { createModel } = require('../src/models/schema');

function model(overrides) {
  return createModel(overrides);
}

test('PROFILES include the documented set', () => {
  for (const p of ['balanced', 'cheapest', 'free', 'coding', 'long-context', 'reasoning', 'vision', 'tools']) {
    assert.ok(PROFILES.includes(p), `missing profile ${p}`);
  }
});

test('avgPrice averages known prices, tolerates unknown', () => {
  assert.equal(avgPrice(model({ inputPrice: 2, outputPrice: 4 })), 3);
  assert.equal(avgPrice(model({ inputPrice: 2 })), 2);
  assert.equal(avgPrice(model({})), null);
});

test('free profile filters to explicitly free models only', () => {
  const models = [
    model({ id: 'free-1', free: true }),
    model({ id: 'paid-1', free: false }),
    model({ id: 'unknown-1' }), // free: 'unknown'
  ];
  const ranked = rankModels(models, 'free');
  const ids = ranked.map((r) => r.model.id);
  assert.ok(ids.includes('free-1'));
  assert.ok(!ids.includes('paid-1'));
  assert.ok(!ids.includes('unknown-1'));
});

test('vision profile requires known vision=true', () => {
  const models = [
    model({ id: 'sees', vision: true }),
    model({ id: 'blind', vision: false }),
    model({ id: 'maybe' }),
  ];
  const ids = rankModels(models, 'vision').map((r) => r.model.id);
  assert.deepEqual(ids, ['sees']);
});

test('long-context ranks larger windows first', () => {
  const models = [
    model({ id: 'small', contextWindow: 8000 }),
    model({ id: 'big', contextWindow: 200000 }),
    model({ id: 'mid', contextWindow: 32000 }),
  ];
  const ids = rankModels(models, 'long-context').map((r) => r.model.id);
  assert.equal(ids[0], 'big');
});

test('recommend returns transparent explanation and alternatives', () => {
  const models = [
    model({ id: 'big', contextWindow: 200000 }),
    model({ id: 'small', contextWindow: 8000 }),
  ];
  const rec = recommend(models, 'long-context');
  assert.equal(rec.model.id, 'big');
  assert.match(rec.explanation, /long-context/);
  assert.ok(Array.isArray(rec.alternatives));
});

test('recommend explains when nothing qualifies (no fabrication)', () => {
  const rec = recommend([model({ id: 'unknown-caps' })], 'vision');
  assert.equal(rec.model, null);
  assert.match(rec.explanation, /unknown|No models/i);
});

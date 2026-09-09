'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getCached, setCached, clearCache } = require('../src/models/cache');

function makeConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-cache-'));
  return {
    provider: { name: 'Mock', baseURL: 'https://mock.test/v1' },
    paths: { cacheFile: path.join(dir, 'models.json') },
  };
}

test('setCached then getCached round-trips models with metadata', () => {
  const config = makeConfig();
  const models = [{ id: 'a' }, { id: 'b' }];
  const entry = setCached(config, models, { source: 'provider-metadata' });
  assert.equal(entry.source, 'provider-metadata');
  assert.ok(entry.retrievedAt && entry.expiresAt);

  const got = getCached(config);
  assert.equal(got.models.length, 2);
  assert.equal(got.source, 'provider-metadata');
});

test('getCached returns null when expired', () => {
  const config = makeConfig();
  setCached(config, [{ id: 'a' }], { source: 'x', ttlMs: -1000 });
  assert.equal(getCached(config), null);
  // ignoreExpiry still returns it.
  assert.ok(getCached(config, { ignoreExpiry: true }));
});

test('clearCache removes the entry', () => {
  const config = makeConfig();
  setCached(config, [{ id: 'a' }], { source: 'x' });
  assert.ok(getCached(config));
  assert.equal(clearCache(config), true);
  assert.equal(getCached(config), null);
});

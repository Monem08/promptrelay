'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  detectVersion,
  migrateConfig,
  migrateConfigFile,
  backupConfigFile,
} = require('../src/config/migrate');
const { CONFIG_VERSION } = require('../src/config/schema');

test('detectVersion treats unversioned config as v1', () => {
  assert.equal(detectVersion({}), 1);
  assert.equal(detectVersion({ version: 2 }), 2);
});

test('migrateConfig upgrades v1 to current additively, preserving fields', () => {
  const legacy = {
    provider: { name: 'OpenRouter', model: 'x', transport: 'openai-compatible' },
    prompt: { mode: 'replace' },
    reasoning: { default: 'low', injectDefault: false },
  };
  const { config, migrated, fromVersion, toVersion } = migrateConfig(legacy);
  assert.equal(migrated, true);
  assert.equal(fromVersion, 1);
  assert.equal(toVersion, CONFIG_VERSION);
  assert.equal(config.version, CONFIG_VERSION);
  // Existing values preserved.
  assert.equal(config.provider.name, 'OpenRouter');
  assert.equal(config.prompt.mode, 'replace');
  // New blocks added.
  assert.deepEqual(config.providers, {});
  assert.equal(config.reasoning.auto, false);
  assert.equal(config.retry.enabled, true);
  assert.equal(config.fallback.enabled, false);
});

test('migrateConfig is a no-op for already-current configs', () => {
  const current = { version: CONFIG_VERSION, provider: {}, providers: {}, retry: {}, fallback: {} };
  const { migrated } = migrateConfig(current);
  assert.equal(migrated, false);
});

test('migrateConfigFile writes a backup then upgrades on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-mig-'));
  const file = path.join(dir, 'promptrelay.json');
  fs.writeFileSync(file, JSON.stringify({ provider: { name: 'X' } }), 'utf8');

  const result = migrateConfigFile(file);
  assert.equal(result.migrated, true);
  assert.ok(result.backupPath && fs.existsSync(result.backupPath));

  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, CONFIG_VERSION);
  assert.ok(onDisk.providers);
});

test('backupConfigFile returns null when file absent', () => {
  assert.equal(backupConfigFile(path.join(os.tmpdir(), 'does-not-exist-xyz.json')), null);
});

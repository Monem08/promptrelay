'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildProviderBlock,
  mergeProvider,
  setupOpenCode,
  PROVIDER_ID,
} = require('../src/opencode');
const { parseJSONC } = require('../src/opencode/jsonc');

test('buildProviderBlock includes verified limits only, never fabricates', () => {
  const withMeta = buildProviderBlock({
    baseURL: 'http://127.0.0.1:4141/v1',
    model: 'x/y',
    modelMeta: { contextWindow: 128000, maxOutputTokens: 4096, name: 'X Y' },
  });
  assert.equal(withMeta[PROVIDER_ID].models['x/y'].limit.context, 128000);
  assert.equal(withMeta[PROVIDER_ID].models['x/y'].limit.output, 4096);

  const unknown = buildProviderBlock({
    baseURL: 'http://127.0.0.1:4141/v1',
    model: 'x/y',
    modelMeta: { contextWindow: 'unknown', maxOutputTokens: 'unknown' },
  });
  // No limit block fabricated when limits are unknown.
  assert.equal('limit' in unknown[PROVIDER_ID].models['x/y'], false);
});

test('mergeProvider preserves unrelated providers and keys', () => {
  const existing = {
    $schema: 'https://opencode.ai/config.json',
    theme: 'dark',
    provider: {
      openai: { npm: '@ai-sdk/openai', models: { 'gpt-4o': {} } },
    },
  };
  const block = buildProviderBlock({ baseURL: 'http://127.0.0.1:4141/v1', model: 'x/y' });
  const merged = mergeProvider(existing, block);

  assert.equal(merged.theme, 'dark');
  assert.ok(merged.provider.openai, 'existing provider must be preserved');
  assert.ok(merged.provider[PROVIDER_ID], 'promptrelay provider must be added');
});

test('setupOpenCode creates a new config then merges non-destructively with backup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-oc-'));
  const target = path.join(dir, 'opencode.jsonc');

  // First run: create.
  const first = setupOpenCode({ baseURL: 'http://127.0.0.1:4141/v1', model: 'a/b', targetPath: target });
  assert.equal(first.created, true);
  assert.equal(first.backupPath, null);
  assert.ok(fs.existsSync(target));

  // Simulate a user editing the file with comments + an extra provider.
  const edited = `{
    // user comment
    "theme": "gruvbox",
    "provider": {
      "promptrelay": { "npm": "@ai-sdk/openai-compatible", "name": "PromptRelay", "options": { "baseURL": "http://127.0.0.1:4141/v1" }, "models": { "a/b": { "name": "a/b" } } },
      "anthropic": { "npm": "@ai-sdk/anthropic", "models": { "claude": {} } },
    },
  }`;
  fs.writeFileSync(target, edited, 'utf8');

  // Second run: merge, must back up and keep the user's other provider + theme.
  const second = setupOpenCode({ baseURL: 'http://127.0.0.1:4141/v1', model: 'c/d', targetPath: target });
  assert.equal(second.created, false);
  assert.ok(second.backupPath && fs.existsSync(second.backupPath), 'a backup must be written');

  const result = parseJSONC(fs.readFileSync(target, 'utf8'));
  assert.equal(result.theme, 'gruvbox');
  assert.ok(result.provider.anthropic, 'user provider preserved');
  // Both models present (merged, not replaced).
  assert.ok(result.provider[PROVIDER_ID].models['a/b']);
  assert.ok(result.provider[PROVIDER_ID].models['c/d']);
});

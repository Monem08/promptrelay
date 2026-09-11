'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { updateProviderInJSONC, removeProviderFromJSONC } = require('../src/opencode/jsonc-edit');
const { parseJSONC } = require('../src/opencode/jsonc');
const { updateModelInYaml, removeModelFromYaml } = require('../src/clients/yaml-edit');
const { setupOpenCode, removeOpenCode } = require('../src/opencode');
const hermes = require('../src/clients/hermes');

test('JSONC: updateProviderInJSONC preserves comments and formatting', () => {
  const original = `{
  // User custom comments at top
  "$schema": "https://opencode.ai/config.json",
  /* Block comment before theme */
  "theme": "dark",
  // Section for providers
  "provider": {
    // Anthropic direct provider
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "models": { "claude-3-5": {} }
    }
  },
  // Bottom comment
  "telemetry": false
}`;

  const promptrelayBlock = {
    npm: '@ai-sdk/openai-compatible',
    name: 'PromptRelay',
    options: { baseURL: 'http://127.0.0.1:4141/v1' },
    models: { 'deepseek/deepseek-r1': { name: 'DeepSeek R1' } },
  };

  const updated = updateProviderInJSONC(original, 'promptrelay', promptrelayBlock);

  // Verify comments remain
  assert.ok(updated.includes('// User custom comments at top'));
  assert.ok(updated.includes('/* Block comment before theme */'));
  assert.ok(updated.includes('// Section for providers'));
  assert.ok(updated.includes('// Anthropic direct provider'));
  assert.ok(updated.includes('// Bottom comment'));

  // Verify valid JSONC that contains both anthropic and promptrelay
  const parsed = parseJSONC(updated);
  assert.equal(parsed.theme, 'dark');
  assert.equal(parsed.telemetry, false);
  assert.ok(parsed.provider.anthropic);
  assert.ok(parsed.provider.promptrelay);
  assert.equal(parsed.provider.promptrelay.options.baseURL, 'http://127.0.0.1:4141/v1');

  // Now test removing promptrelay
  const { text: removedText, removed } = removeProviderFromJSONC(updated, 'promptrelay');
  assert.equal(removed, true);
  assert.ok(removedText.includes('// Anthropic direct provider'));
  assert.ok(removedText.includes('// User custom comments at top'));
  const parsedAfterRemove = parseJSONC(removedText);
  assert.ok(parsedAfterRemove.provider.anthropic);
  assert.equal(parsedAfterRemove.provider.promptrelay, undefined);
});

test('YAML: updateModelInYaml and removeModelFromYaml preserve comments', () => {
  const originalYaml = `# Hermes Agent Configuration
version: 1

# User settings
theme: matrix

# Managed model configuration
model:
  provider: custom
  base_url: http://old-host:1234/v1
  model: old-model
  api_key: \${OLD_KEY}

# Terminal options
terminal:
  bell: false
`;

  const newModelConfig = {
    provider: 'custom',
    base_url: 'http://127.0.0.1:4141/v1',
    model: 'new-model',
    api_key: '${PROMPTRELAY_API_KEY}',
  };

  const updatedYaml = updateModelInYaml(originalYaml, newModelConfig);

  // Check that all comments and other keys are preserved
  assert.ok(updatedYaml.includes('# Hermes Agent Configuration'));
  assert.ok(updatedYaml.includes('# User settings'));
  assert.ok(updatedYaml.includes('# Terminal options'));
  assert.ok(updatedYaml.includes('theme: matrix'));
  assert.ok(updatedYaml.includes('bell: false'));

  const parsed = yaml.load(updatedYaml);
  assert.equal(parsed.model.base_url, 'http://127.0.0.1:4141/v1');
  assert.equal(parsed.model.model, 'new-model');
  assert.equal(parsed.theme, 'matrix');

  // Test removing model from YAML
  const { text: removedYaml, removed } = removeModelFromYaml(updatedYaml);
  assert.equal(removed, true);
  assert.ok(removedYaml.includes('# User settings'));
  assert.ok(removedYaml.includes('# Terminal options'));
  assert.ok(!removedYaml.includes('http://127.0.0.1:4141/v1'));
  const parsedRemoved = yaml.load(removedYaml);
  assert.equal(parsedRemoved.model, undefined);
  assert.equal(parsedRemoved.theme, 'matrix');
});

test('Integration: setupOpenCode preserves existing comments on disk', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-jsonc-'));
  const file = path.join(dir, 'opencode.jsonc');

  const contentWithComments = `{
    // Global opencode settings
    "theme": "monokai",
    "provider": {
      // Existing custom provider
      "my-prov": { "npm": "@ai-sdk/openai" }
    }
  }`;
  fs.writeFileSync(file, contentWithComments, 'utf8');

  setupOpenCode({ baseURL: 'http://127.0.0.1:4141/v1', model: 'test/m', targetPath: file });

  const afterSetup = fs.readFileSync(file, 'utf8');
  assert.ok(afterSetup.includes('// Global opencode settings'));
  assert.ok(afterSetup.includes('// Existing custom provider'));

  const { removed } = removeOpenCode(file);
  assert.equal(removed, true);
  const afterRemove = fs.readFileSync(file, 'utf8');
  assert.ok(afterRemove.includes('// Global opencode settings'));
  assert.ok(afterRemove.includes('// Existing custom provider'));
});

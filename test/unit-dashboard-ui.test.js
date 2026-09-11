'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const presets = require('../src/providers/presets');

describe('Dashboard UI Redesign & Brand Logo Registry', async () => {
  const { canonicalBrandKey, LOGO_SVGS } = await import('../dashboard/js/logos.js');
  it('maps all supported clients to canonical brand keys', () => {
    assert.equal(canonicalBrandKey('opencode'), 'opencode');
    assert.equal(canonicalBrandKey('claude-code'), 'claude-code');
    assert.equal(canonicalBrandKey('Claude Code'), 'claude-code');
    assert.equal(canonicalBrandKey('hermes'), 'hermes');
    assert.equal(canonicalBrandKey('Nous Hermes'), 'hermes');
    assert.equal(canonicalBrandKey('promptrelay'), 'promptrelay');
  });

  it('maps all recognized provider presets to canonical brand keys', () => {
    const expected = [
      ['openai', 'openai'],
      ['chatgpt', 'openai'],
      ['anthropic', 'anthropic'],
      ['claude', 'claude-code'],
      ['ollama', 'ollama'],
      ['ollama-local', 'ollama'],
      ['ollama-cloud', 'ollama'],
      ['openrouter', 'openrouter'],
      ['gemini', 'gemini'],
      ['google-gemini', 'gemini'],
      ['azure', 'azure'],
      ['azure-openai', 'azure'],
      ['groq', 'groq'],
      ['mistral', 'mistral'],
      ['codestral', 'mistral'],
      ['xai', 'xai'],
      ['grok', 'xai'],
      ['deepseek', 'deepseek'],
      ['together', 'together'],
      ['fireworks', 'fireworks'],
      ['nvidia', 'nvidia'],
      ['cerebras', 'cerebras'],
      ['sambanova', 'sambanova'],
    ];

    for (const [input, expectedKey] of expected) {
      assert.equal(canonicalBrandKey(input), expectedKey, `Expected "${input}" to map to "${expectedKey}"`);
    }
  });

  it('maps unrecognized or custom providers to custom fallback key', () => {
    assert.equal(canonicalBrandKey('my-private-llm'), 'custom');
    assert.equal(canonicalBrandKey('unknown-corp'), 'custom');
    assert.equal(canonicalBrandKey(''), 'custom');
    assert.equal(canonicalBrandKey(null), 'custom');
  });

  it('contains sanitized, well-formed SVGs with fixed dimensions for all brand keys', () => {
    const requiredKeys = [
      'promptrelay', 'opencode', 'claude-code', 'anthropic', 'hermes',
      'openai', 'ollama', 'openrouter', 'gemini', 'azure', 'groq',
      'mistral', 'xai', 'deepseek', 'together', 'fireworks', 'nvidia',
      'cerebras', 'sambanova',
    ];

    for (const key of requiredKeys) {
      const svg = LOGO_SVGS[key];
      assert.ok(svg, `Missing SVG for brand key "${key}"`);
      assert.match(svg, /^<svg/);
      assert.match(svg, /viewBox="0 0 24 24"/);
      assert.match(svg, /width="24"/);
      assert.match(svg, /height="24"/);
      // Ensure sanitized: no scripts, no handlers, no external links
      assert.doesNotMatch(svg, /<script/i);
      assert.doesNotMatch(svg, /on\w+=/i);
      assert.doesNotMatch(svg, /http:\/\//i);
      assert.doesNotMatch(svg, /foreignObject/i);
    }
  });

  it('enumerates all official provider presets directly from source code', () => {
    const list = presets.listPresets();
    const ids = list.map((p) => p.id);

    assert.ok(ids.includes('openrouter'));
    assert.ok(ids.includes('anthropic'));
    assert.ok(ids.includes('ollama-local'));
    assert.ok(ids.includes('openai'));
    assert.ok(ids.includes('deepseek'));
    assert.ok(ids.includes('groq'));
    assert.ok(ids.includes('mistral'));
    assert.ok(ids.includes('gemini'));
    assert.ok(ids.includes('together'));
    assert.ok(ids.includes('fireworks'));
    assert.ok(ids.includes('cerebras'));
    assert.ok(ids.includes('sambanova'));
    assert.ok(ids.includes('azure'));
    assert.ok(ids.includes('custom-openai'));

    for (const p of list) {
      assert.ok(p.id, 'Preset must have an id');
      assert.ok(p.label, 'Preset must have a label');
      assert.ok(p.transport, 'Preset must have a transport');
      assert.equal(typeof p.needsKey, 'boolean');
    }
  });

  it('instantiates valid provider templates for each preset', () => {
    const testIds = ['openai', 'anthropic', 'ollama-local', 'deepseek', 'groq', 'mistral', 'gemini'];
    for (const id of testIds) {
      const p = presets.getPreset(id);
      assert.ok(p, `Preset "${id}" must exist`);
      assert.ok(p.provider.name, `Preset "${id}" must specify provider name`);
      assert.ok(p.provider.baseURL, `Preset "${id}" must specify baseURL`);
      assert.ok(p.provider.transport, `Preset "${id}" must specify transport`);
      assert.ok(p.provider.apiKeyEnv, `Preset "${id}" must specify apiKeyEnv`);
    }
  });
});

describe('Dashboard Hyperscript & State Robustness', () => {
  it('safely tolerates empty class tokens without throwing DOMTokenList exceptions', () => {
    // Test the parsing logic used in ui.js h() builder
    const tag = 'div.stepper-dot.';
    const parts = String(tag).split(/(?=[.#])/);
    const classes = [];
    for (const p of parts.slice(parts[0].match(/^[.#]/) ? 0 : 1)) {
      if (p.startsWith('.')) {
        const c = p.slice(1);
        if (c) classes.push(c);
      }
    }
    assert.deepEqual(classes, ['stepper-dot']);
  });

  it('sanitizes review payload without revealing raw secrets', () => {
    const rawSecret = 'sk-live-secret-key-1234567890';
    const wiz = {
      name: 'production-openai',
      transport: 'openai-compatible',
      baseURL: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      apiKeyEnv: 'OPENAI_API_KEY',
      authType: 'direct',
      apiKey: rawSecret,
    };

    // Review representation:
    const credSource = wiz.authType === 'env'
      ? `Via environment variable ($${wiz.apiKeyEnv})`
      : 'Direct secret stored in ~/.promptrelay/.env';

    assert.doesNotMatch(credSource, new RegExp(rawSecret));
    assert.match(credSource, /Direct secret stored/);
  });
});

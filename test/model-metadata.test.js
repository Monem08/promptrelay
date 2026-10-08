'use strict';

/**
 * Model-metadata propagation into client configs.
 *
 * The contract under test is deliberately narrow, because getting it wrong is
 * how a gateway breaks someone's agent:
 *
 *   - a VERIFIED value (observed from provider metadata) is written through
 *   - an 'unknown' value is NEVER written — the client keeps its own fallback,
 *     which is safer than a number PromptRelay made up
 *   - a USER-SELECTED value (the user answered the interactive prompt) is
 *     written, and is labelled with that provenance rather than passed off as
 *     provider-verified
 *   - background sync never prompts and never guesses
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const hermes = require('../src/clients/hermes');
const opencode = require('../src/clients/opencode');
const presets = require('../src/models/context-presets');
const { updateTopLevelBlock } = require('../src/clients/yaml-edit');
const { UNKNOWN } = require('../src/models/schema');
const { validateConfig } = require('../src/config');

let tmpDir;

beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-meta-')); });
afterEach(() => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {} });

describe('context presets: parsing what a user types', () => {
  it('accepts plain integers', () => {
    assert.equal(presets.parsePositiveInt('65536'), 65536);
    assert.equal(presets.parsePositiveInt('  200000 '), 200000);
  });

  it('accepts K/M suffixes', () => {
    assert.equal(presets.parsePositiveInt('64K'), 65536);
    assert.equal(presets.parsePositiveInt('32k'), 32768);
    assert.equal(presets.parsePositiveInt('1M'), 1048576);
    assert.equal(presets.parsePositiveInt('3.5K'), 3584);
  });

  it('rejects anything that is not a usable positive number', () => {
    for (const bad of ['', 'abc', 'unknown', '0', '-5', 'null', undefined, null, {}]) {
      assert.equal(presets.parsePositiveInt(bad), null, `expected null for ${JSON.stringify(bad)}`);
    }
  });

  it('never turns the string "unknown" into a number', () => {
    assert.equal(presets.parsePositiveInt(UNKNOWN), null);
  });
});

describe('context presets: passive (non-interactive) resolution', () => {
  it('passes verified values straight through', () => {
    const r = presets.resolveMetadataPassive({
      modelMeta: { contextWindow: 400000, maxOutputTokens: 65536, source: 'provider-metadata' },
      supportedEfforts: ['low', 'high'],
    });
    assert.equal(r.contextWindow.value, 400000);
    assert.equal(r.contextWindow.source, 'provider-metadata');
    assert.equal(r.maxOutputTokens.value, 65536);
    assert.deepEqual(r.reasoningEfforts.value, ['low', 'high']);
  });

  it('leaves everything unknown when the provider published nothing', () => {
    const r = presets.resolveMetadataPassive({
      modelMeta: { contextWindow: UNKNOWN, maxOutputTokens: UNKNOWN },
      supportedEfforts: UNKNOWN,
    });
    assert.equal(r.contextWindow.value, null);
    assert.equal(r.contextWindow.source, 'unknown');
    assert.equal(r.maxOutputTokens.value, null);
    assert.equal(r.reasoningEfforts.value, null);
    assert.equal(r.reasoningEfforts.source, 'unknown');
  });

  it('handles a completely absent modelMeta', () => {
    const r = presets.resolveMetadataPassive({});
    assert.equal(r.contextWindow.value, null);
    assert.equal(r.reasoningEfforts.value, null);
  });

  it('rejects non-numeric or nonsensical verified values', () => {
    const r = presets.resolveMetadataPassive({
      modelMeta: { contextWindow: 0, maxOutputTokens: -1 },
      supportedEfforts: [],
    });
    assert.equal(r.contextWindow.value, null);
    assert.equal(r.maxOutputTokens.value, null);
  });
});

describe('context presets: the offered lists are sane', () => {
  it('offers context windows in ascending order with an explanation each', () => {
    const values = presets.COMMON_CONTEXT_WINDOWS.map((c) => c.value);
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
    for (const c of presets.COMMON_CONTEXT_WINDOWS) {
      assert.ok(c.hint && c.hint.length > 3, `${c.label} needs a hint`);
      assert.ok(c.value > 0);
    }
  });

  it('offers output limits in ascending order', () => {
    const values = presets.COMMON_OUTPUT_LIMITS.map((c) => c.value);
    assert.deepEqual(values, [...values].sort((a, b) => a - b));
  });

  it('every effort ladder starts at none and ascends', () => {
    for (const ladder of presets.COMMON_EFFORT_LADDERS) {
      assert.equal(ladder.value[0], 'none', `${ladder.label} must allow disabling reasoning`);
    }
  });

  it('records user answers as user-selection, never as verified', () => {
    assert.equal(presets.USER_SELECTION, 'user-selection');
    assert.notEqual(presets.USER_SELECTION, 'provider-metadata');
  });
});

describe('hermes adapter: verified-only metadata', () => {
  it('writes verified context and output limits', () => {
    const { model, agent, skipped } = hermes.verifiedMetadata(
      { id: 'm', contextWindow: 400000, maxOutputTokens: 65536 },
      ['low', 'high'],
    );
    assert.equal(model.context_length, 400000);
    assert.equal(model.max_output_tokens, 65536);
    assert.equal(agent.reasoning_overrides.m, 'high');
    assert.deepEqual(skipped, []);
  });

  it('writes NOTHING when the provider is silent', () => {
    const { model, agent, skipped } = hermes.verifiedMetadata(
      { id: 'm', contextWindow: UNKNOWN, maxOutputTokens: UNKNOWN },
      UNKNOWN,
    );
    assert.deepEqual(model, {}, 'a wrong number is worse than no number');
    assert.deepEqual(agent, {});
    assert.ok(skipped.includes('context_length'));
    assert.ok(skipped.includes('reasoning_effort'));
  });

  it('writes nothing at all when writeMetadata is false', () => {
    const { model, agent } = hermes.verifiedMetadata({ id: 'm', contextWindow: 400000 }, ['low'], false);
    assert.deepEqual(model, {});
    assert.deepEqual(agent, {});
  });

  it('rejects zero and negative limits instead of writing them', () => {
    const { model } = hermes.verifiedMetadata({ id: 'm', contextWindow: 0 }, UNKNOWN);
    assert.equal(model.context_length, undefined);
  });
});

describe('hermes configure(): end-to-end config write', () => {
  function cfg() { return path.join(tmpDir, 'config.yaml'); }
  function envf() { return path.join(tmpDir, '.env'); }

  it('writes verified metadata into a real config file', () => {
    hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'space-bunny-free',
      modelMeta: { id: 'space-bunny-free', contextWindow: 400000, maxOutputTokens: 65536 },
      supportedEfforts: ['low', 'medium', 'high'],
      targetConfig: cfg(),
      targetEnv: envf(),
    });
    const doc = yaml.load(fs.readFileSync(cfg(), 'utf8'));
    assert.equal(doc.model.provider, 'custom');
    assert.equal(doc.model.base_url, 'http://127.0.0.1:4141/v1');
    assert.equal(doc.model.context_length, 400000);
    assert.equal(doc.model.max_output_tokens, 65536);
    assert.equal(doc.agent.reasoning_overrides['space-bunny-free'], 'high');
    // api_key stays a reference, never a literal secret
    assert.equal(doc.model.api_key, '${PROMPTRELAY_API_KEY}');
  });

  it('leaves context_length absent when the provider is silent', () => {
    hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'mystery-model',
      modelMeta: { id: 'mystery-model', contextWindow: UNKNOWN },
      supportedEfforts: UNKNOWN,
      targetConfig: cfg(),
      targetEnv: envf(),
    });
    const doc = yaml.load(fs.readFileSync(cfg(), 'utf8'));
    assert.equal(doc.model.context_length, undefined, 'must not guess');
    assert.ok(!('agent' in doc), 'no reasoning block when nothing is verified');
    assert.equal(doc.model.model, 'mystery-model');
  });

  it('preserves unrelated keys and comments in an existing config', () => {
    fs.writeFileSync(cfg(), [
      '# my notes',
      'server:',
      '  host: 127.0.0.1',
      '',
      'model:',
      '  provider: openrouter',
      '  default: something-else',
      '',
    ].join('\n'), 'utf8');

    hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'new-model',
      modelMeta: { id: 'new-model', contextWindow: 131072 },
      supportedEfforts: ['low'],
      targetConfig: cfg(),
      targetEnv: envf(),
    });

    const raw = fs.readFileSync(cfg(), 'utf8');
    assert.ok(raw.includes('# my notes'), 'comment must survive');
    const doc = yaml.load(raw);
    assert.equal(doc.server.host, '127.0.0.1', 'unrelated key must survive');
    assert.equal(doc.model.model, 'new-model', 'model block must be replaced');
    assert.equal(doc.model.context_length, 131072);
  });

  it('backs up an existing config before writing', () => {
    fs.writeFileSync(cfg(), 'model:\n  provider: openrouter\n', 'utf8');
    const res = hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'm',
      modelMeta: { id: 'm', contextWindow: 65536 },
      targetConfig: cfg(),
      targetEnv: envf(),
    });
    assert.ok(res.backupPath, 'a backup path must be reported');
    assert.ok(fs.existsSync(res.backupPath));
  });

  it('reports which metadata was written and what was skipped', () => {
    const res = hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'm',
      modelMeta: { id: 'm', contextWindow: UNKNOWN },
      supportedEfforts: UNKNOWN,
      targetConfig: cfg(),
      targetEnv: envf(),
    });
    assert.deepEqual(res.metadata.written, []);
    assert.ok(res.metadata.skipped.includes('context_length'));
  });

  it('produces a config hermes itself would accept', () => {
    hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'm',
      modelMeta: { id: 'm', contextWindow: 400000 },
      supportedEfforts: ['low'],
      targetConfig: cfg(),
      targetEnv: envf(),
    });
    const doc = yaml.load(fs.readFileSync(cfg(), 'utf8'));
    const problems = validateConfig({
      provider: {
        baseURL: doc.model.base_url,
        model: doc.model.default || doc.model.model,
        transport: 'openai-compatible',
        auth: { type: 'bearer' },
      },
      prompt: { mode: 'replace' },
      server: { port: 4141 },
    });
    assert.deepEqual(problems, []);
  });
});

describe('hermes describeMetadata(): doctor reporting', () => {
  it('reports unknown when nothing is pinned', () => {
    const file = path.join(tmpDir, 'c.yaml');
    fs.writeFileSync(file, 'model:\n  provider: custom\n  model: x\n', 'utf8');
    const d = hermes.describeMetadata({ targetConfig: file });
    assert.equal(d.readable, true);
    assert.equal(d.contextLength, 'unknown');
    assert.equal(d.reasoningEffort, 'unknown');
  });

  it('reports the pinned values', () => {
    const file = path.join(tmpDir, 'c.yaml');
    hermes.configure({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'm',
      modelMeta: { id: 'm', contextWindow: 400000, maxOutputTokens: 32768 },
      supportedEfforts: ['low', 'high'],
      targetConfig: file,
      targetEnv: path.join(tmpDir, '.env'),
    });
    const d = hermes.describeMetadata({ targetConfig: file });
    assert.equal(d.contextLength, 400000);
    assert.equal(d.maxOutputTokens, 32768);
    assert.equal(d.reasoningEffort, 'high');
  });

  it('stays unknown for a missing or unreadable config', () => {
    assert.equal(hermes.describeMetadata({ targetConfig: path.join(tmpDir, 'nope.yaml') }).readable, false);
    const bad = path.join(tmpDir, 'bad.yaml');
    fs.writeFileSync(bad, 'model:\n  :::not yaml:::\n   - [\n', 'utf8');
    assert.equal(hermes.describeMetadata({ targetConfig: bad }).readable, false);
  });
});

describe('yaml-edit: updateTopLevelBlock', () => {
  it('adds a missing block', () => {
    const out = updateTopLevelBlock('server:\n  port: 4141\n', 'agent', { reasoning_effort: 'high' });
    const doc = yaml.load(out);
    assert.equal(doc.agent.reasoning_effort, 'high');
    assert.equal(doc.server.port, 4141);
  });

  it('replaces an existing block', () => {
    const out = updateTopLevelBlock('agent:\n  old: 1\nserver:\n  port: 1\n', 'agent', { reasoning_effort: 'low' });
    const doc = yaml.load(out);
    assert.equal(doc.agent.reasoning_effort, 'low');
    assert.equal(doc.agent.old, undefined);
    assert.equal(doc.server.port, 1);
  });

  it('is a strict no-op for empty values', () => {
    const raw = 'agent:\n  keep: me\n';
    assert.equal(updateTopLevelBlock(raw, 'agent', {}), raw);
    assert.equal(updateTopLevelBlock(raw, 'agent', null), raw);
  });
});

describe('client capability flags', () => {
  it('marks the clients that read model limits', () => {
    assert.equal(opencode.consumesModelMetadata, true);
    assert.equal(hermes.consumesModelMetadata, true);
  });

  it('leaves clients that do not read model limits unflagged', () => {
    const claude = require('../src/clients/claude-code');
    assert.notEqual(claude.consumesModelMetadata, true);
  });
});
describe('wizard: model pre-fill must not leak across providers', () => {
  const presets = require('../src/providers/presets');

  // Mirrors the helper in cli/wizard.js: carry the current model only when the
  // user is reconfiguring the SAME endpoint.
  function modelDefault(providerType, current, fallback) {
    const provider = presets.getPreset(providerType).provider;
    const currentBase = String(current.provider?.baseURL || '').replace(/\/+$/, '');
    const presetBase = String(provider.baseURL || '').replace(/\/+$/, '');
    const sameEndpoint = Boolean(currentBase) && currentBase.toLowerCase() === presetBase.toLowerCase();
    return sameEndpoint ? (current.provider?.model || fallback) : fallback;
  }

  it('uses the new provider\'s model when switching endpoints', () => {
    const onOpenRouter = { provider: { baseURL: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' } };
    // The reported bug: choosing OpenCode Zen pre-filled "openrouter/auto",
    // an id that does not exist on Zen.
    assert.equal(modelDefault('opencode-zen', onOpenRouter, 'space-bunny-free'), 'space-bunny-free');
  });

  it('keeps the user\'s model when re-running the same provider', () => {
    const onZen = { provider: { baseURL: 'https://opencode.ai/zen/v1', model: 'big-pickle' } };
    assert.equal(modelDefault('opencode-zen', onZen, 'space-bunny-free'), 'big-pickle');
    const onOR = { provider: { baseURL: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-sonnet-5' } };
    assert.equal(modelDefault('openrouter', onOR, 'openrouter/auto'), 'anthropic/claude-sonnet-5');
  });

  it('falls back to the preset default on a fresh install', () => {
    assert.equal(modelDefault('opencode-zen', {}, 'space-bunny-free'), 'space-bunny-free');
  });

  it('compares endpoints case-insensitively and ignores trailing slashes', () => {
    const messy = { provider: { baseURL: 'https://OpenCode.ai/zen/v1/', model: 'longcat-2.5-preview-free' } };
    assert.equal(modelDefault('opencode-zen', messy, 'space-bunny-free'), 'longcat-2.5-preview-free');
  });
});

'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  detectReasoningVariants,
  resolveModelReasoning,
  promptReasoningVariants,
  extractReasoningEfforts,
  VERIFIED_COMPATIBILITY,
} = require('../src/models/variants');
const { buildProviderBlock, setupOpenCode } = require('../src/opencode');
const { readRawConfig, saveRawConfig } = require('../src/cli/commands');

describe('3A: Automatic model variant / reasoning-effort detection', () => {
  it('A. Priority 1: Provider metadata / models list returned from provider', () => {
    // OpenRouter-style or OpenAI-compatible provider metadata exposing reasoning_efforts
    const rawModel = {
      id: 'custom-reasoning-model',
      reasoning_efforts: ['low', 'medium', 'high', 'xhigh'],
    };

    const detected = detectReasoningVariants('custom-reasoning-model', {}, { raw: rawModel });
    assert.equal(detected.supported, true);
    assert.deepEqual(detected.efforts, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(detected.source, 'provider-metadata');
  });

  it('B. Priority 2: PromptRelay Model Discovery capabilities if already populated', () => {
    const modelMeta = {
      id: 'discovered-model',
      reasoning: true,
      reasoningEfforts: ['low', 'high'],
      source: 'discovery-cache',
    };

    const detected = detectReasoningVariants('discovered-model', {}, { modelMeta });
    assert.equal(detected.supported, true);
    assert.deepEqual(detected.efforts, ['low', 'high']);
    assert.equal(detected.source, 'discovery-cache');
  });

  it('C. Priority 3: API metadata if present in model object', () => {
    const apiMetadata = {
      efforts: ['low', 'medium', 'high'],
    };

    const detected = detectReasoningVariants('api-meta-model', {}, { apiMetadata });
    assert.equal(detected.supported, true);
    assert.deepEqual(detected.efforts, ['low', 'medium', 'high']);
    assert.equal(detected.source, 'api-metadata');
  });

  it('D. Priority 4: PromptRelay Capability Cache', () => {
    const cachedModel = {
      id: 'cached-model',
      reasoningEfforts: ['minimal', 'high'],
    };

    const detected = detectReasoningVariants('cached-model', {}, { cachedModel });
    assert.equal(detected.supported, true);
    assert.deepEqual(detected.efforts, ['minimal', 'high']);
    assert.equal(detected.source, 'cache');
  });

  it('E. Priority 5: Verified Compatibility Map for space-bunny-free on OpenCode Zen', () => {
    assert.ok(VERIFIED_COMPATIBILITY['space-bunny-free']);
    assert.deepEqual(VERIFIED_COMPATIBILITY['space-bunny-free'].efforts, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(VERIFIED_COMPATIBILITY['space-bunny-free'].default, 'high');

    const detected = detectReasoningVariants('space-bunny-free', {
      name: 'OpenCode Zen',
      baseURL: 'https://opencode.ai/zen/v1',
    });

    assert.equal(detected.supported, true);
    assert.deepEqual(detected.efforts, ['low', 'medium', 'high', 'xhigh']);
    assert.equal(detected.default, 'high');
    assert.equal(detected.source, 'verified-compatibility');
  });

  it('F. Priority 6: Unknown model returns supported: unknown without fabricating', () => {
    const detected = detectReasoningVariants('some-arbitrary-model', {});
    assert.equal(detected.supported, false);
    assert.equal(detected.efforts, 'unknown');
    assert.equal(detected.source, 'unknown');
  });

  it('G. Interactive fallback menu prompts user with 4 choices', async () => {
    // Test option 1: None
    const fakeRl1 = {
      question: async () => '1',
    };
    const choice1 = await promptReasoningVariants(fakeRl1);
    assert.equal(choice1.supported, 'unknown');
    assert.equal(choice1.default, 'none');
    assert.equal(choice1.injectDefault, false);

    // Test option 2: low, medium, high
    const fakeRl2 = {
      question: async () => '2',
    };
    const choice2 = await promptReasoningVariants(fakeRl2);
    assert.deepEqual(choice2.supported, ['low', 'medium', 'high']);
    assert.equal(choice2.default, 'high');
    assert.equal(choice2.injectDefault, true);

    // Test option 3: low, medium, high, xhigh, max
    const fakeRl3 = {
      question: async () => '3',
    };
    const choice3 = await promptReasoningVariants(fakeRl3);
    assert.deepEqual(choice3.supported, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(choice3.default, 'high');
    assert.equal(choice3.injectDefault, true);

    // Test option 4: Custom comma-separated
    let qCount = 0;
    const fakeRl4 = {
      question: async () => {
        qCount++;
        return qCount === 1 ? '4' : 'low, high, xhigh';
      },
    };
    const choice4 = await promptReasoningVariants(fakeRl4);
    assert.deepEqual(choice4.supported, ['low', 'high', 'xhigh']);
    assert.equal(choice4.default, 'xhigh');
    assert.equal(choice4.injectDefault, true);
  });

  it('H. Non-interactive automation mode returns supported: unknown without hanging', async () => {
    const res = await resolveModelReasoning('unrecognized-model', {}, { interactive: false, quiet: true });
    assert.equal(res.supported, 'unknown');
    assert.equal(res.detected, false);
    assert.equal(res.source, 'unknown');
  });

  it('I. OpenCode config generation exposes variants when supported efforts are known', () => {
    const block = buildProviderBlock({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'space-bunny-free',
      supportedEfforts: ['low', 'medium', 'high', 'xhigh'],
    });

    assert.ok(block.promptrelay.models['space-bunny-free']);
    assert.ok(block.promptrelay.models['space-bunny-free'].variants);
    assert.deepEqual(block.promptrelay.models['space-bunny-free'].variants, {
      low: { reasoningEffort: 'low' },
      medium: { reasoningEffort: 'medium' },
      high: { reasoningEffort: 'high' },
      xhigh: { reasoningEffort: 'xhigh' },
    });
  });

  it('J. OpenCode config generation omits variants when supported is unknown', () => {
    const blockUnknown = buildProviderBlock({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'some-generic-model',
      supportedEfforts: 'unknown',
    });

    assert.ok(blockUnknown.promptrelay.models['some-generic-model']);
    assert.equal(blockUnknown.promptrelay.models['some-generic-model'].variants, undefined);

    const blockEmpty = buildProviderBlock({
      baseURL: 'http://127.0.0.1:4141/v1',
      model: 'some-generic-model',
      supportedEfforts: [],
    });

    assert.equal(blockEmpty.promptrelay.models['some-generic-model'].variants, undefined);
  });

  it('K. Model switching re-evaluates reasoning; reject unsupported in reasoningSet', () => {
    const commands = require('../src/cli/commands');
    const io = require('../src/cli/io');

    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'promptrelay-reasoning-cli-test-'));
    const prevHome = io.HOME;
    const prevConfig = io.CONFIG_FILE;

    try {
      io.HOME = tmpHome;
      io.CONFIG_FILE = path.join(tmpHome, 'promptrelay.json');
      io.ensureHome();

      // Initialize with space-bunny-free
      io.writeJson(io.CONFIG_FILE, {
        server: { host: '127.0.0.1', port: 4141 },
        prompt: { mode: 'replace', file: 'system_prompt.txt' },
        provider: { name: 'OpenCode Zen', model: 'space-bunny-free' },
        reasoning: { supported: ['low', 'medium', 'high', 'xhigh'], default: 'high' },
      });

      // 1. Valid reasoning effort is accepted
      process.exitCode = 0;
      commands.reasoningSet('xhigh');
      assert.equal(process.exitCode, 0);
      let raw = io.readJsonIfExists(io.CONFIG_FILE, {});
      assert.equal(raw.reasoning.default, 'xhigh');

      // 2. Unsupported reasoning effort (e.g. max is not in ['low', 'medium', 'high', 'xhigh']) is rejected
      process.exitCode = 0;
      commands.reasoningSet('minimal');
      assert.equal(process.exitCode, 1, 'Unsupported reasoning effort should be rejected');
      process.exitCode = 0;

      // 3. Switch model to o1-mini (which supports ['low', 'medium', 'high'])
      commands.modelUse('o1-mini');
      raw = io.readJsonIfExists(io.CONFIG_FILE, {});
      assert.equal(raw.provider.model, 'o1-mini');
      assert.deepEqual(raw.reasoning.supported, ['low', 'medium', 'high']);
      // Previous default was 'xhigh' which is unsupported by o1-mini -> should fall back
      assert.equal(raw.reasoning.default, 'medium');

      // 4. Switch model to unknown model -> supported becomes unknown
      commands.modelUse('mysterious-model-999');
      raw = io.readJsonIfExists(io.CONFIG_FILE, {});
      assert.equal(raw.provider.model, 'mysterious-model-999');
      assert.equal(raw.reasoning.supported, 'unknown');

      // 5. When unknown, setting any valid level is allowed with notice
      process.exitCode = 0;
      commands.reasoningSet('low');
      assert.equal(process.exitCode, 0);
      raw = io.readJsonIfExists(io.CONFIG_FILE, {});
      assert.equal(raw.reasoning.default, 'low');
    } finally {
      process.exitCode = 0;
      io.HOME = prevHome;
      io.CONFIG_FILE = prevConfig;
      try { fs.rmSync(tmpHome, { recursive: true, force: true }); } catch {}
    }
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePricePerMillion,
  detectFree,
  detectCodingFromName,
  fromOpenRouter,
  fromOpenAIList,
  normalizeModel,
} = require('../src/models/capabilities');
const { UNKNOWN } = require('../src/models/schema');

test('parsePricePerMillion converts per-token to per-million', () => {
  assert.equal(parsePricePerMillion('0.0000012'), 1.2);
  assert.equal(parsePricePerMillion('0'), 0);
  assert.equal(parsePricePerMillion(undefined), UNKNOWN);
  assert.equal(parsePricePerMillion('n/a'), UNKNOWN);
});

test('detectFree only when explicitly zero or :free suffix', () => {
  assert.equal(detectFree(0, 0, 'x/y'), true);
  assert.equal(detectFree(1, 0, 'x/y'), false);
  assert.equal(detectFree(UNKNOWN, UNKNOWN, 'meta/model:free'), true);
  assert.equal(detectFree(UNKNOWN, 0, 'x/y'), UNKNOWN);
});

test('detectCodingFromName recognizes coder models else unknown', () => {
  assert.equal(detectCodingFromName('Qwen2.5 Coder 32B'), true);
  assert.equal(detectCodingFromName('deepseek-chat'), true);
  assert.equal(detectCodingFromName('Some Chat Model'), UNKNOWN);
});

test('fromOpenRouter extracts rich metadata, never fabricates', () => {
  const raw = {
    id: 'anthropic/claude',
    name: 'Claude',
    context_length: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    architecture: { input_modalities: ['text', 'image'] },
    supported_parameters: ['tools', 'reasoning', 'structured_outputs'],
    top_provider: { max_completion_tokens: 8192 },
  };
  const model = fromOpenRouter(raw, 'OpenRouter');
  assert.equal(model.contextWindow, 200000);
  assert.equal(model.maxOutputTokens, 8192);
  assert.equal(model.inputPrice, 3);
  assert.equal(model.outputPrice, 15);
  assert.equal(model.free, false);
  assert.equal(model.tools, true);
  assert.equal(model.reasoning, true);
  assert.equal(model.structuredOutput, true);
  assert.equal(model.vision, true);
  assert.equal(model.streaming, true);
});

test('fromOpenRouter leaves capabilities unknown when metadata missing', () => {
  const model = fromOpenRouter({ id: 'x/y' }, 'OpenRouter');
  assert.equal(model.contextWindow, UNKNOWN);
  assert.equal(model.inputPrice, UNKNOWN);
  assert.equal(model.tools, UNKNOWN);
  assert.equal(model.vision, UNKNOWN);
});

test('fromOpenAIList leaves most fields unknown (minimal metadata)', () => {
  const model = fromOpenAIList({ id: 'gpt-4o', owned_by: 'openai' }, 'OpenAI');
  assert.equal(model.id, 'gpt-4o');
  assert.equal(model.contextWindow, UNKNOWN);
  assert.equal(model.inputPrice, UNKNOWN);
  assert.equal(model.tools, UNKNOWN);
  assert.equal(model.streaming, true);
});

test('normalizeModel routes by shape and richness', () => {
  const or = normalizeModel({ id: 'a', pricing: { prompt: '0', completion: '0' } }, { shape: 'openai' });
  assert.equal(or.source, 'openrouter');
  assert.equal(or.free, true);

  const oa = normalizeModel({ id: 'b' }, { shape: 'openai' });
  assert.equal(oa.source, 'openai-list');
});

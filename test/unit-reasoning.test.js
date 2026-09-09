'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  LEVELS,
  normalizeReasoning,
  toOpenAIEffort,
  toOllamaThink,
  incomingReasoning,
  autoReasoning,
  applyOpenAIReasoning,
} = require('../src/reasoning');

test('LEVELS are the six canonical levels in effort order', () => {
  assert.deepEqual(LEVELS, ['none', 'minimal', 'low', 'medium', 'high', 'max']);
});

test('normalizeReasoning maps aliases and booleans', () => {
  assert.equal(normalizeReasoning('off'), 'none');
  assert.equal(normalizeReasoning('MIN'), 'minimal');
  assert.equal(normalizeReasoning('thinking'), 'high');
  assert.equal(normalizeReasoning('extreme'), 'max');
  assert.equal(normalizeReasoning(true), 'high');
  assert.equal(normalizeReasoning(false), 'none');
  assert.equal(normalizeReasoning('bogus', 'low'), 'low');
  assert.equal(normalizeReasoning('', 'medium'), 'medium');
});

test('toOpenAIEffort maps levels; none/max handled correctly', () => {
  assert.equal(toOpenAIEffort('none'), null);
  assert.equal(toOpenAIEffort('minimal'), 'minimal');
  assert.equal(toOpenAIEffort('low'), 'low');
  assert.equal(toOpenAIEffort('medium'), 'medium');
  assert.equal(toOpenAIEffort('high'), 'high');
  assert.equal(toOpenAIEffort('max'), 'high');
});

test('toOllamaThink maps levels to boolean/level', () => {
  assert.equal(toOllamaThink('none'), false);
  assert.equal(toOllamaThink('minimal'), 'low');
  assert.equal(toOllamaThink('low'), 'low');
  assert.equal(toOllamaThink('medium'), 'medium');
  assert.equal(toOllamaThink('high'), 'high');
  assert.equal(toOllamaThink('max'), 'high');
});

test('incomingReasoning honors explicit request then config default', () => {
  const config = { reasoning: { default: 'low', auto: false } };
  assert.equal(incomingReasoning({ reasoning_effort: 'high' }, config), 'high');
  assert.equal(incomingReasoning({ think: 'off' }, config), 'none');
  assert.equal(incomingReasoning({}, config), 'low');
});

test('autoReasoning escalates for tools and long input', () => {
  const config = { reasoning: { default: 'low', auto: true } };
  assert.equal(autoReasoning({ tools: [{ type: 'function' }], messages: [] }, config), 'high');
  assert.equal(autoReasoning({ messages: [{ role: 'user', content: 'x'.repeat(2500) }] }, config), 'high');
  assert.equal(autoReasoning({ messages: [{ role: 'user', content: 'x'.repeat(500) }] }, config), 'medium');
  assert.equal(autoReasoning({ messages: [{ role: 'user', content: 'hi' }] }, config), 'low');
});

test('applyOpenAIReasoning strips PromptRelay-only fields and injects default', () => {
  const injected = applyOpenAIReasoning(
    { messages: [], think: 'high', reasoning: { effort: 'low' } },
    { reasoning: { default: 'medium', injectDefault: true } },
  );
  assert.equal('think' in injected, false);
  assert.equal('reasoning' in injected, false);
  // Explicit reasoning.effort=low wins over injectDefault.
  assert.equal(injected.reasoning_effort, 'low');

  const defaulted = applyOpenAIReasoning(
    { messages: [] },
    { reasoning: { default: 'medium', injectDefault: true } },
  );
  assert.equal(defaulted.reasoning_effort, 'medium');

  const none = applyOpenAIReasoning(
    { messages: [] },
    { reasoning: { default: 'none', injectDefault: true } },
  );
  assert.equal('reasoning_effort' in none, false);
});

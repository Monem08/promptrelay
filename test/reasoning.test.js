const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeReasoning, toOllamaThink, applyOpenAIReasoning } = require('../src/reasoning');

test('reasoning aliases normalize', () => {
  assert.equal(normalizeReasoning('fast'), 'none');
  assert.equal(normalizeReasoning('thinking'), 'high');
  assert.equal(normalizeReasoning('xhigh'), 'max');
});

test('none becomes false for Ollama native', () => {
  assert.equal(toOllamaThink('none'), false);
  assert.equal(toOllamaThink('high'), 'high');
});

test('OpenAI reasoning camelCase is normalized', () => {
  const out = applyOpenAIReasoning(
    { reasoningEffort: 'high' },
    { reasoning: { default: 'low', injectDefault: false } },
  );
  assert.equal(out.reasoning_effort, 'high');
  assert.equal('reasoningEffort' in out, false);
});

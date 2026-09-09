'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  openaiRequestToIR,
  irToOpenAIRequest,
  openaiResponseToIR,
  irToOpenAIResponse,
  anthropicRequestToIR,
  irToAnthropicRequest,
  anthropicResponseToIR,
  irToAnthropicResponse,
  DEFAULT_MAX_TOKENS,
  BLOCK,
} = require('../src/ir');

// ---------------------------------------------------------------------------
// OpenAI request <-> IR
// ---------------------------------------------------------------------------

test('openaiRequestToIR merges system/developer messages into ir.system', () => {
  const ir = openaiRequestToIR({
    model: 'gpt-x',
    messages: [
      { role: 'system', content: 'Be terse.' },
      { role: 'developer', content: 'Prefer TypeScript.' },
      { role: 'user', content: 'hi' },
    ],
  });
  assert.equal(ir.protocol, 'openai');
  assert.equal(ir.model, 'gpt-x');
  assert.equal(ir.system, 'Be terse.\n\nPrefer TypeScript.');
  assert.equal(ir.messages.length, 1);
  assert.equal(ir.messages[0].role, 'user');
  assert.equal(ir.messages[0].content[0].text, 'hi');
});

test('openai tool call + tool result survive the IR round trip', () => {
  const ir = openaiRequestToIR({
    model: 'gpt-x',
    messages: [
      { role: 'user', content: 'weather?' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '18C' },
    ],
  });
  const toolCall = ir.messages[1].content.find((b) => b.type === BLOCK.TOOL_CALL);
  assert.equal(toolCall.name, 'get_weather');
  assert.deepEqual(toolCall.arguments, { city: 'Paris' });
  const toolMsg = ir.messages.find((m) => m.role === 'tool');
  assert.equal(toolMsg.content[0].toolCallId, 'call_1');

  const body = irToOpenAIRequest(ir);
  const asst = body.messages.find((m) => m.role === 'assistant');
  assert.equal(asst.tool_calls[0].function.name, 'get_weather');
  assert.equal(asst.tool_calls[0].function.arguments, '{"city":"Paris"}');
  const tool = body.messages.find((m) => m.role === 'tool');
  assert.equal(tool.tool_call_id, 'call_1');
  assert.equal(tool.content, '18C');
});

test('openai generation params map into IR and back without fabrication', () => {
  const ir = openaiRequestToIR({ model: 'm', messages: [{ role: 'user', content: 'x' }], temperature: 0.2, max_tokens: 100, stop: ['END'] });
  assert.equal(ir.generation.temperature, 0.2);
  assert.equal(ir.generation.maxTokens, 100);
  assert.deepEqual(ir.generation.stop, ['END']);
  // A field that was not present must remain absent.
  assert.equal(ir.generation.topP, undefined);
  const body = irToOpenAIRequest(ir);
  assert.equal(body.temperature, 0.2);
  assert.equal(body.max_tokens, 100);
  assert.equal('top_p' in body, false);
});

// ---------------------------------------------------------------------------
// Anthropic request <-> IR
// ---------------------------------------------------------------------------

test('anthropicRequestToIR lifts top-level system into ir.system', () => {
  const ir = anthropicRequestToIR({
    model: 'claude-x',
    system: 'You are helpful.',
    max_tokens: 256,
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(ir.protocol, 'anthropic');
  assert.equal(ir.system, 'You are helpful.');
  assert.equal(ir.generation.maxTokens, 256);
});

test('anthropic tool_result blocks become their own role:tool IR message', () => {
  const ir = anthropicRequestToIR({
    model: 'claude-x',
    max_tokens: 100,
    messages: [
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '18C' }] },
    ],
  });
  const toolMsg = ir.messages.find((m) => m.role === 'tool');
  assert.ok(toolMsg, 'a role:tool message should exist');
  assert.equal(toolMsg.content[0].toolCallId, 'toolu_1');
  assert.equal(toolMsg.content[0].content, '18C');
});

test('irToAnthropicRequest supplies default max_tokens only when client omits it', () => {
  const irNoMax = anthropicRequestToIR({ model: 'c', messages: [{ role: 'user', content: 'hi' }] });
  const bodyDefault = irToAnthropicRequest(irNoMax);
  assert.equal(bodyDefault.max_tokens, DEFAULT_MAX_TOKENS);

  const irWithMax = anthropicRequestToIR({ model: 'c', max_tokens: 512, messages: [{ role: 'user', content: 'hi' }] });
  const bodyExplicit = irToAnthropicRequest(irWithMax);
  assert.equal(bodyExplicit.max_tokens, 512);
});

test('irToAnthropicRequest merges consecutive user/tool turns into alternating turns', () => {
  const ir = anthropicRequestToIR({
    model: 'c',
    max_tokens: 100,
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'fn', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'text', text: 'thanks' }] },
    ],
  });
  const body = irToAnthropicRequest(ir);
  const userTurns = body.messages.filter((m) => m.role === 'user');
  // tool_result + trailing user text must collapse into a single user turn.
  assert.equal(userTurns.length, 1);
  const types = userTurns[0].content.map((b) => b.type);
  assert.deepEqual(types, ['tool_result', 'text']);
});

test('anthropic thinking is only enabled when reasoning is explicit', () => {
  const irPlain = anthropicRequestToIR({ model: 'c', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] });
  assert.equal('thinking' in irToAnthropicRequest(irPlain), false);

  const irThink = anthropicRequestToIR({
    model: 'c', max_tokens: 100, thinking: { type: 'enabled', budget_tokens: 8000 },
    messages: [{ role: 'user', content: 'hi' }],
  });
  const body = irToAnthropicRequest(irThink);
  assert.equal(body.thinking.type, 'enabled');
  assert.equal(body.thinking.budget_tokens, 8000);
  assert.ok(body.max_tokens > 8000, 'max_tokens must exceed the thinking budget');
});

// ---------------------------------------------------------------------------
// Cross-protocol translation (the core value of the IR)
// ---------------------------------------------------------------------------

test('OpenAI request -> IR -> Anthropic request preserves system + content', () => {
  const ir = openaiRequestToIR({
    model: 'gpt-x',
    messages: [
      { role: 'system', content: 'Sys.' },
      { role: 'user', content: 'Hello' },
    ],
    max_tokens: 200,
  });
  const anthropicBody = irToAnthropicRequest(ir);
  assert.equal(anthropicBody.system, 'Sys.');
  assert.equal(anthropicBody.max_tokens, 200);
  assert.equal(anthropicBody.messages[0].role, 'user');
  assert.equal(anthropicBody.messages[0].content[0].text, 'Hello');
});

test('Anthropic request -> IR -> OpenAI request re-emits system as a message', () => {
  const ir = anthropicRequestToIR({
    model: 'claude-x',
    system: 'Sys.',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'Hello' }],
  });
  const openaiBody = irToOpenAIRequest(ir);
  assert.equal(openaiBody.messages[0].role, 'system');
  assert.equal(openaiBody.messages[0].content, 'Sys.');
  assert.equal(openaiBody.messages[1].role, 'user');
  assert.equal(openaiBody.messages[1].content, 'Hello');
});

// ---------------------------------------------------------------------------
// Response translation both directions
// ---------------------------------------------------------------------------

test('OpenAI response -> IR -> Anthropic response maps stop reason + usage', () => {
  const ir = openaiResponseToIR({
    id: 'chatcmpl-1',
    model: 'gpt-x',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  });
  assert.equal(ir.content[0].text, 'Hi there');
  assert.equal(ir.stopReason, 'stop');
  assert.equal(ir.usage.inputTokens, 10);
  assert.equal(ir.usage.outputTokens, 3);

  const anthropic = irToAnthropicResponse(ir);
  assert.equal(anthropic.type, 'message');
  assert.equal(anthropic.content[0].text, 'Hi there');
  assert.equal(anthropic.stop_reason, 'end_turn');
  assert.equal(anthropic.usage.input_tokens, 10);
  assert.equal(anthropic.usage.output_tokens, 3);
});

test('Anthropic tool_use response -> IR -> OpenAI tool_calls', () => {
  const ir = anthropicResponseToIR({
    id: 'msg_1',
    model: 'claude-x',
    content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: 'Paris' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 12, output_tokens: 6 },
  });
  assert.equal(ir.stopReason, 'tool_calls');
  const openai = irToOpenAIResponse(ir);
  assert.equal(openai.choices[0].finish_reason, 'tool_calls');
  const tc = openai.choices[0].message.tool_calls[0];
  assert.equal(tc.function.name, 'get_weather');
  assert.equal(tc.function.arguments, '{"city":"Paris"}');
});

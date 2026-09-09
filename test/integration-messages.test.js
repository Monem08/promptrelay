'use strict';

// Ingress tests: an Anthropic-Messages client (e.g. Claude Code) talks to
// PromptRelay's POST /v1/messages. We exercise both egress directions:
//  - Anthropic ingress  -> OpenAI-compatible upstream (cross translation)
//  - Anthropic ingress  -> Anthropic-native upstream (same protocol)

const test = require('node:test');
const assert = require('node:assert/strict');

const { openAICompatible, anthropicNative } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

test('anthropic ingress -> openai upstream: non-stream returns Anthropic shape', async () => {
  const upstream = await openAICompatible({ content: 'Hello back' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-x', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.type, 'message');
    assert.equal(json.role, 'assistant');
    assert.equal(json.content[0].type, 'text');
    assert.equal(json.content[0].text, 'Hello back');
    assert.equal(json.stop_reason, 'end_turn');
    // The upstream must have received an OpenAI chat request.
    const call = upstream.requests.find((r) => r.url.includes('/chat/completions'));
    assert.ok(call, 'upstream should get an OpenAI chat request');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('anthropic ingress -> openai upstream: streaming yields Anthropic SSE sequence', async () => {
  const upstream = await openAICompatible({ content: 'streamed' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-x', max_tokens: 100, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    const text = await res.text();
    // The required Anthropic event sequence must be present and ordered.
    assert.match(text, /event: message_start/);
    assert.match(text, /event: content_block_start/);
    assert.match(text, /event: content_block_delta/);
    assert.match(text, /event: content_block_stop/);
    assert.match(text, /event: message_delta/);
    assert.match(text, /event: message_stop/);
    assert.ok(text.indexOf('message_start') < text.indexOf('message_stop'), 'message_start precedes message_stop');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('anthropic ingress -> anthropic upstream: native path preserves content + usage', async () => {
  const upstream = await anthropicNative({ content: 'Native reply' });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, transport: 'anthropic-native' });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-x', max_tokens: 100, messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.content[0].text, 'Native reply');
    assert.equal(json.usage.input_tokens, 12);
    assert.equal(json.usage.output_tokens, 6);
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('anthropic ingress -> anthropic upstream: tool_use round-trips', async () => {
  const upstream = await anthropicNative({ tool: { name: 'get_weather', input: { city: 'Paris' } } });
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, transport: 'anthropic-native' });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-x',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'weather?' }],
        tools: [{ name: 'get_weather', description: 'get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.stop_reason, 'tool_use');
    const toolUse = json.content.find((b) => b.type === 'tool_use');
    assert.equal(toolUse.name, 'get_weather');
    assert.deepEqual(toolUse.input, { city: 'Paris' });
  } finally {
    await gw.close();
    await upstream.close();
  }
});

test('anthropic ingress rejects a request with no messages array (400)', async () => {
  const upstream = await openAICompatible();
  const gw = await startGateway({ baseURL: `${upstream.url}/v1` });
  try {
    const res = await fetch(`${gw.url}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-x', max_tokens: 100 }),
    });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.type, 'error');
  } finally {
    await gw.close();
    await upstream.close();
  }
});

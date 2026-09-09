'use strict';

// Egress tests: an OpenAI-compatible client talks to PromptRelay, which relays
// to an Anthropic-native upstream. Exercises the protocol translation layer end
// to end through the real server app + a mock Anthropic server.

const test = require('node:test');
const assert = require('node:assert/strict');

const { anthropicNative } = require('../src/testing/mock-server');
const { startGateway } = require('../src/testing/harness');

const FAST_RETRY = { enabled: true, maxRetries: 2, baseDelayMs: 5, maxDelayMs: 20, retryableStatus: [429, 500, 502, 503, 504, 529] };

async function withAnthropic(options, run, gwConfig = {}) {
  const upstream = await anthropicNative(options);
  const gw = await startGateway({ baseURL: `${upstream.url}/v1`, transport: 'anthropic-native', ...gwConfig });
  try {
    await run({ gw, upstream });
  } finally {
    await gw.close();
    await upstream.close();
  }
}

test('openai client -> anthropic upstream: non-stream chat', async () => {
  await withAnthropic({ content: 'Bonjour' }, async ({ gw, upstream }) => {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.object, 'chat.completion');
    assert.equal(json.choices[0].message.content, 'Bonjour');
    assert.equal(json.choices[0].finish_reason, 'stop');
    // The upstream must have received an Anthropic Messages request.
    const call = upstream.requests.find((r) => r.method === 'POST' && r.url.includes('/messages'));
    assert.ok(call, 'upstream should receive POST /v1/messages');
    assert.equal(call.headers['anthropic-version'], '2023-06-01');
    assert.ok(call.body.max_tokens, 'max_tokens must be present on the Anthropic request');
  });
});

test('openai client -> anthropic upstream: streaming chat yields OpenAI SSE', async () => {
  await withAnthropic({ content: 'streamed reply' }, async ({ gw }) => {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    const text = await res.text();
    assert.match(text, /"object":"chat\.completion\.chunk"/);
    assert.match(text, /data: \[DONE\]/);
    // Reassemble the streamed content.
    const content = text.split('\n')
      .filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'))
      .map((l) => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
      .filter(Boolean)
      .map((o) => o.choices?.[0]?.delta?.content || '')
      .join('');
    assert.equal(content, 'streamed reply');
  });
});

test('openai client -> anthropic upstream: tool call is translated', async () => {
  await withAnthropic({ tool: { name: 'get_weather', input: { city: 'Paris' } } }, async ({ gw, upstream }) => {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'weather in Paris?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'get weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }],
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.choices[0].finish_reason, 'tool_calls');
    const tc = json.choices[0].message.tool_calls[0];
    assert.equal(tc.function.name, 'get_weather');
    assert.deepEqual(JSON.parse(tc.function.arguments), { city: 'Paris' });
    // Upstream must have received Anthropic-shaped tools (input_schema).
    const call = upstream.requests.find((r) => r.url.includes('/messages'));
    assert.ok(Array.isArray(call.body.tools));
    assert.ok(call.body.tools[0].input_schema, 'tools should carry input_schema on the Anthropic request');
  });
});

test('openai client -> anthropic upstream: retry recovers after 529 overload', async () => {
  await withAnthropic(
    { failTimes: 2, failStatus: 529, content: 'recovered' },
    async ({ gw, upstream }) => {
      const res = await fetch(`${gw.url}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.choices[0].message.content, 'recovered');
      const calls = upstream.requests.filter((r) => r.method === 'POST' && r.url.includes('/messages'));
      assert.equal(calls.length, 3, 'expected 2 failures + 1 success');
    },
    { config: { retry: FAST_RETRY } },
  );
});

test('anthropic upstream models are discoverable through the gateway', async () => {
  await withAnthropic({}, async ({ gw }) => {
    const res = await fetch(`${gw.url}/v1/models`);
    assert.equal(res.status, 200);
    const json = await res.json();
    const ids = (json.data || []).map((m) => m.id);
    assert.ok(ids.includes('claude-sonnet-4-20250514'), 'expected the mock Claude model to be listed');
  });
});

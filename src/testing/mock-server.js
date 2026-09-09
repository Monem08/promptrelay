'use strict';

/**
 * Test helpers: lightweight mock upstream providers built on the core http
 * module (no dependencies). Used by adapter and integration tests to exercise
 * PromptRelay against controllable OpenAI-compatible and Ollama-native servers.
 */

const http = require('http');

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/**
 * Start an HTTP server from a request handler and resolve with { url, port,
 * server, close, requests }. Every parsed request body is recorded in
 * `requests` for assertions.
 */
function startServer(handler) {
  return new Promise((resolve) => {
    const requests = [];
    const server = http.createServer(async (req, res) => {
      const body = await readBody(req);
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      handler(req, res, body, requests);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

/**
 * A configurable OpenAI-compatible mock. Options:
 *  - models: array returned by GET /v1/models (data[])
 *  - failTimes: number of leading /chat/completions calls that return `failStatus`
 *  - failStatus: status for the forced failures (default 503)
 *  - retryAfter: value for the Retry-After header on failures
 *  - stream: when true, respond to streaming requests with SSE chunks
 */
function openAICompatible(options = {}) {
  const {
    models = [{ id: 'mock-model', object: 'model', owned_by: 'mock' }],
    failTimes = 0,
    failStatus = 503,
    retryAfter,
    content = 'Hello from mock',
  } = options;

  let chatCalls = 0;

  return startServer((req, res, body) => {
    if (req.method === 'GET' && req.url.replace(/\/+$/, '').endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    if (req.method === 'POST' && req.url.includes('/chat/completions')) {
      chatCalls += 1;
      if (chatCalls <= failTimes) {
        const headers = { 'content-type': 'application/json' };
        if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);
        res.writeHead(failStatus, headers);
        res.end(JSON.stringify({ error: { message: 'temporary', type: 'server_error' } }));
        return;
      }

      if (body.stream) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const chunk = {
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: { content }, finish_reason: null }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        const done = {
          id: 'chatcmpl-mock',
          object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        };
        res.write(`data: ${JSON.stringify(done)}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      const toolCall = Array.isArray(body.tools) && body.tools.length
        ? [{ id: 'call_1', type: 'function', function: { name: body.tools[0].function?.name || 'fn', arguments: '{}' } }]
        : undefined;

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: body.model || 'mock-model',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: toolCall ? null : content, tool_calls: toolCall },
          finish_reason: toolCall ? 'tool_calls' : 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
}

/**
 * A configurable Ollama-native mock: GET /v1/models (OpenAI-shaped list) and
 * POST /api/chat (NDJSON streaming of message deltas).
 */
function ollamaNative(options = {}) {
  const {
    models = [{ id: 'llama3', object: 'model' }],
    content = 'Hi from ollama',
    thinking,
    tool,
  } = options;

  return startServer((req, res, body) => {
    if (req.method === 'GET' && req.url.includes('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models }));
      return;
    }

    if (req.method === 'POST' && req.url.includes('/api/chat')) {
      const model = body.model || 'llama3';
      const message = { role: 'assistant', content };
      if (thinking) message.thinking = thinking;
      if (tool) message.tool_calls = [{ function: { name: tool.name, arguments: tool.arguments || {} } }];

      // Ollama returns a single JSON object when stream:false, NDJSON otherwise.
      if (body.stream !== true) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          model,
          message,
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 8,
          eval_count: 4,
        }));
        return;
      }

      res.writeHead(200, { 'content-type': 'application/x-ndjson' });
      if (thinking) {
        res.write(`${JSON.stringify({ model, message: { role: 'assistant', thinking }, done: false })}\n`);
      }
      if (tool) {
        res.write(`${JSON.stringify({ model, message: { role: 'assistant', tool_calls: message.tool_calls }, done: false })}\n`);
      }
      // Emit the content in two pieces to exercise chunk assembly.
      const mid = Math.ceil(content.length / 2);
      res.write(`${JSON.stringify({ model, message: { role: 'assistant', content: content.slice(0, mid) }, done: false })}\n`);
      res.write(`${JSON.stringify({
        model,
        message: { role: 'assistant', content: content.slice(mid) },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 8,
        eval_count: 4,
      })}\n`);
      res.end();
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'not found' } }));
  });
}

/**
 * A configurable Anthropic-native mock: GET /v1/models and POST /v1/messages
 * (both non-stream JSON and the Anthropic SSE event sequence). Options:
 *  - models: array returned by GET /v1/models (data[])
 *  - content: assistant text
 *  - thinking: when set, emits a thinking block/delta
 *  - tool: { name, input } to emit a tool_use block
 *  - failTimes/failStatus/retryAfter: force leading failures (retry testing)
 */
function anthropicNative(options = {}) {
  const {
    models = [{ id: 'claude-sonnet-4-20250514', type: 'model', display_name: 'Claude Sonnet 4' }],
    content = 'Hello from Claude mock',
    thinking,
    tool,
    failTimes = 0,
    failStatus = 529,
    retryAfter,
  } = options;

  let calls = 0;

  return startServer((req, res, body) => {
    const path = req.url.replace(/\/+$/, '');
    if (req.method === 'GET' && path.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: models, has_more: false }));
      return;
    }

    if (req.method === 'POST' && req.url.includes('/messages')) {
      calls += 1;
      if (calls <= failTimes) {
        const headers = { 'content-type': 'application/json' };
        if (retryAfter !== undefined) headers['retry-after'] = String(retryAfter);
        res.writeHead(failStatus, headers);
        res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'temporary' } }));
        return;
      }

      const model = body.model || 'claude-sonnet-4-20250514';

      if (body.stream === true) {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        send('message_start', {
          type: 'message_start',
          message: { id: 'msg_mock', type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 0 } },
        });
        let index = 0;
        if (thinking) {
          send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '' } });
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } });
          send('content_block_stop', { type: 'content_block_stop', index });
          index += 1;
        }
        if (tool) {
          send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'tool_use', id: 'toolu_mock', name: tool.name, input: {} } });
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(tool.input || {}) } });
          send('content_block_stop', { type: 'content_block_stop', index });
          index += 1;
          send('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 7 } });
        } else {
          send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
          const mid = Math.ceil(content.length / 2);
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: content.slice(0, mid) } });
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: content.slice(mid) } });
          send('content_block_stop', { type: 'content_block_stop', index });
          send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } });
        }
        send('message_stop', { type: 'message_stop' });
        res.end();
        return;
      }

      const blocks = [];
      if (thinking) blocks.push({ type: 'thinking', thinking });
      if (tool) blocks.push({ type: 'tool_use', id: 'toolu_mock', name: tool.name, input: tool.input || {} });
      else blocks.push({ type: 'text', text: content });

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'msg_mock',
        type: 'message',
        role: 'assistant',
        model,
        content: blocks,
        stop_reason: tool ? 'tool_use' : 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 6 },
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { message: 'not found' } }));
  });
}

module.exports = { startServer, openAICompatible, ollamaNative, anthropicNative };

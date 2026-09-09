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

module.exports = { startServer, openAICompatible, ollamaNative };

const crypto = require('crypto');
const { applyPromptPolicy } = require('../prompt');
const { incomingReasoning, toOllamaThink } = require('../reasoning');
const { providerHeaders, resolveModel, createAbortController } = require('../http');

function randomID(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
}

function unixTime() {
  return Math.floor(Date.now() / 1000);
}

function joinURL(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

function safeJSONString(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value ?? {}); } catch { return '{}'; }
}

function parseArguments(value) {
  if (value === null || value === undefined) return {};
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return { value }; }
  }
  return { value };
}

function buildToolCallNameMap(messages) {
  const map = new Map();
  if (!Array.isArray(messages)) return map;

  for (const message of messages) {
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (call?.id && call?.function?.name) map.set(call.id, call.function.name);
    }
  }
  return map;
}

function convertContent(content) {
  if (content === null || content === undefined) return { content: '', images: [] };
  if (typeof content === 'string') return { content, images: [] };
  if (!Array.isArray(content)) return { content: safeJSONString(content), images: [] };

  const textParts = [];
  const images = [];

  for (const part of content) {
    if (!part) continue;

    if (part.type === 'text' || part.type === 'input_text') {
      textParts.push(String(part.text || ''));
      continue;
    }

    if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      if (typeof url === 'string') {
        const match = url.match(/^data:image\/[^;]+;base64,(.+)$/i);
        if (match) images.push(match[1]);
        else textParts.push(`[Image URL: ${url}]`);
      }
      continue;
    }

    if (part.type === 'image' || part.type === 'input_image') {
      const value = part.image ?? part.image_url ?? part.url;
      if (typeof value === 'string') {
        const match = value.match(/^data:image\/[^;]+;base64,(.+)$/i);
        if (match) images.push(match[1]);
      }
      continue;
    }

    if (typeof part.text === 'string') textParts.push(part.text);
  }

  return { content: textParts.join('\n'), images };
}

function openAIToolCallsToOllama(toolCalls) {
  if (!Array.isArray(toolCalls)) return undefined;
  const converted = toolCalls
    .map((call) => {
      const fn = call?.function;
      if (!fn?.name) return null;
      return {
        type: 'function',
        function: {
          name: fn.name,
          arguments: parseArguments(fn.arguments),
        },
      };
    })
    .filter(Boolean);
  return converted.length ? converted : undefined;
}

function convertMessages(incomingMessages, config) {
  const original = Array.isArray(incomingMessages) ? incomingMessages : [];
  const policyMessages = applyPromptPolicy(original, config);
  const toolNameMap = buildToolCallNameMap(original);
  const result = [];

  for (const message of policyMessages) {
    const role = String(message?.role || '').toLowerCase();
    const converted = convertContent(message?.content);

    if (role === 'system') {
      result.push({ role: 'system', content: converted.content });
      continue;
    }

    // Ollama native has no distinct developer role. Preserve its authority label as system content.
    if (role === 'developer') {
      result.push({ role: 'system', content: `[DEVELOPER]\n${converted.content}` });
      continue;
    }

    if (role === 'user') {
      const out = { role: 'user', content: converted.content };
      if (converted.images.length) out.images = converted.images;
      result.push(out);
      continue;
    }

    if (role === 'assistant') {
      const out = { role: 'assistant', content: converted.content };
      const toolCalls = openAIToolCallsToOllama(message.tool_calls);
      if (toolCalls) out.tool_calls = toolCalls;
      result.push(out);
      continue;
    }

    if (role === 'tool') {
      const toolName = message.tool_name || message.name || toolNameMap.get(message.tool_call_id);
      const out = { role: 'tool', content: converted.content };
      if (toolName) out.tool_name = toolName;
      result.push(out);
      continue;
    }

    result.push({ role: role || 'user', content: converted.content });
  }

  return result;
}

function convertTools(body) {
  if (body?.tool_choice === 'none' || !Array.isArray(body?.tools)) return undefined;

  let tools = body.tools
    .filter((tool) => tool?.type === 'function' && tool?.function?.name)
    .map((tool) => ({
      type: 'function',
      function: {
        name: tool.function.name,
        ...(tool.function.description ? { description: tool.function.description } : {}),
        parameters: tool.function.parameters || tool.function.input_schema || {
          type: 'object',
          properties: {},
        },
      },
    }));

  const forcedName = body?.tool_choice?.function?.name;
  if (forcedName) tools = tools.filter((tool) => tool.function.name === forcedName);
  return tools.length ? tools : undefined;
}

function buildOptions(body) {
  const options = {};
  if (typeof body?.temperature === 'number') options.temperature = body.temperature;
  if (typeof body?.top_p === 'number') options.top_p = body.top_p;
  if (typeof body?.seed === 'number') options.seed = body.seed;
  if (body?.stop !== undefined) options.stop = body.stop;

  const maxTokens = body?.max_completion_tokens ?? body?.max_tokens;
  if (typeof maxTokens === 'number') options.num_predict = maxTokens;
  return Object.keys(options).length ? options : undefined;
}

function convertFormat(responseFormat) {
  if (!responseFormat) return undefined;
  if (responseFormat.type === 'json_object') return 'json';
  if (responseFormat.type === 'json_schema') return responseFormat?.json_schema?.schema || undefined;
  return undefined;
}

function buildNativeBody(req, incoming, config) {
  const reasoning = incomingReasoning(incoming, config);
  const nativeBody = {
    model: resolveModel(incoming.model, config),
    messages: convertMessages(incoming.messages, config),
    stream: incoming.stream === true,
    think: toOllamaThink(reasoning),
  };

  const tools = convertTools(incoming);
  if (tools) nativeBody.tools = tools;
  const options = buildOptions(incoming);
  if (options) nativeBody.options = options;
  const format = convertFormat(incoming.response_format);
  if (format) nativeBody.format = format;
  if (incoming.keep_alive !== undefined) nativeBody.keep_alive = incoming.keep_alive;

  return { nativeBody, reasoning };
}

function ollamaToolCallsToOpenAI(toolCalls, completionID) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((call, index) => ({
    id: `call_${completionID}_${index}`,
    type: 'function',
    function: {
      name: call?.function?.name || '',
      arguments: safeJSONString(call?.function?.arguments || {}),
    },
  }));
}

function finishReason(nativeReason, hasToolCalls) {
  if (hasToolCalls) return 'tool_calls';
  if (nativeReason === 'length') return 'length';
  return 'stop';
}

async function models(req, res, config) {
  const controller = createAbortController(req, res);
  const modelsPath = config.provider.modelsPath || '/v1/models';

  try {
    const upstream = await fetch(joinURL(config.provider.baseURL, modelsPath), {
      headers: providerHeaders(config),
      signal: controller.signal,
    });
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
    return res.send(data);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    return res.status(502).json({
      error: {
        message: error?.message || 'Failed to fetch Ollama models.',
        type: 'provider_connection_error',
      },
    });
  }
}

function convertNonStream(native, requestedModel) {
  const completionID = randomID('native');
  const toolCalls = ollamaToolCallsToOpenAI(native?.message?.tool_calls || [], completionID);
  const message = {
    role: 'assistant',
    content: native?.message?.content || '',
  };

  if (native?.message?.thinking) message.reasoning_content = native.message.thinking;
  if (toolCalls.length) message.tool_calls = toolCalls;

  const promptTokens = Number(native?.prompt_eval_count || 0);
  const completionTokens = Number(native?.eval_count || 0);

  return {
    id: `chatcmpl-${completionID}`,
    object: 'chat.completion',
    created: unixTime(),
    model: native?.model || requestedModel,
    choices: [
      {
        index: 0,
        message,
        finish_reason: finishReason(native?.done_reason, toolCalls.length > 0),
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

function writeSSE(res, object) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(object)}\n\n`);
}

async function streamToOpenAI(upstream, res, requestedModel, streamOptions) {
  const completionID = randomID('stream');
  const chatID = `chatcmpl-${completionID}`;
  const created = unixTime();
  let finalNative = null;
  let toolCallsSeen = false;
  const emittedTools = new Set();

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  writeSSE(res, {
    id: chatID,
    object: 'chat.completion.chunk',
    created,
    model: requestedModel,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(': promptrelay-alive\n\n');
  }, 10000);

  try {
    if (!upstream.body) throw new Error('Ollama returned an empty stream.');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const processLine = (rawLine) => {
      const line = rawLine.trim();
      if (!line) return;

      let native;
      try { native = JSON.parse(line); } catch { return; }
      finalNative = native;
      const message = native?.message || {};

      if (message.thinking) {
        writeSSE(res, {
          id: chatID,
          object: 'chat.completion.chunk',
          created,
          model: native.model || requestedModel,
          choices: [{
            index: 0,
            delta: { reasoning_content: message.thinking },
            finish_reason: null,
          }],
        });
      }

      if (message.content) {
        writeSSE(res, {
          id: chatID,
          object: 'chat.completion.chunk',
          created,
          model: native.model || requestedModel,
          choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }],
        });
      }

      if (Array.isArray(message.tool_calls)) {
        message.tool_calls.forEach((call, index) => {
          const fn = call?.function;
          if (!fn?.name) return;

          const args = safeJSONString(fn.arguments || {});
          const signature = `${index}|${fn.name}|${args}`;
          if (emittedTools.has(signature)) return;
          emittedTools.add(signature);
          toolCallsSeen = true;

          writeSSE(res, {
            id: chatID,
            object: 'chat.completion.chunk',
            created,
            model: native.model || requestedModel,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index,
                  id: `call_${completionID}_${index}`,
                  type: 'function',
                  function: { name: fn.name, arguments: args },
                }],
              },
              finish_reason: null,
            }],
          });
        });
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newline;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          processLine(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
    } finally {
      try { reader.releaseLock(); } catch {}
    }

    writeSSE(res, {
      id: chatID,
      object: 'chat.completion.chunk',
      created,
      model: finalNative?.model || requestedModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason(finalNative?.done_reason, toolCallsSeen),
      }],
    });

    if (streamOptions?.include_usage && finalNative) {
      const prompt = Number(finalNative?.prompt_eval_count || 0);
      const completion = Number(finalNative?.eval_count || 0);
      writeSSE(res, {
        id: chatID,
        object: 'chat.completion.chunk',
        created,
        model: finalNative.model || requestedModel,
        choices: [],
        usage: {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: prompt + completion,
        },
      });
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function chat(req, res, config) {
  const incoming = req.body || {};
  const controller = createAbortController(req, res);
  const { nativeBody, reasoning } = buildNativeBody(req, incoming, config);
  const startedAt = Date.now();
  const chatPath = config.provider.chatPath || '/api/chat';
  const url = joinURL(config.provider.baseURL, chatPath);

  if (config.logging.requests) {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('☢️ PROMPTRELAY REQUEST · OLLAMA NATIVE');
    console.log(`Provider    : ${config.provider.name}`);
    console.log(`Model       : ${nativeBody.model}`);
    console.log(`Mode        : ${config.prompt.mode}`);
    console.log(`Reasoning   : ${reasoning}`);
    console.log(`Stream      : ${nativeBody.stream}`);
    console.log(`Tools       : ${nativeBody.tools?.length || 0}`);
    console.log(`Upstream    : ${url}`);
    console.log('══════════════════════════════════════════════');
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: providerHeaders(config),
      body: JSON.stringify(nativeBody),
      signal: controller.signal,
    });

    if (config.logging.requests) console.log(`Connected   : ${Date.now() - startedAt}ms`);

    if (!upstream.ok) {
      const text = await upstream.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      return res.status(upstream.status).json({
        error: {
          message: parsed?.error || parsed?.message || text || 'Ollama request failed.',
          type: 'ollama_provider_error',
        },
      });
    }

    if (incoming.stream === true) {
      await streamToOpenAI(upstream, res, nativeBody.model, incoming.stream_options);
      if (config.logging.requests) console.log(`Stream done : ${Date.now() - startedAt}ms`);
      return;
    }

    const native = await upstream.json();
    const converted = convertNonStream(native, nativeBody.model);
    if (config.logging.requests) console.log(`Completed   : ${Date.now() - startedAt}ms`);
    return res.json(converted);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('PromptRelay Ollama adapter error:', error);
    if (!res.headersSent) {
      return res.status(502).json({
        error: {
          message: error?.message || 'Ollama provider request failed.',
          type: 'provider_connection_error',
        },
      });
    }
    if (!res.writableEnded) res.end();
  }
}

module.exports = {
  models,
  chat,
};

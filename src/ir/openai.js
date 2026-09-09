'use strict';

/**
 * OpenAI Chat Completions <-> IR translation.
 *
 * Ingress:  openaiRequestToIR  (client body        -> NormalizedRequest)
 * Egress:   irToOpenAIRequest  (NormalizedRequest  -> provider body)
 * Response: openaiResponseToIR / irToOpenAIResponse
 * Stream:   parseOpenAIStream (SSE -> IR events) / writeOpenAIStream (IR -> SSE)
 *
 * Nothing is fabricated: fields absent in the source are absent in the target.
 */

const {
  BLOCK,
  openaiStopToCanon,
  canonStopToOpenAI,
  normalizeUsage,
} = require('./schema');
const { formatSSE } = require('./sse');

let idCounter = 0;
function genId(prefix) {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Content conversion
// ---------------------------------------------------------------------------

function parseDataUri(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  return { mediaType: m[1] || 'application/octet-stream', data: m[3] || '' };
}

/** OpenAI message content (string | parts[]) -> IR text/image blocks. */
function openaiContentToBlocks(content) {
  if (content == null) return [];
  if (typeof content === 'string') {
    return content === '' ? [] : [{ type: BLOCK.TEXT, text: content }];
  }
  if (!Array.isArray(content)) return [{ type: BLOCK.UNKNOWN, raw: content }];

  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text') {
      blocks.push({ type: BLOCK.TEXT, text: part.text || '' });
    } else if (part.type === 'image_url') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      const dataUri = parseDataUri(url);
      if (dataUri) {
        blocks.push({ type: BLOCK.IMAGE, mediaType: dataUri.mediaType, data: dataUri.data });
      } else if (url) {
        blocks.push({ type: BLOCK.IMAGE, url });
      }
    } else {
      blocks.push({ type: BLOCK.UNKNOWN, raw: part });
    }
  }
  return blocks;
}

function safeParseJSON(str) {
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return str; }
}

// ---------------------------------------------------------------------------
// Request: OpenAI -> IR
// ---------------------------------------------------------------------------

function openaiRequestToIR(body = {}) {
  const messagesIn = Array.isArray(body.messages) ? body.messages : [];
  const systemParts = [];
  const messages = [];

  for (const msg of messagesIn) {
    const role = String(msg?.role || '').toLowerCase();
    if (role === 'system' || role === 'developer') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : openaiContentToBlocks(msg.content).filter((b) => b.type === BLOCK.TEXT).map((b) => b.text).join('\n');
      if (text) systemParts.push(text);
      continue;
    }
    if (role === 'tool') {
      messages.push({
        role: 'tool',
        content: [{
          type: BLOCK.TOOL_RESULT,
          toolCallId: msg.tool_call_id || null,
          content: typeof msg.content === 'string' ? msg.content : openaiContentToBlocks(msg.content),
          isError: false,
        }],
      });
      continue;
    }
    // user / assistant
    const blocks = openaiContentToBlocks(msg.content);
    if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        blocks.push({
          type: BLOCK.TOOL_CALL,
          id: tc.id || genId('call'),
          name: tc.function?.name || tc.name || '',
          arguments: safeParseJSON(tc.function?.arguments ?? tc.arguments ?? '{}'),
        });
      }
    }
    messages.push({ role: role === 'assistant' ? 'assistant' : 'user', content: blocks });
  }

  const reasoning = readOpenAIReasoning(body);
  const generation = {};
  if (body.temperature !== undefined) generation.temperature = body.temperature;
  if (body.top_p !== undefined) generation.topP = body.top_p;
  if (body.max_tokens !== undefined) generation.maxTokens = body.max_tokens;
  if (body.max_completion_tokens !== undefined && generation.maxTokens === undefined) {
    generation.maxTokens = body.max_completion_tokens;
  }
  if (body.stop !== undefined) generation.stop = body.stop;
  if (body.seed !== undefined) generation.seed = body.seed;

  return {
    requestId: genId('req'),
    protocol: 'openai',
    model: body.model || null,
    system: systemParts.length ? systemParts.join('\n\n') : null,
    messages,
    tools: openaiToolsToIR(body.tools),
    toolChoice: openaiToolChoiceToIR(body.tool_choice),
    reasoning,
    generation,
    responseFormat: body.response_format || null,
    stream: body.stream === true,
    metadata: {},
  };
}

function readOpenAIReasoning(body) {
  const explicit = body?.reasoning_effort ?? body?.reasoningEffort ?? body?.reasoning?.effort;
  if (explicit === undefined) return null;
  return { level: String(explicit).toLowerCase(), explicit: true };
}

function openaiToolsToIR(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  return tools.map((t) => {
    const fn = t.function || t;
    return { name: fn.name, description: fn.description, parameters: fn.parameters || {} };
  });
}

function openaiToolChoiceToIR(choice) {
  if (choice == null) return null;
  if (typeof choice === 'string') return choice; // 'auto' | 'none' | 'required'
  if (choice.type === 'function') return { name: choice.function?.name };
  return null;
}

// ---------------------------------------------------------------------------
// Request: IR -> OpenAI
// ---------------------------------------------------------------------------

function blocksToOpenAIContent(blocks) {
  const textOnly = blocks.every((b) => b.type === BLOCK.TEXT);
  if (textOnly) return blocks.map((b) => b.text).join('');
  const parts = [];
  for (const b of blocks) {
    if (b.type === BLOCK.TEXT) parts.push({ type: 'text', text: b.text });
    else if (b.type === BLOCK.IMAGE) {
      const url = b.url || (b.data ? `data:${b.mediaType || 'image/png'};base64,${b.data}` : null);
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  return parts;
}

function irToOpenAIRequest(ir, config = {}) {
  const messages = [];
  if (ir.system) messages.push({ role: 'system', content: ir.system });

  for (const m of ir.messages) {
    if (m.role === 'tool') {
      for (const block of m.content) {
        if (block.type !== BLOCK.TOOL_RESULT) continue;
        messages.push({
          role: 'tool',
          tool_call_id: block.toolCallId || undefined,
          content: typeof block.content === 'string'
            ? block.content
            : blocksToOpenAIContent(Array.isArray(block.content) ? block.content : [{ type: BLOCK.TEXT, text: String(block.content ?? '') }]),
        });
      }
      continue;
    }
    if (m.role === 'assistant') {
      const textBlocks = m.content.filter((b) => b.type === BLOCK.TEXT);
      const toolCalls = m.content.filter((b) => b.type === BLOCK.TOOL_CALL);
      const out = { role: 'assistant' };
      const text = textBlocks.map((b) => b.text).join('');
      out.content = text || (toolCalls.length ? null : '');
      if (toolCalls.length) {
        out.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
          },
        }));
      }
      messages.push(out);
      continue;
    }
    // user
    messages.push({ role: 'user', content: blocksToOpenAIContent(m.content) });
  }

  const body = { messages };
  const gen = ir.generation || {};
  if (gen.temperature !== undefined) body.temperature = gen.temperature;
  if (gen.topP !== undefined) body.top_p = gen.topP;
  if (gen.maxTokens !== undefined) body.max_tokens = gen.maxTokens;
  if (gen.stop !== undefined) body.stop = gen.stop;
  if (gen.seed !== undefined) body.seed = gen.seed;
  if (ir.tools) {
    body.tools = ir.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters || {} },
    }));
  }
  if (ir.toolChoice != null) {
    body.tool_choice = typeof ir.toolChoice === 'string'
      ? ir.toolChoice
      : { type: 'function', function: { name: ir.toolChoice.name } };
  }
  if (ir.responseFormat) body.response_format = ir.responseFormat;
  if (ir.stream) body.stream = true;
  return body;
}

// ---------------------------------------------------------------------------
// Response: OpenAI -> IR
// ---------------------------------------------------------------------------

function openaiResponseToIR(json = {}) {
  const choice = Array.isArray(json.choices) ? json.choices[0] : null;
  const message = choice?.message || {};
  const content = [];

  const reasoningText = message.reasoning_content ?? message.reasoning;
  if (reasoningText) content.push({ type: BLOCK.REASONING, text: String(reasoningText) });
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: BLOCK.TEXT, text: message.content });
  } else if (Array.isArray(message.content)) {
    content.push(...openaiContentToBlocks(message.content));
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      content.push({
        type: BLOCK.TOOL_CALL,
        id: tc.id || genId('call'),
        name: tc.function?.name || '',
        arguments: safeParseJSON(tc.function?.arguments ?? '{}'),
      });
    }
  }

  return {
    id: json.id || genId('chatcmpl'),
    model: json.model || null,
    provider: 'openai',
    content,
    stopReason: openaiStopToCanon(choice?.finish_reason),
    usage: normalizeUsage(json.usage),
  };
}

// ---------------------------------------------------------------------------
// Response: IR -> OpenAI
// ---------------------------------------------------------------------------

function irToOpenAIResponse(nr, opts = {}) {
  const textBlocks = nr.content.filter((b) => b.type === BLOCK.TEXT);
  const toolCalls = nr.content.filter((b) => b.type === BLOCK.TOOL_CALL);
  const reasoning = nr.content.filter((b) => b.type === BLOCK.REASONING);

  const message = { role: 'assistant', content: textBlocks.map((b) => b.text).join('') || null };
  if (reasoning.length) message.reasoning_content = reasoning.map((b) => b.text).join('');
  if (toolCalls.length) {
    message.tool_calls = toolCalls.map((tc) => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.name,
        arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
      },
    }));
  }

  const usage = nr.usage
    ? {
        prompt_tokens: nr.usage.inputTokens,
        completion_tokens: nr.usage.outputTokens,
        total_tokens: nr.usage.inputTokens + nr.usage.outputTokens,
      }
    : undefined;

  return {
    id: nr.id || genId('chatcmpl'),
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: opts.model || nr.model || 'unknown',
    choices: [{
      index: 0,
      message,
      finish_reason: canonStopToOpenAI(nr.stopReason),
    }],
    ...(usage ? { usage } : {}),
  };
}

// ---------------------------------------------------------------------------
// Stream: OpenAI SSE -> IR events
// ---------------------------------------------------------------------------

/**
 * Convert one OpenAI chunk object into zero-or-more IR events, mutating `state`
 * (used to emit a single `start` and to track finish_reason/usage).
 */
function openaiChunkToEvents(obj, state) {
  const events = [];
  if (!state.started) {
    state.started = true;
    events.push({ type: 'start', id: obj.id || null, model: obj.model || null });
  }
  const choice = Array.isArray(obj.choices) ? obj.choices[0] : null;
  const delta = choice?.delta || {};

  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (reasoning) events.push({ type: 'reasoning_delta', text: String(reasoning) });
  if (typeof delta.content === 'string' && delta.content) {
    events.push({ type: 'text_delta', text: delta.content });
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const tc of delta.tool_calls) {
      const index = tc.index ?? 0;
      if (!state.toolStarted) state.toolStarted = {};
      if (!state.toolStarted[index] && (tc.id || tc.function?.name)) {
        state.toolStarted[index] = true;
        events.push({ type: 'tool_call_start', index, id: tc.id || null, name: tc.function?.name || '' });
      }
      const frag = tc.function?.arguments;
      if (frag) events.push({ type: 'tool_call_delta', index, argsFragment: frag });
    }
  }
  if (choice?.finish_reason) state.stopReason = openaiStopToCanon(choice.finish_reason);
  if (obj.usage) state.usage = normalizeUsage(obj.usage);
  return events;
}

/** Parse an OpenAI SSE stream (from iterSSE records) into IR events. */
async function* parseOpenAIStream(sseRecords) {
  const state = { started: false, stopReason: null, usage: null, toolStarted: {} };
  const openTools = new Set();
  for await (const rec of sseRecords) {
    if (rec.data === '[DONE]') break;
    let obj;
    try { obj = JSON.parse(rec.data); } catch { continue; }
    for (const ev of openaiChunkToEvents(obj, state)) {
      if (ev.type === 'tool_call_start') openTools.add(ev.index);
      yield ev;
    }
  }
  for (const index of openTools) yield { type: 'tool_call_stop', index };
  yield { type: 'stop', stopReason: state.stopReason, usage: state.usage };
}

// ---------------------------------------------------------------------------
// Stream: IR events -> OpenAI SSE
// ---------------------------------------------------------------------------

/**
 * Write IR events to an OpenAI-format SSE stream via the `write` callback.
 * `write` receives ready-to-send strings. Returns when the stop event is seen.
 */
async function writeOpenAIStream(irEvents, write, opts = {}) {
  const id = opts.id || genId('chatcmpl');
  const created = Math.floor(Date.now() / 1000);
  let model = opts.model || 'unknown';
  const base = () => ({ id, object: 'chat.completion.chunk', created, model });

  for await (const ev of irEvents) {
    if (ev.type === 'start') {
      if (ev.model) model = opts.model || ev.model;
      write(formatSSE(null, { ...base(), choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] }));
    } else if (ev.type === 'text_delta') {
      write(formatSSE(null, { ...base(), choices: [{ index: 0, delta: { content: ev.text }, finish_reason: null }] }));
    } else if (ev.type === 'reasoning_delta') {
      write(formatSSE(null, { ...base(), choices: [{ index: 0, delta: { reasoning_content: ev.text }, finish_reason: null }] }));
    } else if (ev.type === 'tool_call_start') {
      write(formatSSE(null, { ...base(), choices: [{ index: 0, delta: { tool_calls: [{ index: ev.index, id: ev.id, type: 'function', function: { name: ev.name, arguments: '' } }] }, finish_reason: null }] }));
    } else if (ev.type === 'tool_call_delta') {
      write(formatSSE(null, { ...base(), choices: [{ index: 0, delta: { tool_calls: [{ index: ev.index, function: { arguments: ev.argsFragment } }] }, finish_reason: null }] }));
    } else if (ev.type === 'stop') {
      const finish = canonStopToOpenAI(ev.stopReason);
      const chunk = { ...base(), choices: [{ index: 0, delta: {}, finish_reason: finish }] };
      if (ev.usage) chunk.usage = { prompt_tokens: ev.usage.inputTokens, completion_tokens: ev.usage.outputTokens, total_tokens: ev.usage.inputTokens + ev.usage.outputTokens };
      write(formatSSE(null, chunk));
      write(formatSSE(null, '[DONE]'));
    }
  }
}

module.exports = {
  genId,
  openaiContentToBlocks,
  openaiRequestToIR,
  irToOpenAIRequest,
  openaiResponseToIR,
  irToOpenAIResponse,
  openaiChunkToEvents,
  parseOpenAIStream,
  writeOpenAIStream,
};

'use strict';

/**
 * Anthropic Messages API <-> IR translation.
 *
 * Ingress:  anthropicRequestToIR  (client body       -> NormalizedRequest)
 * Egress:   irToAnthropicRequest  (NormalizedRequest -> provider body)
 * Response: anthropicResponseToIR / irToAnthropicResponse
 * Stream:   parseAnthropicStream (SSE -> IR events) / writeAnthropicStream (IR -> SSE)
 *
 * Anthropic models a request as: top-level `system`, an alternating list of
 * user/assistant turns, and typed content blocks. Tool results live inside a
 * user turn as `tool_result` blocks. The IR keeps tool results in their own
 * role:'tool' messages, so egress here merges them back into user turns.
 */

const {
  BLOCK,
  anthropicStopToCanon,
  canonStopToAnthropic,
  normalizeUsage,
} = require('./schema');
const { formatSSE } = require('./sse');
const { genId } = require('./openai');

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 4096; // Anthropic requires max_tokens; used only when the client omits it.

// Canonical reasoning level -> Anthropic thinking budget (tokens).
const REASONING_BUDGET = {
  none: 0,
  minimal: 1024,
  low: 1024,
  medium: 4000,
  high: 8000,
  max: 16000,
};

// ---------------------------------------------------------------------------
// Content conversion
// ---------------------------------------------------------------------------

function textFromAnthropicSystem(system) {
  if (system == null) return null;
  if (typeof system === 'string') return system || null;
  if (Array.isArray(system)) {
    const text = system.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n\n');
    return text || null;
  }
  return null;
}

/** Anthropic content blocks -> IR blocks (within a single message). */
function anthropicContentToBlocks(content) {
  if (content == null) return [];
  if (typeof content === 'string') return content === '' ? [] : [{ type: BLOCK.TEXT, text: content }];
  if (!Array.isArray(content)) return [{ type: BLOCK.UNKNOWN, raw: content }];

  const blocks = [];
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    switch (part.type) {
      case 'text':
        blocks.push({ type: BLOCK.TEXT, text: part.text || '' });
        break;
      case 'thinking':
        blocks.push({ type: BLOCK.REASONING, text: part.thinking || '' });
        break;
      case 'image': {
        const src = part.source || {};
        if (src.type === 'base64') blocks.push({ type: BLOCK.IMAGE, mediaType: src.media_type, data: src.data });
        else if (src.type === 'url') blocks.push({ type: BLOCK.IMAGE, url: src.url });
        else blocks.push({ type: BLOCK.UNKNOWN, raw: part });
        break;
      }
      case 'tool_use':
        blocks.push({ type: BLOCK.TOOL_CALL, id: part.id, name: part.name, arguments: part.input ?? {} });
        break;
      case 'tool_result':
        blocks.push({
          type: BLOCK.TOOL_RESULT,
          toolCallId: part.tool_use_id || null,
          content: normalizeToolResultContent(part.content),
          isError: part.is_error === true,
        });
        break;
      default:
        blocks.push({ type: BLOCK.UNKNOWN, raw: part });
    }
  }
  return blocks;
}

function normalizeToolResultContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b?.type === 'text').map((b) => b.text || '').join('\n');
  }
  return content ?? '';
}

// ---------------------------------------------------------------------------
// Request: Anthropic -> IR
// ---------------------------------------------------------------------------

function anthropicRequestToIR(body = {}) {
  const messages = [];
  const msgsIn = Array.isArray(body.messages) ? body.messages : [];

  for (const msg of msgsIn) {
    const role = String(msg?.role || '').toLowerCase();
    const blocks = anthropicContentToBlocks(msg.content);
    if (role === 'assistant') {
      messages.push({ role: 'assistant', content: blocks });
    } else {
      // user turn: split tool_result blocks into their own role:'tool' message
      const toolResults = blocks.filter((b) => b.type === BLOCK.TOOL_RESULT);
      const rest = blocks.filter((b) => b.type !== BLOCK.TOOL_RESULT);
      if (toolResults.length) messages.push({ role: 'tool', content: toolResults });
      if (rest.length) messages.push({ role: 'user', content: rest });
    }
  }

  const reasoning = readAnthropicReasoning(body);
  const generation = {};
  if (body.temperature !== undefined) generation.temperature = body.temperature;
  if (body.top_p !== undefined) generation.topP = body.top_p;
  if (body.max_tokens !== undefined) generation.maxTokens = body.max_tokens;
  if (body.stop_sequences !== undefined) generation.stop = body.stop_sequences;

  return {
    requestId: genId('req'),
    protocol: 'anthropic',
    model: body.model || null,
    system: textFromAnthropicSystem(body.system),
    messages,
    tools: anthropicToolsToIR(body.tools),
    toolChoice: anthropicToolChoiceToIR(body.tool_choice),
    reasoning,
    generation,
    responseFormat: null,
    stream: body.stream === true,
    metadata: body.metadata && typeof body.metadata === 'object' ? { ...body.metadata } : {},
  };
}

function readAnthropicReasoning(body) {
  const thinking = body?.thinking;
  if (!thinking || thinking.type !== 'enabled') return null;
  const budget = Number(thinking.budget_tokens) || 0;
  let level = 'medium';
  if (budget >= 16000) level = 'max';
  else if (budget >= 8000) level = 'high';
  else if (budget >= 4000) level = 'medium';
  else if (budget > 0) level = 'low';
  return { level, budgetTokens: budget || undefined, explicit: true };
}

function anthropicToolsToIR(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return null;
  return tools
    .filter((t) => t && t.name) // skip server-side tool types we cannot faithfully map
    .map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema || {} }));
}

function anthropicToolChoiceToIR(choice) {
  if (choice == null) return null;
  if (typeof choice === 'string') return choice;
  switch (choice.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'none': return 'none';
    case 'tool': return { name: choice.name };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Request: IR -> Anthropic
// ---------------------------------------------------------------------------

function blocksToAnthropicContent(blocks) {
  const out = [];
  for (const b of blocks) {
    switch (b.type) {
      case BLOCK.TEXT:
        out.push({ type: 'text', text: b.text });
        break;
      case BLOCK.REASONING:
        // Reasoning is provider-generated; do not echo prior thinking upstream.
        break;
      case BLOCK.IMAGE:
        if (b.data) out.push({ type: 'image', source: { type: 'base64', media_type: b.mediaType || 'image/png', data: b.data } });
        else if (b.url) out.push({ type: 'image', source: { type: 'url', url: b.url } });
        break;
      case BLOCK.TOOL_CALL:
        out.push({ type: 'tool_use', id: b.id, name: b.name, input: typeof b.arguments === 'string' ? safeObj(b.arguments) : (b.arguments ?? {}) });
        break;
      case BLOCK.TOOL_RESULT:
        out.push({
          type: 'tool_result',
          tool_use_id: b.toolCallId || undefined,
          content: typeof b.content === 'string' ? b.content : normalizeToolResultContent(b.content),
          ...(b.isError ? { is_error: true } : {}),
        });
        break;
      default:
        break;
    }
  }
  return out;
}

function safeObj(str) { try { return JSON.parse(str); } catch { return {}; } }

/**
 * Build an Anthropic request body from IR. `max_tokens` is required by the API;
 * when the client did not specify one we fall back to DEFAULT_MAX_TOKENS and
 * surface that in `_promptrelayDefaults` (stripped before sending) — never a
 * silent fabrication of a limit.
 */
function irToAnthropicRequest(ir, config = {}) {
  const model = ir.model || (config.provider && config.provider.model) || 'unknown';
  const turns = mergeIntoAnthropicTurns(ir.messages);

  const body = { model, messages: turns };
  if (ir.system) body.system = ir.system;

  const gen = ir.generation || {};
  body.max_tokens = gen.maxTokens != null ? gen.maxTokens : DEFAULT_MAX_TOKENS;
  if (gen.temperature !== undefined) body.temperature = gen.temperature;
  if (gen.topP !== undefined) body.top_p = gen.topP;
  if (gen.stop !== undefined) body.stop_sequences = Array.isArray(gen.stop) ? gen.stop : [gen.stop];

  if (ir.tools) {
    body.tools = ir.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || { type: 'object', properties: {} } }));
  }
  if (ir.toolChoice != null) body.tool_choice = irToolChoiceToAnthropic(ir.toolChoice);

  // Only enable thinking when the client explicitly requested reasoning.
  if (ir.reasoning && ir.reasoning.explicit) {
    const budget = ir.reasoning.budgetTokens || REASONING_BUDGET[ir.reasoning.level] || 0;
    if (budget > 0) {
      body.thinking = { type: 'enabled', budget_tokens: budget };
      // Anthropic requires max_tokens > budget_tokens.
      if (body.max_tokens <= budget) body.max_tokens = budget + DEFAULT_MAX_TOKENS;
    }
  }

  if (ir.stream) body.stream = true;
  return body;
}

function irToolChoiceToAnthropic(choice) {
  if (typeof choice === 'string') {
    if (choice === 'required') return { type: 'any' };
    if (choice === 'none') return { type: 'none' };
    return { type: 'auto' };
  }
  if (choice && choice.name) return { type: 'tool', name: choice.name };
  return { type: 'auto' };
}

/** Merge IR messages into valid alternating Anthropic turns. */
function mergeIntoAnthropicTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const isUserish = m.role === 'user' || m.role === 'tool';
    const role = isUserish ? 'user' : 'assistant';
    const content = blocksToAnthropicContent(m.content);
    if (content.length === 0) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content.push(...content);
    } else {
      turns.push({ role, content });
    }
  }
  return turns;
}

// ---------------------------------------------------------------------------
// Response: Anthropic -> IR
// ---------------------------------------------------------------------------

function anthropicResponseToIR(json = {}) {
  const content = [];
  for (const part of Array.isArray(json.content) ? json.content : []) {
    if (part.type === 'text') content.push({ type: BLOCK.TEXT, text: part.text || '' });
    else if (part.type === 'thinking') content.push({ type: BLOCK.REASONING, text: part.thinking || '' });
    else if (part.type === 'tool_use') content.push({ type: BLOCK.TOOL_CALL, id: part.id, name: part.name, arguments: part.input ?? {} });
  }
  return {
    id: json.id || genId('msg'),
    model: json.model || null,
    provider: 'anthropic',
    content,
    stopReason: anthropicStopToCanon(json.stop_reason),
    usage: normalizeUsage(json.usage),
  };
}

// ---------------------------------------------------------------------------
// Response: IR -> Anthropic
// ---------------------------------------------------------------------------

function irToAnthropicResponse(nr, opts = {}) {
  const content = [];
  for (const b of nr.content) {
    if (b.type === BLOCK.REASONING) content.push({ type: 'thinking', thinking: b.text });
    else if (b.type === BLOCK.TEXT) content.push({ type: 'text', text: b.text });
    else if (b.type === BLOCK.TOOL_CALL) content.push({ type: 'tool_use', id: b.id, name: b.name, input: typeof b.arguments === 'string' ? safeObj(b.arguments) : (b.arguments ?? {}) });
  }
  return {
    id: nr.id || genId('msg'),
    type: 'message',
    role: 'assistant',
    model: opts.model || nr.model || 'unknown',
    content,
    stop_reason: canonStopToAnthropic(nr.stopReason),
    stop_sequence: null,
    usage: {
      input_tokens: nr.usage ? nr.usage.inputTokens : 0,
      output_tokens: nr.usage ? nr.usage.outputTokens : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Stream: Anthropic SSE -> IR events
// ---------------------------------------------------------------------------

async function* parseAnthropicStream(sseRecords) {
  const state = { blocks: {}, stopReason: null, usage: { inputTokens: 0, outputTokens: 0 }, started: false };
  for await (const rec of sseRecords) {
    let data;
    try { data = JSON.parse(rec.data); } catch { continue; }
    const type = rec.event || data.type;

    if (type === 'message_start') {
      state.started = true;
      const msg = data.message || {};
      if (msg.usage) state.usage.inputTokens = Number(msg.usage.input_tokens || 0);
      yield { type: 'start', id: msg.id || null, model: msg.model || null };
    } else if (type === 'content_block_start') {
      const index = data.index ?? 0;
      const block = data.content_block || {};
      state.blocks[index] = block.type;
      if (block.type === 'tool_use') {
        yield { type: 'tool_call_start', index, id: block.id || null, name: block.name || '' };
      }
    } else if (type === 'content_block_delta') {
      const index = data.index ?? 0;
      const d = data.delta || {};
      if (d.type === 'text_delta') yield { type: 'text_delta', text: d.text || '' };
      else if (d.type === 'thinking_delta') yield { type: 'reasoning_delta', text: d.thinking || '' };
      else if (d.type === 'input_json_delta') yield { type: 'tool_call_delta', index, argsFragment: d.partial_json || '' };
    } else if (type === 'content_block_stop') {
      const index = data.index ?? 0;
      if (state.blocks[index] === 'tool_use') yield { type: 'tool_call_stop', index };
    } else if (type === 'message_delta') {
      if (data.delta && data.delta.stop_reason) state.stopReason = anthropicStopToCanon(data.delta.stop_reason);
      if (data.usage && data.usage.output_tokens != null) state.usage.outputTokens = Number(data.usage.output_tokens);
    } else if (type === 'message_stop') {
      break;
    } else if (type === 'error') {
      const err = new Error(data.error?.message || 'Anthropic stream error');
      err.anthropicError = data.error;
      throw err;
    }
  }
  yield { type: 'stop', stopReason: state.stopReason, usage: state.usage };
}

// ---------------------------------------------------------------------------
// Stream: IR events -> Anthropic SSE
// ---------------------------------------------------------------------------

/**
 * Write IR events to Anthropic-format SSE via the `write` callback. Manages the
 * single incrementing content-block index and the required event sequence.
 */
async function writeAnthropicStream(irEvents, write, opts = {}) {
  const msgId = opts.id || genId('msg');
  const model = opts.model || 'unknown';
  let blockIndex = -1;
  let openBlockType = null; // 'text' | 'thinking' | 'tool_use'
  const toolIndexMap = new Map(); // IR tool index -> anthropic block index
  let inputTokens = 0;

  const closeBlock = () => {
    if (openBlockType !== null) {
      write(formatSSE('content_block_stop', { type: 'content_block_stop', index: blockIndex }));
      openBlockType = null;
    }
  };
  const openTextLike = (kind) => {
    if (openBlockType === kind) return;
    closeBlock();
    blockIndex += 1;
    const cb = kind === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' };
    write(formatSSE('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: cb }));
    openBlockType = kind;
  };

  for await (const ev of irEvents) {
    if (ev.type === 'start') {
      write(formatSSE('message_start', {
        type: 'message_start',
        message: {
          id: msgId, type: 'message', role: 'assistant', model,
          content: [], stop_reason: null, stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 0 },
        },
      }));
      write(formatSSE('ping', { type: 'ping' }));
    } else if (ev.type === 'text_delta') {
      openTextLike('text');
      write(formatSSE('content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: ev.text } }));
    } else if (ev.type === 'reasoning_delta') {
      openTextLike('thinking');
      write(formatSSE('content_block_delta', { type: 'content_block_delta', index: blockIndex, delta: { type: 'thinking_delta', thinking: ev.text } }));
    } else if (ev.type === 'tool_call_start') {
      closeBlock();
      blockIndex += 1;
      toolIndexMap.set(ev.index, blockIndex);
      openBlockType = 'tool_use';
      write(formatSSE('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: ev.id || genId('toolu'), name: ev.name, input: {} } }));
    } else if (ev.type === 'tool_call_delta') {
      const idx = toolIndexMap.has(ev.index) ? toolIndexMap.get(ev.index) : blockIndex;
      write(formatSSE('content_block_delta', { type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: ev.argsFragment } }));
    } else if (ev.type === 'tool_call_stop') {
      closeBlock();
    } else if (ev.type === 'stop') {
      closeBlock();
      const usage = ev.usage || { outputTokens: 0 };
      write(formatSSE('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: canonStopToAnthropic(ev.stopReason), stop_sequence: null },
        usage: { output_tokens: usage.outputTokens || 0 },
      }));
      write(formatSSE('message_stop', { type: 'message_stop' }));
    }
  }
}

module.exports = {
  ANTHROPIC_VERSION,
  DEFAULT_MAX_TOKENS,
  REASONING_BUDGET,
  anthropicContentToBlocks,
  anthropicRequestToIR,
  irToAnthropicRequest,
  anthropicResponseToIR,
  irToAnthropicResponse,
  parseAnthropicStream,
  writeAnthropicStream,
  mergeIntoAnthropicTurns,
};

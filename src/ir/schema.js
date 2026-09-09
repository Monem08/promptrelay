'use strict';

/**
 * PromptRelay Normalized Internal Representation (IR).
 *
 * The IR is a protocol-neutral shape that every client ingress translates INTO
 * and every provider egress translates FROM. This lets PromptRelay normalize a
 * request once and then faithfully re-emit it for OpenAI-compatible, Anthropic
 * native, or Ollama native providers — instead of forcing one wire format's
 * quirks onto another too early.
 *
 * Design rules:
 *  - Never fabricate data. If a field is absent upstream it stays absent here.
 *  - Content is modeled as typed blocks so Anthropic content blocks are not
 *    flattened into OpenAI strings (or vice-versa) until the target adapter
 *    decides how to render them.
 *
 * Shapes (documented, not enforced at runtime):
 *
 * NormalizedRequest {
 *   requestId:   string,
 *   protocol:    'openai' | 'anthropic',      // ingress protocol
 *   model:       string,
 *   system:      string | null,               // merged system instruction text
 *   messages:    NormalizedMessage[],
 *   tools:       NormalizedTool[] | null,
 *   toolChoice:  'auto'|'none'|'required'|{ name } | null,
 *   reasoning:   { level: CanonLevel, budgetTokens?: number, explicit: boolean } | null,
 *   generation:  { temperature?, topP?, maxTokens?, stop?, seed? },
 *   responseFormat: { type:'json_object'|'json_schema', schema? } | null,
 *   stream:      boolean,
 *   metadata:    object,
 * }
 *
 * NormalizedMessage { role:'system'|'user'|'assistant'|'tool', content: Block[] }
 *
 * Block (discriminated by `type`):
 *   { type:'text', text }
 *   { type:'image', mediaType, data }            // data = base64 (no data: prefix)
 *   { type:'image', url }                         // when only a URL is available
 *   { type:'tool_call', id, name, arguments }     // arguments = object
 *   { type:'tool_result', toolCallId, content, isError }
 *   { type:'reasoning', text }
 *   { type:'unknown', raw }
 *
 * NormalizedResponse {
 *   id, model, provider,
 *   content: Block[],                             // text / tool_call / reasoning
 *   stopReason: CanonStop | null,
 *   usage: { inputTokens, outputTokens } | null,
 * }
 */

const BLOCK = Object.freeze({
  TEXT: 'text',
  IMAGE: 'image',
  DOCUMENT: 'document',
  TOOL_CALL: 'tool_call',
  TOOL_RESULT: 'tool_result',
  REASONING: 'reasoning',
  UNKNOWN: 'unknown',
});

// Canonical stop reasons.
const STOP = Object.freeze({
  STOP: 'stop',
  LENGTH: 'length',
  TOOL_CALLS: 'tool_calls',
  STOP_SEQUENCE: 'stop_sequence',
  CONTENT_FILTER: 'content_filter',
});

/** OpenAI finish_reason -> canonical. */
function openaiStopToCanon(reason) {
  switch (reason) {
    case 'stop': return STOP.STOP;
    case 'length': return STOP.LENGTH;
    case 'tool_calls':
    case 'function_call': return STOP.TOOL_CALLS;
    case 'content_filter': return STOP.CONTENT_FILTER;
    default: return reason ? STOP.STOP : null;
  }
}

/** canonical -> OpenAI finish_reason. */
function canonStopToOpenAI(canon) {
  switch (canon) {
    case STOP.LENGTH: return 'length';
    case STOP.TOOL_CALLS: return 'tool_calls';
    case STOP.CONTENT_FILTER: return 'content_filter';
    case STOP.STOP_SEQUENCE: return 'stop';
    case STOP.STOP: return 'stop';
    default: return 'stop';
  }
}

/** Anthropic stop_reason -> canonical. */
function anthropicStopToCanon(reason) {
  switch (reason) {
    case 'end_turn': return STOP.STOP;
    case 'max_tokens': return STOP.LENGTH;
    case 'tool_use': return STOP.TOOL_CALLS;
    case 'stop_sequence': return STOP.STOP_SEQUENCE;
    case 'refusal': return STOP.CONTENT_FILTER;
    default: return reason ? STOP.STOP : null;
  }
}

/** canonical -> Anthropic stop_reason. */
function canonStopToAnthropic(canon) {
  switch (canon) {
    case STOP.LENGTH: return 'max_tokens';
    case STOP.TOOL_CALLS: return 'tool_use';
    case STOP.STOP_SEQUENCE: return 'stop_sequence';
    case STOP.CONTENT_FILTER: return 'refusal';
    case STOP.STOP: return 'end_turn';
    default: return 'end_turn';
  }
}

/** Normalize usage from either provider into { inputTokens, outputTokens }. */
function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw.input_tokens ?? raw.prompt_tokens ?? raw.prompt_eval_count;
  const output = raw.output_tokens ?? raw.completion_tokens ?? raw.eval_count;
  if (input === undefined && output === undefined) return null;
  return {
    inputTokens: Number(input || 0),
    outputTokens: Number(output || 0),
  };
}

module.exports = {
  BLOCK,
  STOP,
  openaiStopToCanon,
  canonStopToOpenAI,
  anthropicStopToCanon,
  canonStopToAnthropic,
  normalizeUsage,
};

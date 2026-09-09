'use strict';

const { UNKNOWN, createModel } = require('./schema');

/**
 * Capability extraction: turn raw provider model metadata into the normalized
 * schema. Different providers expose very different amounts of metadata:
 *
 *  - OpenRouter: rich (context_length, pricing, architecture, supported_parameters)
 *  - OpenAI /v1/models: minimal (id, owned_by) -> most fields 'unknown'
 *  - Ollama /api/tags: some details (size, family) but not capabilities
 *
 * Anything not explicitly present becomes 'unknown'. No guessing.
 */

function toNumberOrUnknown(value) {
  if (value === undefined || value === null || value === '') return UNKNOWN;
  const n = Number(value);
  return Number.isFinite(n) ? n : UNKNOWN;
}

/**
 * Parse an OpenRouter per-token price string ("0.0000012") into USD per 1M tokens.
 * @returns {number|'unknown'}
 */
function parsePricePerMillion(value) {
  if (value === undefined || value === null || value === '') return UNKNOWN;
  const n = Number(value);
  if (!Number.isFinite(n)) return UNKNOWN;
  return n * 1_000_000;
}

/**
 * Determine free status ONLY when pricing is explicitly present and zero.
 * @returns {boolean|'unknown'}
 */
function detectFree(inputPrice, outputPrice, rawId) {
  const idFree = typeof rawId === 'string' && /:free$/i.test(rawId);
  if (idFree) return true;
  if (inputPrice === UNKNOWN || outputPrice === UNKNOWN) return UNKNOWN;
  return inputPrice === 0 && outputPrice === 0;
}

/**
 * Extract capabilities from an OpenRouter-style model object.
 */
function fromOpenRouter(raw, providerName) {
  const model = createModel({
    id: raw.id || UNKNOWN,
    name: raw.name || raw.id || UNKNOWN,
    provider: providerName || UNKNOWN,
    source: 'openrouter',
    verifiedAt: new Date().toISOString(),
  });

  model.contextWindow = toNumberOrUnknown(raw.context_length ?? raw.top_provider?.context_length);
  model.maxOutputTokens = toNumberOrUnknown(raw.top_provider?.max_completion_tokens);

  if (raw.pricing) {
    model.inputPrice = parsePricePerMillion(raw.pricing.prompt);
    model.outputPrice = parsePricePerMillion(raw.pricing.completion);
  }
  model.free = detectFree(model.inputPrice, model.outputPrice, raw.id);

  const params = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : null;
  if (params) {
    model.tools = params.includes('tools') || params.includes('tool_choice');
    model.reasoning = params.includes('reasoning') || params.includes('include_reasoning');
    model.structuredOutput = params.includes('structured_outputs') || params.includes('response_format');
    if (model.reasoning) {
      // OpenRouter does not enumerate discrete efforts; leave unknown unless present.
      model.reasoningEfforts = UNKNOWN;
    } else {
      model.reasoning = false;
      model.reasoningEfforts = UNKNOWN;
    }
  }

  const inputModalities = raw.architecture?.input_modalities
    || (raw.architecture?.modality ? String(raw.architecture.modality).split('->')[0].split('+') : null);
  if (Array.isArray(inputModalities)) {
    model.vision = inputModalities.map((m) => String(m).toLowerCase()).includes('image');
  }

  // Streaming is universally supported on OpenRouter's OpenAI-compatible surface.
  model.streaming = true;

  // Coding suitability is a heuristic label only if clearly indicated by name.
  model.coding = detectCodingFromName(raw.name || raw.id);

  return model;
}

/**
 * Extract from a bare OpenAI /v1/models entry (very little metadata).
 */
function fromOpenAIList(raw, providerName) {
  return createModel({
    id: raw.id || UNKNOWN,
    name: raw.id || UNKNOWN,
    provider: providerName || UNKNOWN,
    streaming: true, // OpenAI-compatible chat endpoints support streaming
    source: 'openai-list',
    verifiedAt: new Date().toISOString(),
  });
}

/**
 * Extract from an Ollama /api/tags entry.
 */
function fromOllamaTag(raw, providerName) {
  const model = createModel({
    id: raw.model || raw.name || UNKNOWN,
    name: raw.name || raw.model || UNKNOWN,
    provider: providerName || UNKNOWN,
    streaming: true,
    source: 'ollama-tags',
    verifiedAt: new Date().toISOString(),
  });
  const ctx = raw.details?.parameter_size;
  // parameter_size is model size (e.g. "8B"), NOT context window — do not map it.
  if (ctx) model.name = `${model.name}`;
  return model;
}

/**
 * Heuristic: recognize coding-focused models by name markers ONLY. Returns
 * true when strongly indicated, else 'unknown' (never false-negative guessing).
 */
function detectCodingFromName(name) {
  if (!name || typeof name !== 'string') return UNKNOWN;
  const lower = name.toLowerCase();
  if (/(coder|code|deepseek|codestral|qwen.*coder|starcoder)/.test(lower)) return true;
  return UNKNOWN;
}

/**
 * Normalize a raw model from an arbitrary provider list.
 * @param {object} raw
 * @param {{ providerName?: string, shape?: string }} [options]
 */
function normalizeModel(raw, options = {}) {
  const providerName = options.providerName;
  const shape = options.shape;

  // Detect OpenRouter richness by presence of pricing/context_length/architecture.
  const looksOpenRouter = raw
    && (raw.pricing || raw.context_length !== undefined || raw.architecture || Array.isArray(raw.supported_parameters));

  if (shape === 'ollama' && raw && (raw.model || raw.details)) {
    return fromOllamaTag(raw, providerName);
  }
  if (looksOpenRouter) {
    return fromOpenRouter(raw, providerName);
  }
  return fromOpenAIList(raw, providerName);
}

module.exports = {
  toNumberOrUnknown,
  parsePricePerMillion,
  detectFree,
  detectCodingFromName,
  fromOpenRouter,
  fromOpenAIList,
  fromOllamaTag,
  normalizeModel,
};

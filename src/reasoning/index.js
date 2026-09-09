'use strict';

/**
 * Reasoning abstraction.
 *
 * Normalized scale (low -> high effort):
 *   none | minimal | low | medium | high | max
 *
 * PromptRelay normalizes any incoming reasoning signal to this scale, then maps
 * it to the provider-specific representation (OpenAI `reasoning_effort`,
 * Ollama `think`). An "auto" mode lets PromptRelay pick a sensible effort.
 */

const LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'max'];
const LEVEL_RANK = LEVELS.reduce((acc, level, index) => {
  acc[level] = index;
  return acc;
}, {});

const ALIASES = {
  off: 'none',
  disabled: 'none',
  false: 'none',
  fast: 'none',
  no: 'none',
  min: 'minimal',
  minimal: 'minimal',
  lowest: 'minimal',
  low: 'low',
  normal: 'medium',
  default: 'medium',
  balanced: 'medium',
  medium: 'medium',
  mid: 'medium',
  thinking: 'high',
  think: 'high',
  high: 'high',
  maximum: 'max',
  xhigh: 'max',
  extreme: 'max',
  max: 'max',
};

/**
 * Normalize any reasoning value to the canonical scale.
 * @param {*} value
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
function normalizeReasoning(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true) return 'high';
  if (value === false) return 'none';

  const v = String(value).trim().toLowerCase();
  const normalized = ALIASES[v] || v;
  return LEVELS.includes(normalized) ? normalized : fallback;
}

/**
 * Read the incoming reasoning signal from a request body, honoring config
 * defaults and auto mode.
 * @param {object} body
 * @param {object} config
 * @returns {string} a canonical level
 */
function incomingReasoning(body, config) {
  const explicit =
    body?.reasoning_effort ??
    body?.reasoningEffort ??
    body?.reasoning?.effort ??
    body?.think;

  const fallback = normalizeReasoning(config?.reasoning?.default, 'low') || 'low';

  if (explicit !== undefined) {
    const normalized = normalizeReasoning(explicit, fallback);
    if (normalized) return normalized;
  }

  if (config?.reasoning?.auto) {
    return autoReasoning(body, config);
  }

  return fallback;
}

/**
 * Auto mode: pick an effort based on request shape. Deterministic and simple:
 * tool-heavy or long conversations lean higher; trivial requests lean lower.
 * @param {object} body
 * @param {object} config
 * @returns {string}
 */
function autoReasoning(body, config) {
  const fallback = normalizeReasoning(config?.reasoning?.default, 'medium') || 'medium';
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const hasTools = Array.isArray(body?.tools) && body.tools.length > 0;

  const userText = messages
    .filter((m) => m && m.role === 'user')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join(' ');

  if (hasTools) return 'high';
  if (userText.length > 2000 || messages.length > 12) return 'high';
  if (userText.length > 400) return 'medium';
  return fallback;
}

/**
 * Map a canonical level to OpenAI `reasoning_effort`. OpenAI accepts
 * minimal|low|medium|high; `none` omits the field, `max` maps to high.
 * @param {string} level
 * @returns {string|null} null means "omit reasoning_effort"
 */
function toOpenAIEffort(level) {
  const normalized = normalizeReasoning(level, null);
  switch (normalized) {
    case 'none':
      return null;
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'max':
      return 'high';
    default:
      return null;
  }
}

/**
 * Apply reasoning to an OpenAI-compatible body: normalize into
 * `reasoning_effort`, strip PromptRelay-only reasoning fields, and inject the
 * default when configured.
 * @param {object} body
 * @param {object} config
 * @returns {object} a new body
 */
function applyOpenAIReasoning(body, config) {
  const out = { ...body };
  const explicit = body?.reasoning_effort ?? body?.reasoningEffort ?? body?.reasoning?.effort;

  // Remove non-standard/PromptRelay-only reasoning fields so they never leak.
  delete out.reasoningEffort;
  delete out.think;
  if (out.reasoning && typeof out.reasoning === 'object') delete out.reasoning;

  if (explicit !== undefined) {
    const effort = toOpenAIEffort(explicit);
    if (effort) out.reasoning_effort = effort;
    else delete out.reasoning_effort;
    return out;
  }

  if (config?.reasoning?.auto) {
    const level = autoReasoning(body, config);
    const effort = toOpenAIEffort(level);
    if (effort) out.reasoning_effort = effort;
    return out;
  }

  if (config?.reasoning?.injectDefault) {
    const effort = toOpenAIEffort(config.reasoning.default);
    if (effort) out.reasoning_effort = effort;
  }

  return out;
}

/**
 * Map a canonical level to Ollama `think`. Ollama accepts a boolean or a level
 * string (low|medium|high for supported models). `none` -> false.
 * @param {*} value
 * @returns {boolean|string}
 */
function toOllamaThink(value) {
  const normalized = normalizeReasoning(value, 'low');
  switch (normalized) {
    case 'none':
      return false;
    case 'minimal':
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
    case 'max':
      return 'high';
    default:
      return normalized === 'none' ? false : normalized;
  }
}

module.exports = {
  LEVELS,
  LEVEL_RANK,
  ALIASES,
  normalizeReasoning,
  incomingReasoning,
  autoReasoning,
  applyOpenAIReasoning,
  toOpenAIEffort,
  toOllamaThink,
};

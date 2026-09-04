function normalizeReasoning(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true) return 'high';
  if (value === false) return 'none';

  const v = String(value).trim().toLowerCase();
  const aliases = {
    off: 'none',
    disabled: 'none',
    false: 'none',
    fast: 'none',
    minimal: 'low',
    normal: 'medium',
    default: 'medium',
    thinking: 'high',
    think: 'high',
    maximum: 'max',
    xhigh: 'max',
    extreme: 'max',
  };

  const normalized = aliases[v] || v;
  return ['none', 'low', 'medium', 'high', 'max'].includes(normalized)
    ? normalized
    : fallback;
}

function incomingReasoning(body, config) {
  const explicit =
    body?.reasoning_effort ??
    body?.reasoningEffort ??
    body?.reasoning?.effort ??
    body?.think;

  if (explicit !== undefined) {
    return normalizeReasoning(explicit, config.reasoning.default || 'low');
  }

  return normalizeReasoning(config.reasoning.default, 'low');
}

function applyOpenAIReasoning(body, config) {
  const out = { ...body };
  const explicit = body?.reasoning_effort ?? body?.reasoningEffort ?? body?.reasoning?.effort;

  delete out.reasoningEffort;

  if (explicit !== undefined) {
    const normalized = normalizeReasoning(explicit, null);
    if (normalized) out.reasoning_effort = normalized;
    return out;
  }

  if (config.reasoning.injectDefault) {
    const fallback = normalizeReasoning(config.reasoning.default, null);
    if (fallback) out.reasoning_effort = fallback;
  }

  return out;
}

function toOllamaThink(value) {
  const normalized = normalizeReasoning(value, 'low');
  return normalized === 'none' ? false : normalized;
}

module.exports = {
  normalizeReasoning,
  incomingReasoning,
  applyOpenAIReasoning,
  toOllamaThink,
};

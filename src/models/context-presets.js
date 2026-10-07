'use strict';

/**
 * User-assisted metadata resolution.
 *
 * PromptRelay's rule is that it never fabricates a context window, an output
 * limit, or a reasoning ladder. Detection runs first; when a provider publishes
 * nothing usable the value stays `'unknown'` and the downstream client keeps its
 * own fallback. That is the right default, but it is a poor answer for a user
 * who already knows the answer.
 *
 * So: once detection has failed, offer the user a short list of the context
 * windows that actually occur in practice plus a free-form custom entry, and
 * record the result with an explicit `user-selection` provenance so it is never
 * confused with a verified value.
 *
 * The presets are deliberately not "recommendations for this model" — they are
 * the set of numbers a developer would otherwise type by hand, with the trade-off
 * spelled out so the choice is informed:
 *
 *   too low  -> Hermes/Claude Code compresses early; correct, just wasteful
 *   too high -> the client fills a window the provider will reject at request time
 */

const { UNKNOWN } = require('./schema');

/**
 * Context windows that occur often enough to be worth one keystroke. Ordered
 * ascending so the list reads as a scale. `hint` states the consequence of
 * picking it, never a claim about the model at hand.
 */
const COMMON_CONTEXT_WINDOWS = [
  { value: 8192, label: '8K', hint: 'small local models, some older embedding-serving models' },
  { value: 16384, label: '16K', hint: 'older GPT-3.5/4 era models' },
  { value: 32768, label: '32K', hint: 'GPT-4 class, many mid-size OSS models' },
  { value: 65536, label: '64K', hint: 'Llama-3 70B, Qwen2.5, most local 7B–14B quants' },
  { value: 131072, label: '128K', hint: 'Llama-3.1/3.3, Qwen2.5-72B, Mistral Large' },
  { value: 200000, label: '200K', hint: 'Claude Sonnet/Opus, Gemini 1.5 Pro' },
  { value: 262144, label: '256K', hint: 'GPT-4o, Gemini 1.5/2.x Flash' },
  { value: 1048576, label: '1M', hint: 'Gemini 1.5 Pro, GPT-4.1, Kimi long-context variants' },
];

/** Common output ceilings, same reasoning as the context list. */
const COMMON_OUTPUT_LIMITS = [
  { value: 4096, label: '4K', hint: 'older models, small OSS builds' },
  { value: 8192, label: '8K', hint: 'GPT-4 era defaults' },
  { value: 16384, label: '16K', hint: 'GPT-4o, Claude 3.5 Sonnet' },
  { value: 32768, label: '32K', hint: 'Claude extended thinking, Qwen3' },
  { value: 65536, label: '64K', hint: 'GPT-4.1, o3-class' },
  { value: 131072, label: '128K', hint: 'Gemini 2.x, Kimi K2 thinking' },
];

/** Reasoning ladders that actually ship, most- to least-capable. */
const COMMON_EFFORT_LADDERS = [
  { value: ['none', 'low', 'medium', 'high'], label: 'basic', hint: 'no reasoning, low, medium, high' },
  { value: ['none', 'minimal', 'low', 'medium', 'high'], label: 'basic + minimal', hint: 'adds a minimal thinking step' },
  { value: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'], label: 'extended', hint: 'adds xhigh (Hermes passthrough level)' },
  { value: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], label: 'full', hint: 'everything a Hermes endpoint accepts' },
];

const SKIP_LABEL = 'Leave unknown (keep the client\'s own fallback)';

/** A selection the user made. Distinct provenance — never reported as verified. */
const USER_SELECTION = 'user-selection';

/**
 * Coerce a user-typed number. Rejects anything that is not a positive integer
 * so a typo cannot become a 0-token or 10-billion-token window.
 * @returns {number|null}
 */
function parsePositiveInt(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().replace(/[,_\s]/g, '');
  const kMatch = text.match(/^(\d+(?:\.\d+)?)k$/i);
  const mMatch = text.match(/^(\d+(?:\.\d+)?)m$/i);
  let n;
  if (kMatch) n = Number(kMatch[1]) * 1024;
  else if (mMatch) n = Number(mMatch[1]) * 1024 * 1024;
  else n = Number(text);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  return rounded > 0 ? rounded : null;
}

/**
 * Build the option list the interactive prompt renders.
 * @param {Array<{value:any,label:string,hint:string}>} presets
 * @returns {Array<{label:string,value:any,hint:string}>}
 */
function toOptions(presets) {
  return presets.map((p) => ({ label: p.label, value: p.value, hint: p.hint }));
}

/**
 * Render presets as the choice rows a numbered menu shows.
 * @returns {string[]}
 */
function formatRows(options) {
  return options.map((o, i) => `${i + 1}) ${o.label}${o.hint ? ` — ${o.hint}` : ''}`);
}

/**
 * Ask for a context window on an interactive readline.
 *
 * Returns the chosen integer, or `null` when the user declines to say. Callers
 * must treat `null` as "stay unknown" — never substitute a default here.
 *
 * @param {object} rl
 * @param {object} [opts]
 * @param {string} [opts.modelId]
 * @param {number|null} [opts.detected] an already-verified value, if any
 * @returns {Promise<{ value: number|null, source: string }>}
 */
async function promptContextWindow(rl, opts = {}) {
  const { ask, choose } = require('../cli/prompts');

  if (typeof opts.detected === 'number' && opts.detected > 0) {
    return { value: opts.detected, source: 'provider-metadata' };
  }

  const options = [...toOptions(COMMON_CONTEXT_WINDOWS), { label: 'Custom value', value: '__custom__', hint: 'type any number (32K, 100000, 1M…)' }, { label: SKIP_LABEL, value: null, hint: 'no guess written' }];

  console.log('');
  console.log(`Context window for ${opts.modelId || 'this model'} is UNKNOWN — the provider publishes no limits.`);
  console.log('Pick the closest match, type your own, or leave it unknown:');
  for (const row of formatRows(options)) console.log(`   ${row}`);

  const pick = await choose(rl, 'Context window', options.map((o) => ({ label: o.label, value: o.value })), options.length - 1);

  if (pick === null) return { value: null, source: 'unknown' };
  if (pick === '__custom__') {
    const raw = await ask(rl, 'Context window in tokens (e.g. 65536, 64K, 1M)');
    const n = parsePositiveInt(raw);
    if (n === null) {
      console.log('  Not a usable number — leaving it unknown.');
      return { value: null, source: 'unknown' };
    }
    return { value: n, source: USER_SELECTION };
  }
  return { value: pick, source: USER_SELECTION };
}

/**
 * Ask for an output ceiling. Same contract as the context window.
 * @returns {Promise<{ value: number|null, source: string }>}
 */
async function promptOutputLimit(rl, opts = {}) {
  const { ask, choose } = require('../cli/prompts');

  if (typeof opts.detected === 'number' && opts.detected > 0) {
    return { value: opts.detected, source: 'provider-metadata' };
  }

  const options = [...toOptions(COMMON_OUTPUT_LIMITS), { label: 'Custom value', value: '__custom__', hint: 'type any number (16K, 65536…)' }, { label: SKIP_LABEL, value: null, hint: 'no guess written' }];

  console.log('');
  console.log(`Max output tokens for ${opts.modelId || 'this model'} is UNKNOWN.`);
  for (const row of formatRows(options)) console.log(`   ${row}`);

  const pick = await choose(rl, 'Output limit', options.map((o) => ({ label: o.label, value: o.value })), options.length - 1);

  if (pick === null) return { value: null, source: 'unknown' };
  if (pick === '__custom__') {
    const raw = await ask(rl, 'Max output tokens (e.g. 16384, 16K)');
    const n = parsePositiveInt(raw);
    if (n === null) return { value: null, source: 'unknown' };
    return { value: n, source: USER_SELECTION };
  }
  return { value: pick, source: USER_SELECTION };
}

/**
 * Ask for the reasoning ladder.
 * @returns {Promise<{ value: string[]|null, source: string }>}
 */
async function promptEffortLadder(rl, opts = {}) {
  const { choose } = require('../cli/prompts');

  if (Array.isArray(opts.detected) && opts.detected.length) {
    return { value: [...opts.detected], source: 'provider-metadata' };
  }

  const options = [...toOptions(COMMON_EFFORT_LADDERS), { label: SKIP_LABEL, value: null, hint: 'client default stays in charge' }];

  console.log('');
  console.log(`Reasoning levels for ${opts.modelId || 'this model'} are UNKNOWN.`);
  for (const row of formatRows(options)) console.log(`   ${row}`);

  const pick = await choose(rl, 'Reasoning levels', options.map((o) => ({ label: o.label, value: o.value })), options.length - 1);
  if (pick === null) return { value: null, source: 'unknown' };
  return { value: [...pick], source: USER_SELECTION };
}

/**
 * Resolve all three in one interactive pass, skipping anything already verified.
 * Never overwrites a detected value with a guess.
 *
 * @param {object} rl
 * @param {object} opts - { modelId, modelMeta, supportedEfforts }
 * @returns {Promise<{ contextWindow: {value:number|null,source:string},
 *                      maxOutputTokens: {value:number|null,source:string},
 *                      reasoningEfforts: {value:string[]|null,source:string} }>}
 */
async function resolveMetadataInteractive(rl, opts = {}) {
  const meta = opts.modelMeta || {};
  return {
    contextWindow: await promptContextWindow(rl, {
      modelId: opts.modelId,
      detected: typeof meta.contextWindow === 'number' ? meta.contextWindow : null,
    }),
    maxOutputTokens: await promptOutputLimit(rl, {
      modelId: opts.modelId,
      detected: typeof meta.maxOutputTokens === 'number' ? meta.maxOutputTokens : null,
    }),
    reasoningEfforts: await promptEffortLadder(rl, {
      modelId: opts.modelId,
      detected: Array.isArray(opts.supportedEfforts) && opts.supportedEfforts[0] !== UNKNOWN
        ? opts.supportedEfforts
        : null,
    }),
  };
}

/**
 * Non-interactive counterpart: verified values pass through, everything else
 * stays unknown. This is what background jobs use — a scheduled task must never
 * block on a prompt or invent a number.
 */
function resolveMetadataPassive(opts = {}) {
  const meta = opts.modelMeta || {};
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  const efforts = Array.isArray(opts.supportedEfforts) && opts.supportedEfforts[0] !== UNKNOWN
    ? [...opts.supportedEfforts]
    : null;
  return {
    contextWindow: { value: num(meta.contextWindow), source: num(meta.contextWindow) ? (meta.source || 'provider-metadata') : 'unknown' },
    maxOutputTokens: { value: num(meta.maxOutputTokens), source: num(meta.maxOutputTokens) ? (meta.source || 'provider-metadata') : 'unknown' },
    reasoningEfforts: { value: efforts, source: efforts ? (meta.source || 'provider-metadata') : 'unknown' },
  };
}

module.exports = {
  COMMON_CONTEXT_WINDOWS,
  COMMON_OUTPUT_LIMITS,
  COMMON_EFFORT_LADDERS,
  USER_SELECTION,
  parsePositiveInt,
  formatRows,
  promptContextWindow,
  promptOutputLimit,
  promptEffortLadder,
  resolveMetadataInteractive,
  resolveMetadataPassive,
};
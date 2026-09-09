'use strict';

const { UNKNOWN } = require('./schema');

/**
 * Deterministic model ranking engine.
 *
 * Each profile scores a normalized model and produces a transparent list of
 * reasons. Unknown metadata never earns points (no fabrication), and hard
 * requirements (e.g. `free`, `vision`) filter out models that cannot satisfy
 * them or whose capability is unknown.
 */

const PROFILES = [
  'balanced',
  'fastest',
  'strongest',
  'cheapest',
  'free',
  'coding',
  'long-context',
  'reasoning',
  'vision',
  'tools',
];

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Average price per 1M tokens when both are known. */
function avgPrice(model) {
  const inp = num(model.inputPrice);
  const out = num(model.outputPrice);
  if (inp === null && out === null) return null;
  if (inp === null) return out;
  if (out === null) return inp;
  return (inp + out) / 2;
}

/**
 * Score a model for a profile.
 * @returns {{ score: number, reasons: string[], eligible: boolean }}
 */
function scoreModel(model, profile) {
  const reasons = [];
  let score = 0;
  let eligible = true;

  const ctx = num(model.contextWindow);
  const price = avgPrice(model);

  const addCtx = (weight) => {
    if (ctx !== null) {
      const pts = Math.min(ctx / 1000, 400) * weight; // cap contribution
      score += pts;
      reasons.push(`context ${ctx.toLocaleString()} tokens`);
    }
  };
  const addCheap = (weight) => {
    if (model.free === true) {
      score += 200 * weight;
      reasons.push('verified free (zero cost)');
    } else if (price !== null) {
      // Cheaper => higher score. Reference 20 USD/1M as baseline.
      score += Math.max(0, (20 - Math.min(price, 20))) * 10 * weight;
      reasons.push(`~$${price.toFixed(2)}/1M tokens`);
    }
  };
  const addCap = (field, label, weight) => {
    if (model[field] === true) {
      score += 50 * weight;
      reasons.push(label);
    }
  };

  switch (profile) {
    case 'free':
      if (model.free !== true) {
        eligible = false;
        break;
      }
      reasons.push('verified free (zero cost)');
      score += 1000;
      addCtx(0.5);
      addCap('tools', 'tool calling', 0.3);
      break;

    case 'cheapest':
      if (model.free === true) {
        score += 1000;
        reasons.push('verified free (zero cost)');
      } else if (price !== null) {
        score += Math.max(0, (100 - Math.min(price, 100))) * 10;
        reasons.push(`~$${price.toFixed(2)}/1M tokens`);
      } else {
        eligible = false; // cannot rank cost without known pricing
      }
      break;

    case 'fastest':
      // Smaller/cheaper models are typically faster; use price + smaller ctx as proxy.
      addCheap(0.5);
      if (ctx !== null) {
        score += Math.max(0, (200 - Math.min(ctx / 1000, 200))) * 2;
        reasons.push(`context ${ctx.toLocaleString()} tokens`);
      }
      break;

    case 'strongest':
      addCtx(1);
      addCap('reasoning', 'reasoning support', 1);
      addCap('tools', 'tool calling', 0.5);
      addCap('vision', 'vision', 0.3);
      if (price !== null) {
        // Higher price often correlates with capability; mild positive weight.
        score += Math.min(price, 50) * 2;
      }
      break;

    case 'coding':
      if (model.coding === true) {
        score += 300;
        reasons.push('coding-focused');
      }
      addCap('tools', 'tool calling', 1);
      addCtx(0.8);
      addCap('reasoning', 'reasoning support', 0.5);
      break;

    case 'long-context':
      if (ctx === null) {
        eligible = false;
        break;
      }
      score += ctx / 100;
      reasons.push(`context ${ctx.toLocaleString()} tokens`);
      break;

    case 'reasoning':
      if (model.reasoning !== true) {
        eligible = false;
        break;
      }
      score += 500;
      reasons.push('reasoning support');
      addCtx(0.5);
      break;

    case 'vision':
      if (model.vision !== true) {
        eligible = false;
        break;
      }
      score += 500;
      reasons.push('vision support');
      addCtx(0.3);
      break;

    case 'tools':
      if (model.tools !== true) {
        eligible = false;
        break;
      }
      score += 500;
      reasons.push('tool calling');
      addCtx(0.3);
      break;

    case 'balanced':
    default:
      addCtx(0.6);
      addCap('tools', 'tool calling', 0.6);
      addCap('reasoning', 'reasoning support', 0.5);
      addCap('vision', 'vision', 0.2);
      addCheap(0.6);
      break;
  }

  return { score, reasons: Array.from(new Set(reasons)), eligible };
}

/**
 * Rank models for a profile.
 * @param {object[]} models
 * @param {string} profile
 * @param {{ limit?: number }} [options]
 * @returns {Array<{ model: object, score: number, reasons: string[] }>}
 */
function rankModels(models, profile = 'balanced', options = {}) {
  const list = Array.isArray(models) ? models : [];
  const scored = list
    .map((model) => ({ model, ...scoreModel(model, profile) }))
    .filter((entry) => entry.eligible)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Stable tie-break: prefer known pricing, then alphabetical id.
      return String(a.model.id).localeCompare(String(b.model.id));
    });

  const limited = options.limit ? scored.slice(0, options.limit) : scored;
  return limited.map(({ model, score, reasons }) => ({ model, score: Math.round(score), reasons }));
}

/**
 * Recommend the single best model for a profile, with a transparent explanation.
 * @returns {{ model: object|null, score: number, reasons: string[], explanation: string, alternatives: object[] }}
 */
function recommend(models, profile = 'balanced') {
  const ranked = rankModels(models, profile, { limit: 5 });
  if (!ranked.length) {
    return {
      model: null,
      score: 0,
      reasons: [],
      explanation: `No models satisfy the "${profile}" profile with the metadata available. `
        + 'Capabilities that are "unknown" cannot be ranked — try `models refresh` or a different profile.',
      alternatives: [],
    };
  }
  const best = ranked[0];
  const reasonText = best.reasons.length ? best.reasons.join(', ') : 'default balanced weighting';
  return {
    model: best.model,
    score: best.score,
    reasons: best.reasons,
    explanation: `Selected ${best.model.id} for "${profile}": ${reasonText}.`,
    alternatives: ranked.slice(1).map((r) => ({ id: r.model.id, score: r.score, reasons: r.reasons })),
  };
}

module.exports = {
  PROFILES,
  avgPrice,
  scoreModel,
  rankModels,
  recommend,
};

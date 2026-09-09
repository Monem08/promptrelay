'use strict';

/**
 * Normalized model metadata schema.
 *
 * Every field supports three states: a concrete value, or the string 'unknown'
 * when the information could not be discovered from provider metadata.
 * PromptRelay NEVER fabricates capabilities, pricing, or context windows.
 */

const UNKNOWN = 'unknown';

const FIELDS = [
  'id',
  'name',
  'provider',
  'contextWindow',
  'maxOutputTokens',
  'inputPrice', // USD per 1M input tokens
  'outputPrice', // USD per 1M output tokens
  'free',
  'reasoning',
  'reasoningEfforts',
  'tools',
  'vision',
  'streaming',
  'structuredOutput',
  'coding',
  'source',
  'verifiedAt',
];

/**
 * Create a normalized model object with all fields defaulting to 'unknown'.
 * @param {object} [overrides]
 * @returns {object}
 */
function createModel(overrides = {}) {
  const base = {};
  for (const field of FIELDS) base[field] = UNKNOWN;
  base.reasoningEfforts = UNKNOWN;
  return { ...base, ...overrides };
}

function isUnknown(value) {
  return value === UNKNOWN || value === undefined || value === null;
}

function isKnownTrue(value) {
  return value === true;
}

module.exports = {
  UNKNOWN,
  FIELDS,
  createModel,
  isUnknown,
  isKnownTrue,
};

'use strict';

/**
 * Model reasoning variant & effort detection.
 *
 * Automatically detects supported reasoning variants for a model using priority:
 * 1. Provider/model metadata returned by the provider.
 * 2. Model capability/variant metadata already available through PromptRelay's model discovery system.
 * 3. Provider-specific documented metadata exposed through the API.
 * 4. Existing PromptRelay verified capability cache.
 * 5. Safe model/provider-specific mapping only when capability is actually known (VERIFIED_COMPATIBILITY).
 *
 * Never fabricates capabilities or guesses from UNKNOWN.
 * Rule: VERIFIED > USER-SELECTED > UNKNOWN
 */

const VERIFIED_COMPATIBILITY = {
  'space-bunny-free': {
    efforts: ['low', 'medium', 'high', 'xhigh'],
    default: 'high',
    source: 'verified-compatibility',
  },
  'o1': {
    efforts: ['low', 'medium', 'high'],
    default: 'medium',
    source: 'verified-compatibility',
  },
  'o1-mini': {
    efforts: ['low', 'medium', 'high'],
    default: 'medium',
    source: 'verified-compatibility',
  },
  'o3-mini': {
    efforts: ['low', 'medium', 'high'],
    default: 'medium',
    source: 'verified-compatibility',
  },
};

/**
 * Extract reasoning efforts from a raw provider response or object if present.
 * @param {object} raw
 * @returns {string[]|null}
 */
function extractReasoningEfforts(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const candidate =
    raw.reasoning_efforts ??
    raw.reasoningEfforts ??
    raw.supported_reasoning_efforts ??
    raw.supported_efforts ??
    raw.capabilities?.reasoning_efforts ??
    raw.capabilities?.reasoning?.efforts;

  if (Array.isArray(candidate) && candidate.length > 0) {
    return candidate.map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  }

  if (raw.variants && typeof raw.variants === 'object') {
    if (Array.isArray(raw.variants)) {
      return raw.variants.map((v) => (typeof v === 'string' ? v : (v.id || v.name))).filter(Boolean);
    }
    return Object.keys(raw.variants).map((k) => k.toLowerCase().trim());
  }

  return null;
}

/**
 * Detect reasoning variants supported by a given model and provider.
 *
 * @param {string} modelId
 * @param {object} [providerConfig]
 * @param {object} [options]
 * @returns {{ supported: boolean, efforts: string[]|'unknown', source: string, default?: string }}
 */
function detectReasoningVariants(modelId, providerConfig = {}, options = {}) {
  const id = String(modelId || providerConfig?.model || '').trim();
  if (!id) return { supported: false, efforts: 'unknown', source: 'unknown' };

  // 1. Provider/model metadata returned by the provider
  const raw = options.raw || options.modelMeta?.raw;
  const rawEfforts = extractReasoningEfforts(raw);
  if (rawEfforts) {
    return { supported: true, efforts: rawEfforts, source: 'provider-metadata' };
  }

  // 2. Model capability/variant metadata already available through model discovery
  const modelMeta = options.modelMeta;
  if (
    modelMeta &&
    Array.isArray(modelMeta.reasoningEfforts) &&
    modelMeta.reasoningEfforts.length > 0 &&
    modelMeta.reasoningEfforts[0] !== 'unknown'
  ) {
    return {
      supported: true,
      efforts: [...modelMeta.reasoningEfforts],
      source: modelMeta.source || 'provider-metadata',
    };
  }

  // 3. Provider-specific documented metadata exposed through the API
  if (options.apiMetadata && Array.isArray(options.apiMetadata.efforts)) {
    return { supported: true, efforts: [...options.apiMetadata.efforts], source: 'api-metadata' };
  }

  // 4. Existing PromptRelay verified capability cache
  const cachedModel = options.cachedModel;
  if (
    cachedModel &&
    Array.isArray(cachedModel.reasoningEfforts) &&
    cachedModel.reasoningEfforts.length > 0 &&
    cachedModel.reasoningEfforts[0] !== 'unknown'
  ) {
    return { supported: true, efforts: [...cachedModel.reasoningEfforts], source: 'cache' };
  }

  // 5. Safe model/provider-specific mapping only when capability is actually known
  const verified = VERIFIED_COMPATIBILITY[id];
  if (verified) {
    return {
      supported: true,
      efforts: [...verified.efforts],
      default: verified.default,
      source: verified.source,
    };
  }

  // Fallback: capability is unknown (do NOT guess)
  return { supported: false, efforts: 'unknown', source: 'unknown' };
}

/**
 * Interactive prompt when reasoning variant detection fails.
 *
 * @param {object} rl - readline interface
 * @returns {Promise<{ supported: string[]|'unknown', default: string, injectDefault: boolean, choiceText: string }>}
 */
async function promptReasoningVariants(rl) {
  console.log('');
  console.log('Detected reasoning variants: UNKNOWN');
  console.log('');
  console.log('Choose:');
  console.log('  1) None / provider default');
  console.log('  2) low, medium, high');
  console.log('  3) low, medium, high, xhigh, max');
  console.log('  4) Custom');
  console.log('');

  while (true) {
    const raw = await rl.question('Selection: ');
    const choice = String(raw || '').trim();

    if (choice === '1' || choice.toLowerCase() === 'none') {
      console.log('Selected: None / provider default');
      return {
        supported: 'unknown',
        default: 'none',
        injectDefault: false,
        choiceText: 'None / provider default',
      };
    }

    if (choice === '2') {
      console.log('Selected: low, medium, high');
      return {
        supported: ['low', 'medium', 'high'],
        default: 'high',
        injectDefault: true,
        choiceText: 'low, medium, high',
      };
    }

    if (choice === '3') {
      console.log('Selected: low, medium, high, xhigh, max');
      return {
        supported: ['low', 'medium', 'high', 'xhigh', 'max'],
        default: 'high',
        injectDefault: true,
        choiceText: 'low, medium, high, xhigh, max',
      };
    }

    if (choice === '4' || choice.toLowerCase() === 'custom') {
      const customRaw = await rl.question('Enter supported variants (comma-separated): ');
      const variants = customRaw
        .split(/[,\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

      if (!variants.length) {
        console.log('Please enter at least one variant.');
        continue;
      }

      console.log(`Selected: Custom (${variants.join(', ')})`);
      return {
        supported: variants,
        default: variants[variants.length - 1],
        injectDefault: true,
        choiceText: `Custom (${variants.join(', ')})`,
      };
    }

    console.log('Please choose 1, 2, 3, or 4.');
  }
}

/**
 * Resolve model reasoning effort and supported variants.
 * Respects interactive vs. non-interactive environments.
 *
 * @param {string} modelId
 * @param {object} [providerConfig]
 * @param {object} [options]
 * @returns {Promise<{ supported: string[]|'unknown', default: string, injectDefault: boolean, source: string, detected: boolean }>}
 */
async function resolveModelReasoning(modelId, providerConfig = {}, options = {}) {
  const detected = detectReasoningVariants(modelId, providerConfig, options);

  if (detected.supported) {
    return {
      supported: detected.efforts,
      default: detected.default || (detected.efforts.includes('high') ? 'high' : detected.efforts[detected.efforts.length - 1]),
      source: detected.source,
      injectDefault: false,
      detected: true,
    };
  }

  // When detection fails:
  if (options.interactive && options.rl) {
    console.log('\nCould not automatically detect the reasoning variants supported by this model.');
    const userSelection = await promptReasoningVariants(options.rl);
    return {
      supported: userSelection.supported,
      default: userSelection.default,
      injectDefault: userSelection.injectDefault,
      source: 'user-selection',
      detected: false,
    };
  }

  // Non-interactive / automation mode: never hang
  if (options.quiet !== true) {
    console.log('Detected reasoning variants: UNKNOWN');
  }

  return {
    supported: 'unknown',
    default: 'low',
    injectDefault: false,
    source: 'unknown',
    detected: false,
  };
}

module.exports = {
  VERIFIED_COMPATIBILITY,
  extractReasoningEfforts,
  detectReasoningVariants,
  promptReasoningVariants,
  resolveModelReasoning,
};

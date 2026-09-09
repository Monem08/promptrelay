'use strict';

/**
 * Versioned configuration schema and hard-coded defaults.
 *
 * The config format is versioned so PromptRelay can migrate older files
 * automatically (see ./migrate.js). Bump CONFIG_VERSION whenever the on-disk
 * shape changes in a way that needs a migration.
 */

const CONFIG_VERSION = 2;

const PROMPT_MODES = ['replace', 'prepend', 'append', 'passthrough'];
const TRANSPORTS = ['openai-compatible', 'ollama-native', 'anthropic-native'];
const AUTH_TYPES = ['bearer', 'header', 'none'];
const REASONING_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'max'];

const DEFAULTS = {
  version: CONFIG_VERSION,
  server: {
    host: '127.0.0.1',
    port: 4141,
  },
  prompt: {
    mode: 'replace',
    file: 'system_prompt.txt',
    placeholder: '{Paste your instructions here}',
  },
  provider: {
    name: 'OpenRouter',
    transport: 'openai-compatible',
    baseURL: 'https://openrouter.ai/api/v1',
    model: 'openrouter/auto',
    forceModel: true,
    apiKeyEnv: 'PROVIDER_API_KEY',
    auth: {
      type: 'bearer',
    },
    headers: {
      'HTTP-Referer': 'https://github.com/Monem08/promptrelay',
      'X-Title': 'PromptRelay',
    },
  },
  // Named provider profiles (registry). Optional; the active provider always
  // lives in `provider` for backward compatibility.
  providers: {},
  reasoning: {
    default: 'low',
    injectDefault: false,
    // 'auto' lets PromptRelay pick a reasonable effort per request.
    auto: false,
  },
  // Reliability configuration.
  retry: {
    enabled: true,
    maxRetries: 2,
    baseDelayMs: 500,
    maxDelayMs: 8000,
    // HTTP status codes that are safe to retry.
    retryableStatus: [429, 502, 503, 504],
  },
  // Explicit, configurable fallback routing (never silent).
  fallback: {
    enabled: false,
    // Array of provider profile names (from `providers`) to try in order.
    providers: [],
  },
  logging: {
    requests: true,
  },
};

module.exports = {
  CONFIG_VERSION,
  DEFAULTS,
  PROMPT_MODES,
  TRANSPORTS,
  AUTH_TYPES,
  REASONING_LEVELS,
};

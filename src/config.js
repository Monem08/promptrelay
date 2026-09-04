const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_FILE = path.join(ROOT, 'promptrelay.json');

const DEFAULTS = {
  server: {
    host: '127.0.0.1',
    port: 4141,
  },
  prompt: {
    mode: 'replace',
    file: 'system_prompt.txt',
    placeholder: '{Ekane tor intrison paste kot}',
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
  reasoning: {
    default: 'low',
    injectDefault: false,
  },
  logging: {
    requests: true,
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) {
    return override === undefined ? base : override;
  }

  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      out[key] = deepMerge(base?.[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

function resolveConfigFile() {
  return path.resolve(process.env.PROMPTRELAY_CONFIG || DEFAULT_CONFIG_FILE);
}

function normalizeBaseURL(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function loadConfig() {
  const file = resolveConfigFile();
  const fileConfig = fs.existsSync(file) ? readJson(file) : {};
  const config = deepMerge(DEFAULTS, fileConfig);

  config.server.host = process.env.PROMPTRELAY_HOST || config.server.host;
  config.server.port = Number(process.env.PORT || process.env.PROMPTRELAY_PORT || config.server.port);

  config.provider.baseURL = normalizeBaseURL(
    process.env.PROMPTRELAY_BASE_URL || config.provider.baseURL,
  );
  config.provider.model = process.env.PROMPTRELAY_MODEL || config.provider.model;
  config.provider.transport = String(
    process.env.PROMPTRELAY_TRANSPORT || config.provider.transport,
  ).toLowerCase();
  config.provider.name = process.env.PROMPTRELAY_PROVIDER_NAME || config.provider.name;

  const forceModelEnv = process.env.PROMPTRELAY_FORCE_MODEL;
  if (forceModelEnv !== undefined) {
    config.provider.forceModel = String(forceModelEnv).toLowerCase() !== 'false';
  }

  config.prompt.mode = String(process.env.PROMPTRELAY_PROMPT_MODE || config.prompt.mode).toLowerCase();
  config.reasoning.default = process.env.PROMPTRELAY_DEFAULT_REASONING || config.reasoning.default;

  const apiKeyEnv = config.provider.apiKeyEnv || 'PROVIDER_API_KEY';
  config.provider.apiKeyEnv = apiKeyEnv;
  config.provider.apiKey = process.env[apiKeyEnv] || process.env.PROVIDER_API_KEY || '';

  config.paths = {
    root: ROOT,
    configFile: file,
    promptFile: path.resolve(ROOT, config.prompt.file || 'system_prompt.txt'),
  };

  return config;
}

function validateConfig(config) {
  const problems = [];
  const promptModes = new Set(['replace', 'prepend', 'append', 'passthrough']);
  const transports = new Set(['openai-compatible', 'ollama-native']);

  if (!config.provider.baseURL) problems.push('provider.baseURL is required');
  if (!config.provider.model) problems.push('provider.model is required');
  if (!transports.has(config.provider.transport)) {
    problems.push(`provider.transport must be one of: ${Array.from(transports).join(', ')}`);
  }
  if (!promptModes.has(config.prompt.mode)) {
    problems.push(`prompt.mode must be one of: ${Array.from(promptModes).join(', ')}`);
  }
  if (!Number.isFinite(config.server.port) || config.server.port <= 0) {
    problems.push('server.port must be a positive number');
  }

  const authType = String(config.provider.auth?.type || 'bearer').toLowerCase();
  if (!['bearer', 'header', 'none'].includes(authType)) {
    problems.push('provider.auth.type must be bearer, header, or none');
  }

  return problems;
}

function safeConfig(config) {
  return {
    server: config.server,
    prompt: {
      mode: config.prompt.mode,
      file: config.paths.promptFile,
    },
    provider: {
      name: config.provider.name,
      transport: config.provider.transport,
      baseURL: config.provider.baseURL,
      model: config.provider.model,
      forceModel: config.provider.forceModel,
      apiKeyEnv: config.provider.apiKeyEnv,
      apiKeyConfigured: Boolean(config.provider.apiKey),
      authType: config.provider.auth?.type || 'bearer',
    },
    reasoning: config.reasoning,
    configFile: config.paths.configFile,
  };
}

module.exports = {
  ROOT,
  DEFAULTS,
  loadConfig,
  validateConfig,
  safeConfig,
};

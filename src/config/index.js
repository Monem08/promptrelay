'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { CONFIG_VERSION, DEFAULTS } = require('./schema');
const { validateConfig } = require('./validate');
const { migrateConfig } = require('./migrate');
const { maskSecret } = require('../telemetry/secrets');
const { normalizeBaseURL } = require('../providers/urls');

const ENV_AT_START = { ...process.env };
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..');
const USER_ROOT = path.resolve(
  process.env.PROMPTRELAY_HOME || path.join(os.homedir(), '.promptrelay'),
);
const PACKAGE_CONFIG_FILE = path.join(PACKAGE_ROOT, 'promptrelay.json');
const USER_CONFIG_FILE = path.join(USER_ROOT, 'promptrelay.json');

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
  if (process.env.PROMPTRELAY_CONFIG) {
    return path.resolve(process.env.PROMPTRELAY_CONFIG);
  }
  const cwdConfig = path.resolve(process.cwd(), 'promptrelay.json');
  if (fs.existsSync(cwdConfig)) return cwdConfig;
  if (fs.existsSync(USER_CONFIG_FILE)) return USER_CONFIG_FILE;
  return PACKAGE_CONFIG_FILE;
}

function unquoteEnv(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.startsWith('"') && text.endsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {}
  }
  if (text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1);
  }
  return text;
}

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    const value = unquoteEnv(line.slice(index + 1));
    // Values that existed before PromptRelay loaded always win, so real env
    // vars take precedence and ~/.promptrelay/.env edits hot-reload safely.
    if (ENV_AT_START[key] === undefined) process.env[key] = value;
  }
}

/**
 * Resolve the active provider from a registry when `activeProvider` is set.
 * Falls back to the inline `provider` block for backward compatibility.
 */
function resolveActiveProvider(config) {
  const active = config.activeProvider;
  if (active && config.providers && config.providers[active]) {
    return deepMerge(config.provider || {}, config.providers[active]);
  }
  return config.provider || {};
}

function loadConfig() {
  const file = resolveConfigFile();
  const configRoot = path.dirname(file);
  const envFile = path.join(configRoot, '.env');

  loadEnvFile(envFile);

  const fileConfig = fs.existsSync(file) ? readJson(file) : {};
  // Migrate the on-disk shape in memory (disk migration handled by CLI/loader).
  const { config: migratedFile } = migrateConfig(fileConfig);
  const config = deepMerge(DEFAULTS, migratedFile);

  config.version = CONFIG_VERSION;
  config.provider = resolveActiveProvider(config);

  config.server.host = process.env.PROMPTRELAY_HOST || config.server.host;
  config.server.port = Number(
    process.env.PORT || process.env.PROMPTRELAY_PORT || config.server.port,
  );

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

  config.prompt.mode = String(
    process.env.PROMPTRELAY_PROMPT_MODE || config.prompt.mode,
  ).toLowerCase();
  config.reasoning.default = process.env.PROMPTRELAY_DEFAULT_REASONING || config.reasoning.default;

  const apiKeyEnv = config.provider.apiKeyEnv || 'PROVIDER_API_KEY';
  config.provider.apiKeyEnv = apiKeyEnv;
  config.provider.apiKey = process.env[apiKeyEnv] || process.env.PROVIDER_API_KEY || '';

  config.paths = {
    root: configRoot,
    packageRoot: PACKAGE_ROOT,
    userRoot: USER_ROOT,
    configFile: file,
    envFile,
    promptFile: path.resolve(configRoot, config.prompt.file || 'system_prompt.txt'),
    cacheFile: path.join(configRoot, 'model-cache.json'),
    healthFile: path.join(configRoot, 'provider-health.json'),
  };

  return config;
}

/**
 * Redacted view for /health and diagnostics — never exposes the API key.
 */
function safeConfig(config) {
  return {
    configVersion: config.version,
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
      apiKeyMasked: config.provider.apiKey ? maskSecret(config.provider.apiKey) : '(not set)',
      authType: config.provider.auth?.type || 'bearer',
    },
    reasoning: config.reasoning,
    fallback: config.fallback,
    retry: config.retry,
    configFile: config.paths.configFile,
    envFile: config.paths.envFile,
  };
}

/** Collect literal secret values from a config for log redaction. */
function collectSecrets(config) {
  const secrets = [];
  if (config?.provider?.apiKey) secrets.push(config.provider.apiKey);
  const headers = config?.provider?.headers || {};
  for (const value of Object.values(headers)) {
    if (typeof value === 'string' && value.length > 8) secrets.push(value);
  }
  return secrets;
}

module.exports = {
  PACKAGE_ROOT,
  USER_ROOT,
  USER_CONFIG_FILE,
  PACKAGE_CONFIG_FILE,
  CONFIG_VERSION,
  DEFAULTS,
  deepMerge,
  loadConfig,
  validateConfig,
  safeConfig,
  loadEnvFile,
  collectSecrets,
  resolveActiveProvider,
};

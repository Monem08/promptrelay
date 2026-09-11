'use strict';

/**
 * Hermes client adapter.
 *
 * Hermes (NousResearch hermes-agent) is OpenAI-compatible and is configured via
 * ~/.hermes/config.yaml with secrets kept in ~/.hermes/.env and referenced as
 * ${VAR}. It therefore points at PromptRelay's OpenAI-compatible `/v1` endpoint.
 *
 *   config.yaml:
 *     model:
 *       provider: custom
 *       base_url: http://127.0.0.1:4141/v1   # must end with /v1, no trailing slash
 *       model: <model id>
 *       api_key: ${PROMPTRELAY_API_KEY}      # reference, not the literal secret
 *
 *   .env:
 *     PROMPTRELAY_API_KEY=promptrelay-local  # LOCAL placeholder, never an upstream key
 *
 * The YAML is parsed and merged non-destructively (unrelated keys preserved),
 * and config.yaml is backed up before every write.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');
const { backupFile, upsertEnvValue, removeEnvValue } = require('./fsutil');
const { updateModelInYaml, removeModelFromYaml } = require('./yaml-edit');

const ID = 'hermes';
const LABEL = 'Hermes';
const PROTOCOL = 'openai'; // consumes /v1/chat/completions

const LOCAL_KEY_VALUE = 'promptrelay-local';
const DEFAULT_KEY_VAR = 'PROMPTRELAY_API_KEY';

function dir() { return path.join(os.homedir(), '.hermes'); }
function configPath() { return path.join(dir(), 'config.yaml'); }
function envPath() { return path.join(dir(), '.env'); }

/** PromptRelay OpenAI-compatible base URL (…/v1, no trailing slash). */
function defaultBaseURL(server) {
  const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host || '127.0.0.1');
  const port = server?.port || 4141;
  return `http://${host}:${port}/v1`;
}

function normalizeBaseURL(url) {
  let u = String(url || '').replace(/\/+$/, '');
  if (!/\/v1$/.test(u)) u = `${u}/v1`;
  return u;
}

function readYaml(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  const doc = yaml.load(raw);
  return doc && typeof doc === 'object' ? doc : {};
}

const { findExecutable, getExecutableVersion } = require('./fsutil');
const { safeWriteSync } = require('../config/safe-write');

function detect() {
  const file = configPath();
  const exe = findExecutable(['hermes', 'hermes-agent']);
  const version = exe ? getExecutableVersion(exe) : null;
  const found = fs.existsSync(file);
  let configured = false;
  if (found) {
    try {
      const cfg = readYaml(file);
      configured = cfg.model?.provider === 'custom' && Boolean(cfg.model?.base_url);
    } catch {}
  }
  return {
    id: ID,
    label: LABEL,
    protocol: PROTOCOL,
    installed: Boolean(found || exe),
    found,
    path: file,
    configPath: file,
    configState: found ? (configured ? 'configured' : 'unconfigured') : 'missing',
    executable: exe || null,
    version: version || null,
  };
}

function status() {
  const file = configPath();
  const found = fs.existsSync(file);
  if (!found) return { id: ID, label: LABEL, protocol: PROTOCOL, found: false, path: file, configured: false };
  try {
    const cfg = readYaml(file);
    const model = cfg.model || {};
    return {
      id: ID,
      label: LABEL,
      protocol: PROTOCOL,
      found: true,
      path: file,
      configured: model.provider === 'custom' && Boolean(model.base_url),
      valid: true,
      details: { provider: model.provider, base_url: model.base_url, model: model.model, api_key: model.api_key },
    };
  } catch (error) {
    return { id: ID, label: LABEL, protocol: PROTOCOL, found: true, path: file, valid: false, error: error.message };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseURL   PromptRelay base URL (…/v1)
 * @param {string} opts.model     model id
 * @param {string} [opts.keyVar]  env var name for the api key reference
 * @param {string} [opts.targetConfig] override config path (testing)
 * @param {string} [opts.targetEnv] override .env path (testing)
 */
function configure(opts = {}) {
  if (!opts.baseURL) throw new Error('hermes.configure requires baseURL');
  if (!opts.model) throw new Error('hermes.configure requires model');

  const file = opts.targetConfig || configPath();
  const env = opts.targetEnv || envPath();
  const keyVar = opts.keyVar || DEFAULT_KEY_VAR;

  const created = !fs.existsSync(file);
  const backupPath = created ? null : backupFile(file);

  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const modelConfig = {
    provider: 'custom',
    base_url: normalizeBaseURL(opts.baseURL),
    model: opts.model,
    api_key: `\${${keyVar}}`,
  };

  const nextYaml = updateModelInYaml(raw, modelConfig);

  const writeResult = safeWriteSync({
    filePath: file,
    content: nextYaml,
    validate: (c) => {
      try {
        yaml.load(c);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
  });
  if (!writeResult.ok) {
    throw new Error(`Failed to write Hermes config: ${writeResult.error}`);
  }

  // Write a LOCAL placeholder secret into .env — never an upstream provider key.
  upsertEnvValue(env, keyVar, LOCAL_KEY_VALUE);

  return { id: ID, path: file, envPath: env, backupPath: writeResult.backupPath || backupPath, created, keyVar };
}

function remove(opts = {}) {
  const file = opts.targetConfig || configPath();
  const env = opts.targetEnv || envPath();
  const keyVar = opts.keyVar || DEFAULT_KEY_VAR;
  if (!fs.existsSync(file)) return { id: ID, path: file, removed: false, note: 'No config.yaml found.' };
  const raw = fs.readFileSync(file, 'utf8');
  const { text: nextYaml, removed } = removeModelFromYaml(raw);
  const writeResult = safeWriteSync({
    filePath: file,
    content: nextYaml,
  });
  removeEnvValue(env, keyVar);
  return { id: ID, path: file, backupPath: writeResult.backupPath, removed: true };
}

module.exports = {
  id: ID,
  label: LABEL,
  protocol: PROTOCOL,
  LOCAL_KEY_VALUE,
  DEFAULT_KEY_VAR,
  configPath,
  envPath,
  defaultBaseURL,
  normalizeBaseURL,
  detect,
  status,
  configure,
  remove,
};

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
const { updateModelInYaml, updateTopLevelBlock, removeModelFromYaml } = require('./yaml-edit');
const { UNKNOWN } = require('../models/schema');

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
 * Verified-only metadata to mirror into Hermes' config.
 *
 * Hermes reads `model.context_length` as a hard pin and otherwise falls back to
 * its own 256K default when a provider publishes no limits. Writing a verified
 * window here is what stops an unknown-context model from silently guessing.
 *
 * Rule, matching src/opencode/index.js: write a key ONLY when the value was
 * actually observed. `'unknown'` is never written — a wrong number is worse
 * than no number, because it disables Hermes' own fallback and mis-sizes its
 * auto-compression. `writeMetadata: false` opts out entirely.
 *
 * @param {object} [modelMeta]      normalized model record from models/discovery
 * @param {string|string[]} [supportedEfforts]
 * @param {boolean} [writeMetadata=true]
 * @returns {{ model: object, agent: object, skipped: string[] }}
 */
function verifiedMetadata(modelMeta, supportedEfforts, writeMetadata = true) {
  const skipped = [];
  const model = {};
  const agent = {};

  if (writeMetadata) {
    const ctx = modelMeta?.contextWindow;
    if (typeof ctx === 'number' && Number.isFinite(ctx) && ctx > 0) {
      model.context_length = ctx;
    } else {
      skipped.push('context_length');
    }

    const out = modelMeta?.maxOutputTokens;
    if (typeof out === 'number' && Number.isFinite(out) && out > 0) {
      model.max_output_tokens = out;
    }

    const efforts = Array.isArray(supportedEfforts) ? supportedEfforts
      : (supportedEfforts === UNKNOWN ? [] : []);
    const levels = efforts.filter((e) => e && e !== UNKNOWN);
    if (levels.length) {
      // Hermes keeps its own high default; only write a list it can act on.
      agent.reasoning_overrides = { [modelMeta?.id || '']: levels[levels.length - 1] };
      if (!agent.reasoning_overrides[modelMeta?.id || '']) delete agent.reasoning_overrides;
    } else {
      skipped.push('reasoning_effort');
    }
  } else {
    skipped.push('metadata(writeMetadata=false)');
  }

  return { model, agent, skipped };
}

/**
 * @param {object} opts
 * @param {string} opts.baseURL   PromptRelay base URL (…/v1)
 * @param {string} opts.model     model id
 * @param {object} [opts.modelMeta]     normalized model metadata (verified values only)
 * @param {string|string[]} [opts.supportedEfforts]
 * @param {boolean} [opts.writeMetadata=true]
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

  const { model: modelMetaBlock, agent: agentBlock, skipped } =
    verifiedMetadata(opts.modelMeta, opts.supportedEfforts, opts.writeMetadata !== false);

  let nextYaml = updateModelInYaml(raw, { ...modelConfig, ...modelMetaBlock });
  if (Object.keys(agentBlock).length) {
    nextYaml = updateTopLevelBlock(nextYaml, 'agent', agentBlock);
  }

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

  return {
    id: ID,
    path: file,
    envPath: env,
    backupPath: writeResult.backupPath || backupPath,
    created,
    keyVar,
    metadata: {
      written: Object.keys(modelMetaBlock),
      skipped,
    },
  };
}

/**
 * Report which model limits are currently pinned in Hermes' config.
 * Read-only: used by `doctor` to tell "set correctly" apart from "unknown".
 * @param {{ targetConfig?: string }} [opts]
 */
function describeMetadata(opts = {}) {
  const file = opts.targetConfig || configPath();
  const out = { contextLength: 'unknown', maxOutputTokens: 'unknown', reasoningEffort: 'unknown', readable: false };
  if (!fs.existsSync(file)) return out;
  try {
    const cfg = readYaml(file);
    const model = cfg.model || {};
    const agent = cfg.agent || {};
    const num = (v) => (typeof v === 'number' ? v : 'unknown');
    out.contextLength = num(model.context_length);
    out.maxOutputTokens = num(model.max_output_tokens);
    const eff = agent.reasoning_effort
      ?? (agent.reasoning_overrides && Object.values(agent.reasoning_overrides)[0]);
    out.reasoningEffort = typeof eff === 'string' && eff ? eff : 'unknown';
    out.readable = true;
  } catch {
    /* unreadable config stays unknown */
  }
  return out;
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
  // Reads model.context_length / max_output_tokens / reasoning limits from its config.
  consumesModelMetadata: true,
  LOCAL_KEY_VALUE,
  DEFAULT_KEY_VAR,
  verifiedMetadata,
  configPath,
  envPath,
  defaultBaseURL,
  normalizeBaseURL,
  detect,
  status,
  describeMetadata,
  configure,
  remove,
};

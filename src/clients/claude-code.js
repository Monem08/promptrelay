'use strict';

/**
 * Claude Code client adapter.
 *
 * Claude Code speaks the Anthropic Messages protocol and is configured through
 * ~/.claude/settings.json, specifically its `env` block:
 *
 *   ANTHROPIC_BASE_URL       -> PromptRelay root (Claude Code appends /v1/messages)
 *   ANTHROPIC_AUTH_TOKEN     -> a LOCAL placeholder token sent as `Authorization:
 *                               Bearer …`. This is NOT an upstream provider key.
 *                               PromptRelay owns provider credentials; the client
 *                               only needs a non-empty local token.
 *   ANTHROPIC_MODEL          -> primary model id
 *   ANTHROPIC_SMALL_FAST_MODEL (optional) -> lightweight model id
 *
 * The adapter backs up settings.json before writing and merges non-destructively:
 * unrelated settings and unrelated env vars are preserved.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { backupFile, readJsonIfExists, writeJson } = require('./fsutil');

const ID = 'claude-code';
const LABEL = 'Claude Code';
const PROTOCOL = 'anthropic'; // consumes /v1/messages

// A local, non-secret placeholder. PromptRelay does not require this to match
// anything; it exists only because Claude Code needs a non-empty auth token.
const LOCAL_TOKEN = 'promptrelay-local';

// The env keys this adapter manages (used for clean removal).
const MANAGED_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'];

function configPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

/** PromptRelay root URL (no /v1 suffix — Claude Code appends /v1/messages). */
function defaultBaseURL(server) {
  const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host || '127.0.0.1');
  const port = server?.port || 4141;
  return `http://${host}:${port}`;
}

const { findExecutable, getExecutableVersion } = require('./fsutil');
const { safeWriteJsonSync } = require('../config/safe-write');

function detect() {
  const file = configPath();
  const exe = findExecutable(['claude', 'claude-code']);
  const version = exe ? getExecutableVersion(exe) : null;
  const found = fs.existsSync(file);
  let configured = false;
  if (found) {
    try {
      const cfg = readJsonIfExists(file, {});
      configured = Boolean(cfg.env?.ANTHROPIC_BASE_URL);
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

function redactToken(v) {
  if (!v) return v;
  return v === LOCAL_TOKEN ? v : '••••••';
}

function status() {
  const file = configPath();
  const found = fs.existsSync(file);
  if (!found) return { id: ID, label: LABEL, protocol: PROTOCOL, found: false, path: file, configured: false };
  try {
    const cfg = readJsonIfExists(file, {});
    const env = cfg.env || {};
    return {
      id: ID,
      label: LABEL,
      protocol: PROTOCOL,
      found: true,
      path: file,
      configured: Boolean(env.ANTHROPIC_BASE_URL),
      valid: true,
      details: {
        ANTHROPIC_BASE_URL: env.ANTHROPIC_BASE_URL,
        ANTHROPIC_MODEL: env.ANTHROPIC_MODEL,
        ANTHROPIC_SMALL_FAST_MODEL: env.ANTHROPIC_SMALL_FAST_MODEL,
        ANTHROPIC_AUTH_TOKEN: redactToken(env.ANTHROPIC_AUTH_TOKEN),
      },
    };
  } catch (error) {
    return { id: ID, label: LABEL, protocol: PROTOCOL, found: true, path: file, valid: false, error: error.message };
  }
}

/**
 * @param {object} opts
 * @param {string} opts.baseURL     PromptRelay root URL (no /v1)
 * @param {string} opts.model       primary model id
 * @param {string} [opts.smallModel] small/fast model id
 * @param {string} [opts.token]     local auth token (defaults to placeholder)
 * @param {string} [opts.targetPath] override config path (testing)
 */
function configure(opts = {}) {
  if (!opts.baseURL) throw new Error('claude-code.configure requires baseURL');
  if (!opts.model) throw new Error('claude-code.configure requires model');

  const file = opts.targetPath || configPath();
  const created = !fs.existsSync(file);
  const backupPath = created ? null : backupFile(file);

  const cfg = readJsonIfExists(file, {});
  const env = { ...(cfg.env || {}) };

  // Guardrail: never persist a real provider key here. If the caller passed one
  // that looks like an upstream secret, refuse rather than leak it.
  const token = opts.token || LOCAL_TOKEN;
  if (/^sk-/.test(token) || /^sk-ant-/.test(token)) {
    throw new Error('Refusing to write an upstream provider key into the client config. Use a local placeholder token; PromptRelay holds the real key.');
  }

  env.ANTHROPIC_BASE_URL = opts.baseURL;
  env.ANTHROPIC_AUTH_TOKEN = token;
  env.ANTHROPIC_MODEL = opts.model;
  if (opts.smallModel) env.ANTHROPIC_SMALL_FAST_MODEL = opts.smallModel;

  const next = { ...cfg, env };
  const res = safeWriteJsonSync(file, next);
  if (!res.ok) {
    throw new Error(`Failed to write Claude Code config: ${res.error}`);
  }

  return { id: ID, path: file, backupPath: res.backupPath || backupPath, created };
}

function remove(opts = {}) {
  const file = opts.targetPath || configPath();
  if (!fs.existsSync(file)) return { id: ID, path: file, removed: false, note: 'No settings.json found.' };
  const cfg = readJsonIfExists(file, {});
  if (cfg.env) {
    for (const key of MANAGED_KEYS) delete cfg.env[key];
    if (Object.keys(cfg.env).length === 0) delete cfg.env;
  }
  const res = safeWriteJsonSync(file, cfg);
  return { id: ID, path: file, backupPath: res.backupPath, removed: true };
}

module.exports = {
  id: ID,
  label: LABEL,
  protocol: PROTOCOL,
  LOCAL_TOKEN,
  MANAGED_KEYS,
  configPath,
  defaultBaseURL,
  detect,
  status,
  configure,
  remove,
};

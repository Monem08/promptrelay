'use strict';

/**
 * OpenCode client adapter.
 *
 * Wraps the existing src/opencode integration behind the common client-adapter
 * interface so OpenCode is managed the same way as every other client. OpenCode
 * speaks the OpenAI-compatible protocol, so it points at PromptRelay's `/v1`.
 */

const { locateConfig, setupOpenCode, statusOpenCode, PROVIDER_ID } = require('../opencode');

const ID = 'opencode';
const LABEL = 'OpenCode';
const PROTOCOL = 'openai'; // consumes /v1/chat/completions

/** Default PromptRelay URL OpenCode should target (OpenAI-compatible, /v1). */
function defaultBaseURL(server) {
  const host = server?.host === '0.0.0.0' ? '127.0.0.1' : (server?.host || '127.0.0.1');
  const port = server?.port || 4141;
  return `http://${host}:${port}/v1`;
}

const { findExecutable, getExecutableVersion } = require('./fsutil');

function detect() {
  const located = locateConfig();
  const exe = findExecutable(['opencode', 'opencode-cli']);
  const version = exe ? getExecutableVersion(exe) : null;
  const s = statusOpenCode();
  const configState = located.found ? (s.hasPromptRelay ? 'configured' : 'unconfigured') : 'missing';
  return {
    id: ID,
    label: LABEL,
    protocol: PROTOCOL,
    installed: Boolean(located.found || exe),
    found: located.found,
    path: located.path,
    configPath: located.path,
    configState,
    executable: exe || null,
    version: version || null,
  };
}

function status() {
  const s = statusOpenCode();
  return {
    id: ID,
    label: LABEL,
    protocol: PROTOCOL,
    found: s.found,
    path: s.path,
    configured: Boolean(s.hasPromptRelay),
    valid: s.valid !== false,
    models: s.models || [],
    error: s.error,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.baseURL  PromptRelay base URL (…/v1)
 * @param {string} opts.model    model id to expose
 * @param {object} [opts.modelMeta]
 * @param {string} [opts.targetPath]
 */
function configure(opts = {}) {
  const result = setupOpenCode({
    baseURL: opts.baseURL,
    model: opts.model,
    modelMeta: opts.modelMeta,
    name: 'PromptRelay',
    targetPath: opts.targetPath,
  });
  return { id: ID, ...result };
}

function remove() {
  // OpenCode config is user-owned JSONC; we do not auto-delete. Report guidance.
  const located = locateConfig();
  return {
    id: ID,
    path: located.path,
    removed: false,
    note: located.found
      ? `Open ${located.path} and delete the "${PROVIDER_ID}" entry under "provider" to remove PromptRelay.`
      : 'No OpenCode config found; nothing to remove.',
  };
}

module.exports = { id: ID, label: LABEL, protocol: PROTOCOL, defaultBaseURL, detect, status, configure, remove };

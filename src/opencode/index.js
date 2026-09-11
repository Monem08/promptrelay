'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseJSONC } = require('./jsonc');
const { updateProviderInJSONC, removeProviderFromJSONC } = require('./jsonc-edit');
const { UNKNOWN } = require('../models/schema');

/**
 * OpenCode zero-config integration.
 *
 * - Locates an existing OpenCode config (JSON or JSONC) across common paths.
 * - Backs it up before modifying.
 * - Parses JSONC safely and merges a PromptRelay provider WITHOUT destroying
 *   the user's existing configuration.
 * - Generates model entries using verified context/output limits only.
 */

const PROVIDER_ID = 'promptrelay';

function candidatePaths() {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  return [
    path.join(process.cwd(), 'opencode.jsonc'),
    path.join(process.cwd(), 'opencode.json'),
    path.join(xdg, 'opencode', 'opencode.jsonc'),
    path.join(xdg, 'opencode', 'opencode.json'),
    path.join(home, '.config', 'opencode', 'opencode.jsonc'),
    path.join(home, '.config', 'opencode', 'opencode.json'),
  ];
}

/**
 * Locate an existing OpenCode config file, or return the default target path.
 * @returns {{ found: boolean, path: string, defaultPath: string }}
 */
function locateConfig() {
  const home = os.homedir();
  const xdg = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
  const defaultPath = path.join(xdg, 'opencode', 'opencode.jsonc');

  for (const candidate of candidatePaths()) {
    if (fs.existsSync(candidate)) {
      return { found: true, path: candidate, defaultPath };
    }
  }
  return { found: false, path: defaultPath, defaultPath };
}

function backupFile(file) {
  if (!file || !fs.existsSync(file)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${file}.${stamp}.bak`;
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

/**
 * Build the PromptRelay provider block for OpenCode.
 *
 * @param {object} params
 * @param {string} params.baseURL - PromptRelay local URL, e.g. http://127.0.0.1:4141/v1
 * @param {string} params.model - model id to expose
 * @param {object} [params.modelMeta] - normalized model metadata for verified limits
 * @param {string} [params.name]
 */
function buildProviderBlock({ baseURL, model, modelMeta, name = 'PromptRelay' }) {
  const modelEntry = {};
  const limit = {};
  if (modelMeta) {
    if (typeof modelMeta.contextWindow === 'number') limit.context = modelMeta.contextWindow;
    if (typeof modelMeta.maxOutputTokens === 'number') limit.output = modelMeta.maxOutputTokens;
  }
  const entry = {};
  if (Object.keys(limit).length) entry.limit = limit;
  // Only include a name; never fabricate limits when unknown.
  entry.name = modelMeta && modelMeta.name && modelMeta.name !== UNKNOWN ? modelMeta.name : model;

  modelEntry[model] = entry;

  return {
    [PROVIDER_ID]: {
      npm: '@ai-sdk/openai-compatible',
      name,
      options: {
        baseURL,
      },
      models: modelEntry,
    },
  };
}

/**
 * Merge a PromptRelay provider into an existing OpenCode config object without
 * clobbering unrelated keys. Returns a new object.
 */
function mergeProvider(existing, providerBlock) {
  const config = existing && typeof existing === 'object' ? { ...existing } : {};
  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json';
  config.provider = { ...(config.provider || {}) };

  for (const [id, block] of Object.entries(providerBlock)) {
    const prev = config.provider[id] || {};
    config.provider[id] = {
      ...prev,
      ...block,
      options: { ...(prev.options || {}), ...(block.options || {}) },
      models: { ...(prev.models || {}), ...(block.models || {}) },
    };
  }
  return config;
}

/**
 * Install/repair the PromptRelay provider in OpenCode's config.
 *
 * @param {object} params
 * @param {string} params.baseURL
 * @param {string} params.model
 * @param {object} [params.modelMeta]
 * @param {string} [params.targetPath] - override location
 * @returns {{ path: string, backupPath: string|null, created: boolean, merged: boolean }}
 */
function setupOpenCode(params) {
  const located = params.targetPath
    ? { found: fs.existsSync(params.targetPath), path: params.targetPath, defaultPath: params.targetPath }
    : locateConfig();

  const providerBlock = buildProviderBlock(params);

  let existing = {};
  let created = false;
  let backupPath = null;

  if (located.found) {
    const raw = fs.readFileSync(located.path, 'utf8');
    existing = parseJSONC(raw); // throws on invalid JSONC
    backupPath = backupFile(located.path);
    const merged = mergeProvider(existing, providerBlock);

    const { safeWriteSync } = require('../config/safe-write');
    try {
      const updated = updateProviderInJSONC(raw, PROVIDER_ID, merged.provider[PROVIDER_ID]);
      parseJSONC(updated);
      const res = safeWriteSync({ filePath: located.path, content: updated });
      if (res.backupPath) backupPath = res.backupPath;
    } catch {
      // Safe fallback: standard formatted JSON
      const res = safeWriteSync({ filePath: located.path, content: `${JSON.stringify(merged, null, 2)}\n` });
      if (res.backupPath) backupPath = res.backupPath;
    }
  } else {
    created = true;
    const { safeWriteSync } = require('../config/safe-write');
    const merged = mergeProvider({}, providerBlock);
    safeWriteSync({ filePath: located.path, content: `${JSON.stringify(merged, null, 2)}\n` });
  }

  return {
    path: located.path,
    backupPath,
    created,
    merged: !created,
  };
}

/**
 * Remove PromptRelay from OpenCode config, preserving comments and formatting.
 * @param {string} [targetPath]
 * @returns {{ removed: boolean, path: string|null, backupPath: string|null }}
 */
function removeOpenCode(targetPath) {
  const located = targetPath
    ? { found: fs.existsSync(targetPath), path: targetPath }
    : locateConfig();
  if (!located.found) {
    return { removed: false, path: located.path || null, backupPath: null, note: 'No OpenCode config found.' };
  }

  const raw = fs.readFileSync(located.path, 'utf8');
  const backupPath = backupFile(located.path);
  const { text: updated, removed } = removeProviderFromJSONC(raw, PROVIDER_ID);
  if (removed) {
    fs.writeFileSync(located.path, updated, 'utf8');
  }
  return { removed, path: located.path, backupPath };
}

/**
 * Report the current OpenCode integration status.
 */
function statusOpenCode() {
  const located = locateConfig();
  if (!located.found) {
    return { found: false, path: located.defaultPath, hasPromptRelay: false };
  }
  try {
    const config = parseJSONC(fs.readFileSync(located.path, 'utf8'));
    const hasPromptRelay = Boolean(config?.provider?.[PROVIDER_ID]);
    const models = hasPromptRelay ? Object.keys(config.provider[PROVIDER_ID].models || {}) : [];
    return { found: true, path: located.path, hasPromptRelay, models, valid: true };
  } catch (error) {
    return { found: true, path: located.path, valid: false, error: error.message };
  }
}

module.exports = {
  PROVIDER_ID,
  candidatePaths,
  locateConfig,
  backupFile,
  buildProviderBlock,
  mergeProvider,
  setupOpenCode,
  removeOpenCode,
  statusOpenCode,
};


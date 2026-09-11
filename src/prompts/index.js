'use strict';

const fs = require('fs');

const DEFAULT_PLACEHOLDER = '{Paste your instructions here}';

const scopes = require('./scopes');

function ensurePromptFile(config) {
  const file = config?.paths?.promptFile;
  if (!file) return;
  if (!fs.existsSync(file)) {
    const path = require('path');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, config.prompt?.placeholder || DEFAULT_PLACEHOLDER, 'utf8');
  }
}

function loadPrompt(config) {
  ensurePromptFile(config);
  return fs.readFileSync(config.paths.promptFile, 'utf8').replace(/^\uFEFF/, '').trim();
}

function promptConfigured(config, clientId) {
  if (clientId && clientId !== 'unknown') {
    if (scopes.scopeConfigured(clientId, config)) return true;
  }
  const prompt = loadPrompt(config);
  const placeholder = config.prompt.placeholder || DEFAULT_PLACEHOLDER;
  return Boolean(prompt && prompt !== placeholder);
}

function isPrivileged(message) {
  const role = String(message?.role || '').toLowerCase();
  return role === 'system' || role === 'developer';
}

/**
 * Apply the configured prompt policy to a message array.
 * Supports per-client prompt scopes when clientId is provided.
 * Modes: passthrough | replace | prepend | append (fallback: replace).
 */
function applyPromptPolicy(messages, config, clientId) {
  const original = Array.isArray(messages) ? messages : [];
  const resolved = scopes.resolvePrompt(clientId, config);
  const mode = resolved.mode;

  if (mode === 'passthrough') return [...original];

  const custom = {
    role: 'system',
    content: resolved.text,
  };

  if (mode === 'replace') {
    return [custom, ...original.filter((message) => !isPrivileged(message))];
  }

  if (mode === 'prepend') {
    return [custom, ...original];
  }

  if (mode === 'append') {
    const privileged = original.filter(isPrivileged);
    const rest = original.filter((message) => !isPrivileged(message));
    return [...privileged, custom, ...rest];
  }

  return [custom, ...original.filter((message) => !isPrivileged(message))];
}

module.exports = {
  DEFAULT_PLACEHOLDER,
  ensurePromptFile,
  loadPrompt,
  promptConfigured,
  applyPromptPolicy,
  isPrivileged,
  scopes,
  resolvePrompt: scopes.resolvePrompt,
  listScopes: scopes.listScopes,
  savePrompt: scopes.savePrompt,
  promptFileForScope: scopes.promptFileForScope,
  loadScopedPrompt: scopes.loadScopedPrompt,
  scopeConfigured: scopes.scopeConfigured,
};

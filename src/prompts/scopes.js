'use strict';

/**
 * Prompt scopes: per-client custom prompts.
 *
 * Supports:
 *  - Global prompt (applies to all clients by default)
 *  - Per-client prompts (override global for a specific client)
 *  - Mode per scope (replace, prepend, append, passthrough)
 *  - Hot-reload (reads from disk on every request, no restart needed)
 *  - Version history through safe-write backups
 *
 * Prompt resolution order:
 *  1. Per-client scope (if client has a specific prompt scope)
 *  2. Global scope (default)
 *  3. Incoming messages (if mode is passthrough)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_PLACEHOLDER = '{Paste your instructions here}';

/**
 * Resolve the prompt file path for a scope.
 * @param {string} scope - 'global' or client id
 * @param {object} config
 * @returns {string}
 */
function promptFileForScope(scope, config) {
  const root = config?.paths?.root || (config?.paths?.configFile ? path.dirname(config.paths.configFile) : process.cwd());
  if (scope === 'global' || !scope) {
    return config?.paths?.promptFile || path.resolve(root, 'system_prompt.txt');
  }
  const scopeConfig = (config?.promptScopes || {})[scope];
  if (scopeConfig && scopeConfig.file) {
    return path.resolve(root, scopeConfig.file);
  }
  // Default: per-client file in the config root
  return path.resolve(root, `system_prompt_${scope}.txt`);
}

/**
 * Load the prompt text for a scope.
 * @param {string} scope
 * @param {object} config
 * @returns {string}
 */
function loadScopedPrompt(scope, config) {
  const file = promptFileForScope(scope, config);
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').trim();
}

/**
 * Check if a scope has a configured (non-placeholder) prompt.
 * @param {string} scope
 * @param {object} config
 * @returns {boolean}
 */
function scopeConfigured(scope, config) {
  const text = loadScopedPrompt(scope, config);
  const placeholder = config.prompt?.placeholder || DEFAULT_PLACEHOLDER;
  return Boolean(text && text !== placeholder);
}

/**
 * Get the prompt mode for a scope.
 * @param {string} scope
 * @param {object} config
 * @returns {string}
 */
function modeForScope(scope, config) {
  if (scope === 'global' || !scope) {
    return config.prompt?.mode || 'replace';
  }
  const scopeConfig = (config.promptScopes || {})[scope];
  return scopeConfig?.mode || config.prompt?.mode || 'replace';
}

/**
 * List all configured prompt scopes.
 * @param {object} config
 * @returns {Array<{ scope: string, file: string, mode: string, configured: boolean }>}
 */
function listScopes(config) {
  const scopes = [
    {
      scope: 'global',
      file: config.paths.promptFile,
      mode: config.prompt?.mode || 'replace',
      configured: scopeConfigured('global', config),
    },
  ];

  const scopeConfigs = config.promptScopes || {};
  for (const [clientId, scopeConfig] of Object.entries(scopeConfigs)) {
    scopes.push({
      scope: clientId,
      file: promptFileForScope(clientId, config),
      mode: scopeConfig?.mode || config.prompt?.mode || 'replace',
      configured: scopeConfigured(clientId, config),
    });
  }

  return scopes;
}

/**
 * Resolve the effective prompt for a client, considering scopes.
 *
 * @param {string} clientId - Client identifier (or 'unknown')
 * @param {object} config
 * @returns {{ text: string, mode: string, scope: string, source: string }}
 */
function resolvePrompt(clientId, config) {
  // Check for per-client scope
  if (clientId && clientId !== 'unknown') {
    const scopeText = loadScopedPrompt(clientId, config);
    const placeholder = config.prompt?.placeholder || DEFAULT_PLACEHOLDER;
    if (scopeText && scopeText !== placeholder) {
      return {
        text: scopeText,
        mode: modeForScope(clientId, config),
        scope: clientId,
        source: `client:${clientId}`,
      };
    }
  }

  // Fall back to global prompt
  const globalText = loadScopedPrompt('global', config);
  return {
    text: globalText,
    mode: modeForScope('global', config),
    scope: 'global',
    source: 'global',
  };
}

/**
 * Save a prompt for a scope using safe write.
 */
async function savePrompt(scope, text, config) {
  const { safeWrite } = require('../config/safe-write');
  const file = promptFileForScope(scope, config);
  return safeWrite({ filePath: file, content: `${text}\n` });
}

module.exports = {
  DEFAULT_PLACEHOLDER,
  promptFileForScope,
  loadScopedPrompt,
  scopeConfigured,
  modeForScope,
  listScopes,
  resolvePrompt,
  savePrompt,
};

const fs = require('fs');

const DEFAULT_PLACEHOLDER = '{Paste your instructions here}';

function ensurePromptFile(config) {
  const file = config.paths.promptFile;
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, config.prompt.placeholder || DEFAULT_PLACEHOLDER, 'utf8');
  }
}

function loadPrompt(config) {
  ensurePromptFile(config);
  return fs.readFileSync(config.paths.promptFile, 'utf8').replace(/^\uFEFF/, '').trim();
}

function promptConfigured(config) {
  const prompt = loadPrompt(config);
  const placeholder = config.prompt.placeholder || DEFAULT_PLACEHOLDER;
  return Boolean(prompt && prompt !== placeholder);
}

function isPrivileged(message) {
  const role = String(message?.role || '').toLowerCase();
  return role === 'system' || role === 'developer';
}

function applyPromptPolicy(messages, config) {
  const original = Array.isArray(messages) ? messages : [];
  const mode = config.prompt.mode;

  if (mode === 'passthrough') return [...original];

  const custom = {
    role: 'system',
    content: loadPrompt(config),
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
};

'use strict';

const urls = require('./urls');
const http = require('./http');
const presets = require('./presets');
const detect = require('./detect');
const health = require('./health');

/**
 * Provider registry helpers. Named provider profiles live in config.providers.
 */

function listProviders(config) {
  const registry = config?.providers || {};
  const names = Object.keys(registry);
  return names.map((name) => ({
    name,
    active: config.activeProvider === name,
    transport: registry[name]?.transport || 'unknown',
    baseURL: registry[name]?.baseURL || 'unknown',
    model: registry[name]?.model || 'unknown',
  }));
}

function getProvider(config, name) {
  return config?.providers?.[name] || null;
}

/**
 * Add or update a named provider profile in a config object (returns new config).
 */
function upsertProvider(config, name, providerConfig) {
  const next = { ...config, providers: { ...(config.providers || {}) } };
  next.providers[name] = providerConfig;
  return next;
}

function removeProvider(config, name) {
  const next = { ...config, providers: { ...(config.providers || {}) } };
  delete next.providers[name];
  if (next.activeProvider === name) delete next.activeProvider;
  return next;
}

function setActiveProvider(config, name) {
  const next = { ...config };
  if (name && config.providers && config.providers[name]) {
    next.activeProvider = name;
    next.provider = { ...(config.provider || {}), ...config.providers[name] };
  }
  return next;
}

module.exports = {
  ...urls,
  ...http,
  presets,
  listPresets: presets.listPresets,
  getPreset: presets.getPreset,
  detectProvider: detect.detectProvider,
  detect,
  health,
  listProviders,
  getProvider,
  upsertProvider,
  removeProvider,
  setActiveProvider,
};

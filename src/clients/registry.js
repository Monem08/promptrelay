'use strict';

/**
 * Client registry — the single place that knows about every supported coding
 * client. Each adapter implements the common interface:
 *
 *   { id, label, protocol, defaultBaseURL(server), detect(), status(),
 *     configure(opts), remove(opts) }
 *
 * `protocol` tells PromptRelay which ingress the client speaks:
 *   'openai'    -> POST /v1/chat/completions
 *   'anthropic' -> POST /v1/messages
 */

const opencode = require('./opencode');
const claudeCode = require('./claude-code');
const hermes = require('./hermes');

const CLIENTS = {
  [opencode.id]: opencode,
  [claudeCode.id]: claudeCode,
  [hermes.id]: hermes,
};

// Friendly aliases for the CLI.
const ALIASES = {
  claude: 'claude-code',
  'claude_code': 'claude-code',
  claudecode: 'claude-code',
  oc: 'opencode',
};

function resolveId(id) {
  const key = String(id || '').toLowerCase();
  return ALIASES[key] || key;
}

function getClient(id) {
  return CLIENTS[resolveId(id)] || null;
}

function listClients() {
  return Object.values(CLIENTS).map((c) => ({ id: c.id, label: c.label, protocol: c.protocol }));
}

/** Detect which clients appear to be present on this machine (by config). */
function detectAll() {
  return Object.values(CLIENTS).map((c) => ({ ...c.detect(), label: c.label, protocol: c.protocol }));
}

function statusAll() {
  return Object.values(CLIENTS).map((c) => c.status());
}

module.exports = { CLIENTS, ALIASES, resolveId, getClient, listClients, detectAll, statusAll };

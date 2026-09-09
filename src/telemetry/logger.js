'use strict';

const { redact, redactString } = require('./secrets');

/**
 * A tiny logger that redacts secrets before writing. Keeps PromptRelay's
 * dependency-free ethos while ensuring keys never leak into stdout/stderr.
 */

let currentSecrets = [];

/**
 * Register literal secret values that must be scrubbed from all string logs.
 * @param {string[]} secrets
 */
function setSecrets(secrets) {
  currentSecrets = Array.from(new Set((secrets || []).filter(Boolean).map(String)));
}

function scrub(arg) {
  if (typeof arg === 'string') return redactString(arg, currentSecrets);
  if (arg && typeof arg === 'object') return redact(arg);
  return arg;
}

function log(...args) {
  console.log(...args.map(scrub));
}

function info(...args) {
  console.log(...args.map(scrub));
}

function warn(...args) {
  console.warn(...args.map(scrub));
}

function error(...args) {
  console.error(...args.map(scrub));
}

module.exports = {
  setSecrets,
  log,
  info,
  warn,
  error,
  scrub,
};

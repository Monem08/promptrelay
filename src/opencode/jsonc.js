'use strict';

/**
 * Minimal, dependency-free JSONC parser.
 *
 * Strips // line comments, block comments, and trailing commas while being
 * careful not to touch those sequences inside string literals. Returns the
 * parsed value via JSON.parse.
 */
function stripJSONC(text) {
  const src = String(text || '');
  let out = '';
  let inString = false;
  let quote = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      out += ch;
      if (ch === '\\') {
        // Preserve escaped character verbatim.
        out += src[i + 1] || '';
        i += 1;
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = '';
      }
      continue;
    }

    // Not in a string or comment.
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    out += ch;
  }

  // Remove trailing commas: ,} or ,]  (also with whitespace/newlines between).
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

/**
 * Parse JSONC text into an object. Throws on invalid JSON with a helpful message.
 */
function parseJSONC(text) {
  const stripped = stripJSONC(text);
  try {
    return JSON.parse(stripped);
  } catch (error) {
    throw new Error(`Invalid JSON/JSONC: ${error.message}`);
  }
}

module.exports = { stripJSONC, parseJSONC };

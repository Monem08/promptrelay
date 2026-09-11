'use strict';

/**
 * Comment-preserving JSONC editor for OpenCode configuration.
 *
 * Preserves existing comments, whitespace, and formatting when inserting,
 * updating, or removing PromptRelay provider configurations.
 */

const { parseJSONC } = require('./jsonc');

/**
 * Format a JavaScript object as indented JSON lines (e.g. 4 spaces for provider entries).
 * @param {object} obj
 * @param {number} indentSpaces
 * @returns {string}
 */
function formatIndented(obj, indentSpaces = 4) {
  const indent = ' '.repeat(indentSpaces);
  const jsonStr = JSON.stringify(obj, null, 2);
  const lines = jsonStr.split('\n');
  return lines.map((line, i) => {
    if (i === 0) return line;
    return `${indent}${line}`;
  }).join('\n');
}

/**
 * Finds matching closing brace for an opening brace at startIndex.
 * Respects quotes and comments.
 * @param {string} text
 * @param {number} startIndex - index of '{'
 * @returns {number} index of matching '}', or -1
 */
function findMatchingBrace(text, startIndex) {
  let depth = 0;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let stringChar = '';

  for (let i = startIndex; i < text.length; i++) {
    const char = text[i];
    const prev = i > 0 ? text[i - 1] : '';
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (char === stringChar && prev !== '\\') {
        inString = false;
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Locate the provider key position in a JSONC string.
 * @param {string} text
 * @returns {{ keyStart: number, objStart: number, objEnd: number } | null}
 */
function findProviderObject(text) {
  const providerRegex = /"provider"\s*:\s*\{/;
  const match = providerRegex.exec(text);
  if (!match) return null;

  const keyStart = match.index;
  const objStart = keyStart + match[0].lastIndexOf('{');
  const objEnd = findMatchingBrace(text, objStart);
  if (objEnd === -1) return null;

  return { keyStart, objStart, objEnd };
}

/**
 * Locate a specific provider block (e.g. "promptrelay") within a provider object.
 * @param {string} text
 * @param {number} providerObjStart
 * @param {number} providerObjEnd
 * @param {string} providerId
 * @returns {{ keyStart: number, blockStart: number, blockEnd: number } | null}
 */
function findProviderEntry(text, providerObjStart, providerObjEnd, providerId) {
  const providerContent = text.slice(providerObjStart, providerObjEnd + 1);
  const entryRegex = new RegExp(`("${providerId}"|'${providerId}')\\s*:\\s*\\{`);
  const match = entryRegex.exec(providerContent);
  if (!match) return null;

  const keyStart = providerObjStart + match.index;
  const blockStart = keyStart + match[0].lastIndexOf('{');
  const blockEnd = findMatchingBrace(text, blockStart);
  if (blockEnd === -1) return null;

  return { keyStart, blockStart, blockEnd };
}

/**
 * Update or insert a provider block into JSONC text while preserving comments.
 *
 * @param {string} rawJsonc
 * @param {string} providerId
 * @param {object} providerBlock
 * @returns {string} Updated JSONC text
 */
function updateProviderInJSONC(rawJsonc, providerId, providerBlock) {
  const text = rawJsonc.replace(/^\uFEFF/, '');
  const formattedBlock = formatIndented(providerBlock, 4);

  const providerObj = findProviderObject(text);
  if (!providerObj) {
    // No "provider" key found. Insert "provider" object before the last closing '}'
    const lastBrace = text.lastIndexOf('}');
    if (lastBrace === -1) {
      // Fallback: full document creation
      return JSON.stringify({
        $schema: 'https://opencode.ai/config.json',
        provider: { [providerId]: providerBlock },
      }, null, 2) + '\n';
    }

    const before = text.slice(0, lastBrace).trimEnd();
    const needsComma = before.length > 0 && !before.endsWith('{') && !before.endsWith(',');
    const comma = needsComma ? ',' : '';
    const insertion = `${comma}\n  "provider": {\n    "${providerId}": ${formattedBlock}\n  }\n`;
    return `${before}${insertion}${text.slice(lastBrace)}`;
  }

  // "provider" object exists. Check if providerId exists inside it.
  const existingEntry = findProviderEntry(text, providerObj.objStart, providerObj.objEnd, providerId);
  if (existingEntry) {
    // Replace existing provider block
    const before = text.slice(0, existingEntry.keyStart);
    const after = text.slice(existingEntry.blockEnd + 1);
    return `${before}"${providerId}": ${formattedBlock}${after}`;
  }

  // Insert into existing provider object
  const insideStart = providerObj.objStart + 1;
  const insideContent = text.slice(insideStart, providerObj.objEnd).trim();
  const hasExistingEntries = insideContent.length > 0;

  if (!hasExistingEntries) {
    // Empty provider object: { }
    const before = text.slice(0, insideStart);
    const after = text.slice(providerObj.objEnd);
    return `${before}\n    "${providerId}": ${formattedBlock}\n  ${after}`;
  }

  // Insert at the beginning of the provider object
  const before = text.slice(0, insideStart);
  const after = text.slice(insideStart);
  return `${before}\n    "${providerId}": ${formattedBlock},${after}`;
}

/**
 * Remove a provider block from JSONC text while preserving comments.
 *
 * @param {string} rawJsonc
 * @param {string} providerId
 * @returns {{ text: string, removed: boolean }}
 */
function removeProviderFromJSONC(rawJsonc, providerId) {
  const text = rawJsonc.replace(/^\uFEFF/, '');
  const providerObj = findProviderObject(text);
  if (!providerObj) return { text, removed: false };

  const entry = findProviderEntry(text, providerObj.objStart, providerObj.objEnd, providerId);
  if (!entry) return { text, removed: false };

  // Remove the entry, including any preceding whitespace and optional trailing comma
  let start = entry.keyStart;
  let end = entry.blockEnd + 1;

  // Include leading indentation/whitespace
  while (start > providerObj.objStart + 1 && (text[start - 1] === ' ' || text[start - 1] === '\t')) {
    start--;
  }

  // Check for trailing comma
  let afterEnd = end;
  while (afterEnd < providerObj.objEnd && (text[afterEnd] === ' ' || text[afterEnd] === '\t')) {
    afterEnd++;
  }
  if (text[afterEnd] === ',') {
    end = afterEnd + 1;
  } else {
    // If no trailing comma, look for leading comma
    let beforeStart = start;
    while (beforeStart > providerObj.objStart + 1 && (text[beforeStart - 1] === ' ' || text[beforeStart - 1] === '\t' || text[beforeStart - 1] === '\n' || text[beforeStart - 1] === '\r')) {
      beforeStart--;
    }
    if (text[beforeStart - 1] === ',') {
      start = beforeStart - 1;
    }
  }

  // Also absorb newline if followed by one
  if (text[end] === '\r') end++;
  if (text[end] === '\n') end++;

  const nextText = text.slice(0, start) + text.slice(end);
  return { text: nextText, removed: true };
}

module.exports = {
  updateProviderInJSONC,
  removeProviderFromJSONC,
  findProviderObject,
  findMatchingBrace,
};

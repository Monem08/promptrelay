'use strict';

/**
 * Comment-preserving YAML editor for Hermes configuration (~/.hermes/config.yaml).
 *
 * Updates or removes the `model:` block while keeping all other lines, comments,
 * and structure completely intact.
 */

const yaml = require('js-yaml');

/**
 * Formats a model configuration object as a YAML block with indentation.
 * @param {object} modelConfig
 * @returns {string}
 */
function formatModelBlock(modelConfig) {
  const modelYaml = yaml.dump({ model: modelConfig }, { lineWidth: 120, noRefs: true });
  return modelYaml.trim();
}

/**
 * Locate the line range [start, end] of a top-level key in a YAML file.
 * Line indices are 0-based.
 * @param {string[]} lines
 * @param {string} key
 * @returns {{ start: number, end: number } | null}
 */
function findTopLevelKeyRange(lines, key) {
  const keyRegex = new RegExp(`^${key}:\\s*(.*)$`);
  let startIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Check for top-level key (no leading whitespace, not a comment)
    if (keyRegex.test(line)) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === -1) return null;

  let endIndex = startIndex;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Indented content belongs to this block
    if (/^[ \t]+/.test(line)) {
      endIndex = i;
    } else if (line.trim() === '') {
      // Empty line could be inside the block, but only if subsequent lines are indented
      let hasMoreIndented = false;
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[ \t]+[^\s]/.test(lines[j])) {
          hasMoreIndented = true;
          break;
        }
        if (/^[^ \t\s]/.test(lines[j])) {
          // Reached an unindented comment or next key
          break;
        }
      }
      if (hasMoreIndented) {
        endIndex = i;
      } else {
        break;
      }
    } else {
      // Reached next top-level key or unindented comment
      break;
    }
  }

  return { start: startIndex, end: endIndex };
}

/**
 * Update or insert the model: block in YAML content while preserving comments.
 *
 * @param {string} rawYaml
 * @param {object} modelConfig
 * @returns {string} Updated YAML
 */
function updateModelInYaml(rawYaml, modelConfig) {
  const formattedModel = formatModelBlock(modelConfig);
  if (!rawYaml || !rawYaml.trim()) {
    return `${formattedModel}\n`;
  }

  const lines = rawYaml.split(/\r?\n/);
  const range = findTopLevelKeyRange(lines, 'model');

  if (range) {
    // Replace existing model block lines with the new formatted model block
    const before = lines.slice(0, range.start);
    const after = lines.slice(range.end + 1);
    const result = [...before, formattedModel, ...after].join('\n');
    return result.endsWith('\n') ? result : `${result}\n`;
  }

  // Model key doesn't exist; append at the end
  const trimmed = rawYaml.trimEnd();
  return `${trimmed}\n\n${formattedModel}\n`;
}

/**
 * Remove the model: block from YAML content while preserving comments.
 *
 * @param {string} rawYaml
 * @returns {{ text: string, removed: boolean }}
 */
function removeModelFromYaml(rawYaml) {
  if (!rawYaml || !rawYaml.trim()) return { text: rawYaml, removed: false };

  const lines = rawYaml.split(/\r?\n/);
  const range = findTopLevelKeyRange(lines, 'model');
  if (!range) return { text: rawYaml, removed: false };

  const before = lines.slice(0, range.start);
  const after = lines.slice(range.end + 1);
  const result = [...before, ...after].join('\n');
  return { text: result.endsWith('\n') ? result : `${result}\n`, removed: true };
}

module.exports = {
  updateModelInYaml,
  removeModelFromYaml,
  findTopLevelKeyRange,
};

'use strict';

/**
 * IR-level prompt policy — the protocol-neutral equivalent of
 * src/prompts/applyPromptPolicy. Because the IR normalizes every client's system
 * instruction into `ir.system`, the four modes reduce to string composition:
 *
 *   passthrough : leave ir.system untouched
 *   replace     : ir.system = custom          (client system dropped)
 *   prepend     : custom, then client system
 *   append      : client system, then custom
 *
 * Mutates and returns the same IR object.
 */

const { loadPrompt } = require('../prompts');

function applyPromptPolicyIR(ir, config) {
  const mode = config?.prompt?.mode || 'replace';
  if (mode === 'passthrough') return ir;

  const custom = loadPrompt(config);
  const existing = ir.system ? String(ir.system) : '';

  if (mode === 'prepend') {
    ir.system = existing ? `${custom}\n\n${existing}` : custom;
  } else if (mode === 'append') {
    ir.system = existing ? `${existing}\n\n${custom}` : custom;
  } else {
    // replace (default)
    ir.system = custom;
  }
  return ir;
}

module.exports = { applyPromptPolicyIR };

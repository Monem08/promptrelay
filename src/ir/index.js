'use strict';

/**
 * PromptRelay Internal Representation (IR) — public surface.
 *
 * The IR is a protocol-neutral request/response/stream model. Client ingress
 * translates INTO it; provider egress translates FROM it. This keeps each wire
 * format's quirks isolated at the edges instead of leaking across protocols.
 */

const schema = require('./schema');
const openai = require('./openai');
const anthropic = require('./anthropic');
const policy = require('./policy');
const upstream = require('./upstream');
const sse = require('./sse');

module.exports = {
  ...schema,
  ...openai,
  ...anthropic,
  ...policy,
  ...upstream,
  iterSSE: sse.iterSSE,
  formatSSE: sse.formatSSE,
  parseSSEBlock: sse.parseSSEBlock,
};

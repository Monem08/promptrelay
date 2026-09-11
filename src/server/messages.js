'use strict';

/**
 * Anthropic Messages ingress: POST /v1/messages.
 *
 * This lets clients that speak the Anthropic Messages protocol (e.g. Claude
 * Code) point at PromptRelay. The request is normalized to IR, the configured
 * prompt policy is applied, and the request is dispatched to whichever provider
 * PromptRelay is configured for — OpenAI-compatible or Anthropic native — then
 * translated back into Anthropic response/stream shape.
 *
 * When the active provider cannot faithfully serve the request, a clear
 * compatibility error is returned instead of a silent mistranslation.
 */

const {
  anthropicRequestToIR,
  irToAnthropicResponse,
  writeAnthropicStream,
  applyPromptPolicyIR,
  callProviderNonStream,
  callProviderStream,
  CompatibilityError,
  formatSSE,
} = require('../ir');
const { createAbortController } = require('../providers/http');
const { promptConfigured } = require('../prompts');
const logger = require('../telemetry/logger');
const routing = require('../routing/engine');

function anthropicError(res, status, message, type = 'invalid_request_error') {
  return res.status(status).json({ type: 'error', error: { type, message } });
}

async function handleMessages(req, res, config, externalState = null) {
  const body = req.body || {};

  if (!Array.isArray(body.messages)) {
    return anthropicError(res, 400, 'messages must be an array');
  }

  const { chain, clientId, profile } = routing.buildRoutingChain(req, config);
  const state = externalState || routing.createRequestState(config, clientId, profile);

  if (config.prompt?.mode !== 'passthrough' && !promptConfigured(config, clientId)) {
    return anthropicError(
      res,
      503,
      `Custom instruction is not configured. Open ${config.paths.promptFile} and replace ${config.prompt.placeholder}`,
      'promptrelay_prompt_not_configured',
    );
  }

  const controller = createAbortController(req, res);
  const wantStream = body.stream === true;

  let ir;
  try {
    ir = anthropicRequestToIR(body);
    applyPromptPolicyIR(ir, config, clientId);
  } catch (error) {
    return anthropicError(res, 400, error.message);
  }

  const hooks = {
    signal: controller.signal,
    onRetry: (info) => logger.warn(`↻ retry messages (${info.attempt}/${info.maxRetries}) after ${info.delayMs}ms`, info.status ? `status ${info.status}` : info.error),
  };

  const startedAt = Date.now();
  let index = 0;

  while (index < chain.length) {
    const current = chain[index];
    const hasNext = index < chain.length - 1;

    state.provider = current.provider.name;
    state.model = current.provider.model;
    if (index > 0) {
      state.fallback = true;
      state.providerAttempts = index + 1;
    }

    const modelForResponse = current.provider.forceModel ? current.provider.model : (ir.model || current.provider.model);

    if (current.logging?.requests) {
      logger.log('');
      logger.log('══════════════════════════════════════════════');
      logger.log('⚡ PROMPTRELAY REQUEST · ANTHROPIC MESSAGES (ingress)');
      logger.log(`Provider    : ${current.provider.name} (${current.provider.transport})`);
      logger.log(`Model       : ${modelForResponse}`);
      logger.log(`Client      : ${clientId}`);
      logger.log(`Stream      : ${wantStream}`);
      if (index > 0) logger.log(`Fallback    : attempt #${index + 1}`);
      logger.log('══════════════════════════════════════════════');
    }

    try {
      if (wantStream) {
        const iterator = callProviderStream(ir, current, hooks)[Symbol.asyncIterator]();
        // Trigger the upstream request now so connection errors surface before headers.
        const first = await iterator.next();

        res.status(200);
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        if (typeof res.flushHeaders === 'function') res.flushHeaders();

        async function* replay() {
          if (!first.done) yield first.value;
          while (true) {
            const n = await iterator.next();
            if (n.done) break;
            yield n.value;
          }
        }

        await writeAnthropicStream(replay(), (chunk) => {
          if (!res.writableEnded && !res.destroyed) res.write(chunk);
        }, { model: modelForResponse });

        if (!res.writableEnded) res.end();
        if (current.logging?.requests) logger.log(`Stream done : ${Date.now() - startedAt}ms`);
        return;
      }

      const nr = await callProviderNonStream(ir, current, hooks);
      const out = irToAnthropicResponse(nr, { model: modelForResponse });
      if (current.logging?.requests) logger.log(`Completed   : ${Date.now() - startedAt}ms`);
      return res.json(out);
    } catch (error) {
      if (error?.name === 'AbortError') return;

      if (error instanceof CompatibilityError) {
        logger.error('PromptRelay compatibility error:', error.message);
        if (!res.headersSent) return anthropicError(res, error.statusCode || 400, error.message, error.type);
        if (!res.writableEnded) res.end();
        return;
      }

      // Check if fallback is possible before response headers were committed
      if (!res.headersSent && hasNext) {
        state.error = error?.message || 'Upstream provider error';
        logger.warn(`⚠ provider "${current.provider.name}" failed: ${error?.message || 'error'}. Trying fallback…`);
        index += 1;
        logger.warn(`↪ falling back to provider "${chain[index].provider.name}" (reason: ${error?.message || 'failed'})`);
        continue;
      }

      logger.error('PromptRelay /v1/messages error:', error?.message || error);
      if (!res.headersSent) {
        const status = error?.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
        return anthropicError(res, status, error?.message || 'Provider request failed.', 'provider_connection_error');
      }
      // Stream already started: emit a terminal SSE error event so the client is not left hanging.
      if (!res.writableEnded) {
        try { res.write(formatSSE('error', { type: 'error', error: { type: 'provider_connection_error', message: error?.message || 'stream failed' } })); } catch { /* noop */ }
        res.end();
      }
      return;
    }
  }
}

module.exports = { handleMessages };

'use strict';

/**
 * Anthropic native egress adapter.
 *
 * Presents the standard adapter interface { models, chat } and is selected when
 * the active provider's transport is 'anthropic-native'. It lets any
 * OpenAI-speaking client (which hits /v1/chat/completions) use Anthropic's
 * Messages API upstream: the OpenAI request is normalized to IR, the prompt
 * policy is applied, the request is sent to Anthropic, and the Anthropic
 * response (or SSE stream) is translated back to OpenAI shape.
 */

const {
  openaiRequestToIR,
  irToOpenAIResponse,
  writeOpenAIStream,
  applyPromptPolicyIR,
  callProviderNonStream,
  callProviderStream,
  ANTHROPIC_VERSION,
} = require('../ir');
const {
  providerHeaders,
  createAbortController,
  setUpstreamContentType,
  joinURL,
} = require('../providers/http');
const { fetchWithRetry } = require('./retry');
const logger = require('../telemetry/logger');

async function models(req, res, config) {
  const controller = createAbortController(req, res);
  const modelsPath = config.provider.modelsPath || '/v1/models';
  const headers = providerHeaders(config);
  if (!headers['anthropic-version']) headers['anthropic-version'] = ANTHROPIC_VERSION;

  try {
    const upstream = await fetchWithRetry(
      joinURL(config.provider.baseURL, modelsPath),
      { headers, signal: controller.signal },
      config.retry,
      { onRetry: (info) => logger.warn(`↻ retry models (${info.attempt}/${info.maxRetries}) after ${info.delayMs}ms`, info.status ? `status ${info.status}` : info.error) },
    );
    const data = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    setUpstreamContentType(res, upstream);
    return res.send(data);
  } catch (error) {
    if (error?.name === 'AbortError') return;
    return res.status(502).json({
      error: { message: error?.message || 'Failed to fetch provider models.', type: 'provider_connection_error' },
    });
  }
}

async function chat(req, res, config, options = {}) {
  const controller = createAbortController(req, res);
  const wantStream = req.body?.stream === true;

  let ir;
  try {
    ir = openaiRequestToIR(req.body || {});
    applyPromptPolicyIR(ir, config, options.clientId);
  } catch (error) {
    return res.status(400).json({ error: { message: error.message, type: 'invalid_request_error' } });
  }

  const startedAt = Date.now();
  if (config.logging.requests) {
    logger.log('');
    logger.log('══════════════════════════════════════════════');
    logger.log('⚡ PROMPTRELAY REQUEST · ANTHROPIC-NATIVE (egress)');
    logger.log(`Provider    : ${config.provider.name}`);
    logger.log(`Model       : ${config.provider.forceModel ? config.provider.model : (ir.model || config.provider.model)}`);
    logger.log(`Mode        : ${config.prompt.mode}`);
    logger.log(`Stream      : ${wantStream}`);
    logger.log('══════════════════════════════════════════════');
  }

  const hooks = {
    signal: controller.signal,
    onRetry: (info) => logger.warn(`↻ retry chat (${info.attempt}/${info.maxRetries}) after ${info.delayMs}ms`, info.status ? `status ${info.status}` : info.error),
  };

  try {
    if (wantStream) {
      const irEvents = callProviderStream(ir, config, hooks);
      // Peek not needed; the first read either yields or throws before we've sent bytes.
      const iterator = irEvents[Symbol.asyncIterator]();
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

      await writeOpenAIStream(replay(), (chunk) => {
        if (!res.writableEnded && !res.destroyed) res.write(chunk);
      }, { model: config.provider.forceModel ? config.provider.model : ir.model });

      if (!res.writableEnded) res.end();
      if (config.logging.requests) logger.log(`Stream done : ${Date.now() - startedAt}ms`);
      return;
    }

    const nr = await callProviderNonStream(ir, config, hooks);
    const body = irToOpenAIResponse(nr, { model: config.provider.forceModel ? config.provider.model : ir.model });
    if (config.logging.requests) logger.log(`Completed   : ${Date.now() - startedAt}ms`);
    return res.json(body);
  } catch (error) {
    if (error?.name === 'AbortError') return;

    if (typeof options.tryNext === 'function' && !res.headersSent) {
      logger.warn(`⚠ provider "${config.provider.name}" failed: ${error?.message}. Trying fallback…`);
      const handled = await options.tryNext({ error: error?.message, provider: config.provider.name });
      if (handled) return;
    }

    logger.error('PromptRelay Anthropic provider error:', error?.message || error);
    if (!res.headersSent) {
      const status = error?.statusCode && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 502;
      return res.status(status).json({
        error: { message: error?.message || 'Provider request failed.', type: error?.type || 'provider_connection_error' },
      });
    }
    if (!res.writableEnded) res.end();
  }
}

module.exports = { models, chat };

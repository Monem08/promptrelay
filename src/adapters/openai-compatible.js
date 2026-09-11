'use strict';

const { applyPromptPolicy } = require('../prompts');
const { applyOpenAIReasoning } = require('../reasoning');
const {
  providerHeaders,
  resolveModel,
  createAbortController,
  setUpstreamContentType,
  joinURL,
} = require('../providers/http');
const { fetchWithRetry } = require('./retry');
const logger = require('../telemetry/logger');

async function models(req, res, config) {
  const controller = createAbortController(req, res);
  const modelsPath = config.provider.modelsPath || 'models';

  try {
    const upstream = await fetchWithRetry(
      joinURL(config.provider.baseURL, modelsPath),
      { headers: providerHeaders(config), signal: controller.signal },
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
      error: {
        message: error?.message || 'Failed to fetch provider models.',
        type: 'provider_connection_error',
      },
    });
  }
}

async function chat(req, res, config, options = {}) {
  const incoming = req.body || {};
  const controller = createAbortController(req, res);

  let upstreamBody = {
    ...incoming,
    model: resolveModel(incoming.model, config),
    messages: applyPromptPolicy(incoming.messages, config, options.clientId),
  };

  upstreamBody = applyOpenAIReasoning(upstreamBody, config);

  // PromptRelay-only fields must never leak upstream.
  delete upstreamBody.nuclear_reasoning;
  delete upstreamBody.promptrelay;
  delete upstreamBody.proxy_provider;

  const startedAt = Date.now();
  const url = joinURL(config.provider.baseURL, config.provider.chatPath || 'chat/completions');

  if (config.logging.requests) {
    logger.log('');
    logger.log('══════════════════════════════════════════════');
    logger.log('⚡ PROMPTRELAY REQUEST · OPENAI-COMPATIBLE');
    logger.log(`Provider    : ${config.provider.name}`);
    logger.log(`Model       : ${upstreamBody.model}`);
    logger.log(`Mode        : ${config.prompt.mode}`);
    logger.log(`Stream      : ${Boolean(upstreamBody.stream)}`);
    logger.log(`Messages    : ${incoming.messages.length} → ${upstreamBody.messages.length}`);
    logger.log(`Upstream    : ${url}`);
    logger.log('══════════════════════════════════════════════');
  }

  try {
    const upstream = await fetchWithRetry(
      url,
      {
        method: 'POST',
        headers: providerHeaders(config),
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      },
      config.retry,
      {
        onRetry: (info) => {
          if (options.state) options.state.retries = (options.state.retries || 0) + 1;
          logger.warn(`↻ retry chat (${info.attempt}/${info.maxRetries}) after ${info.delayMs}ms`, info.status ? `status ${info.status}` : info.error);
        },
      },
    );


    if (config.logging.requests) {
      logger.log(`Connected   : ${Date.now() - startedAt}ms`);
    }

    const { isRetryableStatus } = require('./retry');
    if (!upstream.ok && isRetryableStatus(upstream.status, config.retry?.retryableStatus) && typeof options.tryNext === 'function' && !res.headersSent) {
      logger.warn(`⚠ provider "${config.provider.name}" returned exhausted retryable status ${upstream.status}. Trying fallback…`);
      const handled = await options.tryNext({
        error: `Provider returned status ${upstream.status}`,
        status: upstream.status,
        provider: config.provider.name,
      });
      if (handled) return;
    }

    res.status(upstream.status);
    setUpstreamContentType(res, upstream);


    if (incoming.stream === true) {
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      if (!upstream.body) return res.end();
      const reader = upstream.body.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (res.writableEnded || res.destroyed) break;
          res.write(Buffer.from(value));
        }
      } finally {
        try { reader.releaseLock(); } catch {}
      }

      if (!res.writableEnded) res.end();
      if (config.logging.requests) logger.log(`Stream done : ${Date.now() - startedAt}ms`);
      return;
    }

    const data = Buffer.from(await upstream.arrayBuffer());
    if (config.logging.requests) logger.log(`Completed   : ${Date.now() - startedAt}ms`);
    return res.send(data);
  } catch (error) {
    if (error?.name === 'AbortError') return;

    // Explicit fallback (never silent): only possible before any bytes are sent.
    if (typeof options.tryNext === 'function' && !res.headersSent) {
      logger.warn(`⚠ provider "${config.provider.name}" failed: ${error?.message}. Trying fallback…`);
      const handled = await options.tryNext({ error: error?.message, provider: config.provider.name });
      if (handled) return;
    }

    logger.error('PromptRelay provider error:', error?.message || error);
    if (!res.headersSent) {
      return res.status(502).json({
        error: {
          message: error?.message || 'Provider request failed.',
          type: 'provider_connection_error',
        },
      });
    }
    if (!res.writableEnded) res.end();
  }
}

module.exports = {
  models,
  chat,
};

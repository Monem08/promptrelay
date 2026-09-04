const { applyPromptPolicy } = require('../prompt');
const { applyOpenAIReasoning } = require('../reasoning');
const {
  providerHeaders,
  resolveModel,
  createAbortController,
  setUpstreamContentType,
} = require('../http');

function joinURL(baseURL, path) {
  return `${String(baseURL).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

async function models(req, res, config) {
  const controller = createAbortController(req, res);
  const modelsPath = config.provider.modelsPath || 'models';

  try {
    const upstream = await fetch(joinURL(config.provider.baseURL, modelsPath), {
      headers: providerHeaders(config),
      signal: controller.signal,
    });

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

async function chat(req, res, config) {
  const incoming = req.body || {};
  const controller = createAbortController(req, res);

  let upstreamBody = {
    ...incoming,
    model: resolveModel(incoming.model, config),
    messages: applyPromptPolicy(incoming.messages, config),
  };

  upstreamBody = applyOpenAIReasoning(upstreamBody, config);

  // PromptRelay-only fields must never leak upstream.
  delete upstreamBody.nuclear_reasoning;
  delete upstreamBody.promptrelay;
  delete upstreamBody.proxy_provider;

  const startedAt = Date.now();
  const url = joinURL(config.provider.baseURL, config.provider.chatPath || 'chat/completions');

  if (config.logging.requests) {
    console.log('');
    console.log('══════════════════════════════════════════════');
    console.log('⚡ PROMPTRELAY REQUEST · OPENAI-COMPATIBLE');
    console.log(`Provider    : ${config.provider.name}`);
    console.log(`Model       : ${upstreamBody.model}`);
    console.log(`Mode        : ${config.prompt.mode}`);
    console.log(`Stream      : ${Boolean(upstreamBody.stream)}`);
    console.log(`Messages    : ${incoming.messages.length} → ${upstreamBody.messages.length}`);
    console.log(`Upstream    : ${url}`);
    console.log('══════════════════════════════════════════════');
  }

  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers: providerHeaders(config),
      body: JSON.stringify(upstreamBody),
      signal: controller.signal,
    });

    if (config.logging.requests) {
      console.log(`Connected   : ${Date.now() - startedAt}ms`);
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
      if (config.logging.requests) console.log(`Stream done : ${Date.now() - startedAt}ms`);
      return;
    }

    const data = Buffer.from(await upstream.arrayBuffer());
    if (config.logging.requests) console.log(`Completed   : ${Date.now() - startedAt}ms`);
    return res.send(data);
  } catch (error) {
    if (error?.name === 'AbortError') return;

    console.error('PromptRelay provider error:', error);
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

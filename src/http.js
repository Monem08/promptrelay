function providerHeaders(config) {
  const headers = {
    'Content-Type': 'application/json',
    ...(config.provider.headers || {}),
  };

  const auth = config.provider.auth || { type: 'bearer' };
  const type = String(auth.type || 'bearer').toLowerCase();

  if (type === 'bearer' && config.provider.apiKey) {
    headers.Authorization = `Bearer ${config.provider.apiKey}`;
  } else if (type === 'header' && config.provider.apiKey) {
    headers[auth.headerName || 'x-api-key'] = config.provider.apiKey;
  }

  return headers;
}

function resolveModel(incomingModel, config) {
  if (config.provider.forceModel) return config.provider.model;
  if (!incomingModel || incomingModel === 'default' || incomingModel === 'proxy-default') {
    return config.provider.model;
  }
  return incomingModel;
}

function createAbortController(req, res) {
  const controller = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded && !controller.signal.aborted) controller.abort();
  });
  req.on('aborted', () => {
    if (!controller.signal.aborted) controller.abort();
  });
  return controller;
}

function setUpstreamContentType(res, upstream, fallback = 'application/json') {
  res.setHeader('Content-Type', upstream.headers.get('content-type') || fallback);
}

module.exports = {
  providerHeaders,
  resolveModel,
  createAbortController,
  setUpstreamContentType,
};

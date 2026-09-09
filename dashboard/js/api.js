// PromptRelay Dashboard — API client
// Thin fetch wrapper around /api/dashboard/*. Caches GETs briefly to avoid
// hammering the gateway; never polls aggressively.

const BASE = '/api/dashboard';
const cache = new Map();
const TTL = 4000; // ms

async function request(path, { method = 'GET', body, noCache = false } = {}) {
  const key = `${method} ${path}`;
  if (method === 'GET' && !noCache) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.data;
  }
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('Cannot reach the PromptRelay gateway.', { network: true, detail: err.message });
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || `Request failed (HTTP ${res.status})`;
    throw new ApiError(msg, { status: res.status, type: data?.error?.type, detail: text.slice(0, 300) });
  }
  if (method === 'GET') cache.set(key, { at: Date.now(), data });
  else cache.clear(); // mutations invalidate cache
  return data;
}

export class ApiError extends Error {
  constructor(message, meta = {}) { super(message); this.name = 'ApiError'; Object.assign(this, meta); }
}

export const api = {
  status:        () => request('/status'),
  clients:       () => request('/clients'),
  providers:     () => request('/providers'),
  models:        (refresh) => request(`/models${refresh ? '?refresh=1' : ''}`, { noCache: refresh }),
  router:        (profile) => request(`/router${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`),
  prompts:       () => request('/prompts'),
  requests:      (limit = 100) => request(`/requests?limit=${limit}`, { noCache: true }),
  request:       (id) => request(`/requests/${encodeURIComponent(id)}`),
  metrics:       () => request('/metrics', { noCache: true }),
  diagnostics:   (deep) => request(`/diagnostics${deep ? '?deep=1' : ''}`, { noCache: true }),
  settings:      () => request('/settings'),
  // mutations
  refreshModels: () => request('/models/refresh', { method: 'POST' }),
  useModel:      (id) => request('/model/use', { method: 'POST', body: { id } }),
  useProvider:   (name) => request('/provider/use', { method: 'POST', body: { name } }),
  addProvider:   (payload) => request('/provider', { method: 'POST', body: payload }),
  testProvider:  (payload) => request('/provider/test', { method: 'POST', body: payload }),
  savePrompt:    (payload) => request('/prompts', { method: 'POST', body: payload }),
  saveRouter:    (payload) => request('/router', { method: 'POST', body: payload }),
  saveSettings:  (payload) => request('/settings', { method: 'POST', body: payload }),
  autopilot:     () => request('/autopilot', { method: 'POST' }),
  clearRequests: () => request('/requests/clear', { method: 'POST' }),
  runDiagnostics: (deep) => request(`/diagnostics${deep ? '?deep=1' : ''}`, { noCache: true }),
};

export function clearCache() { cache.clear(); }

import { api, clearCache } from '../api.js';
import {
  h, icon, btn, badge, statusDot, skeleton, toast, emptyState, drawer, closeOverlay,
  fmtBool, fmtNum, fmtTime, copyText, createLogo,
} from '../ui.js';

const state = { models: [], source: null, q: '', chips: new Set(), ctx: null, sort: 'recommended', provider: 'all' };

const CAP_CHIPS = [
  ['free', 'Free'], ['paid', 'Paid'], ['unknownPrice', 'Unknown pricing'],
  ['tools', 'Tools'], ['reasoning', 'Reasoning'], ['vision', 'Vision'],
  ['streaming', 'Streaming'], ['structuredOutput', 'Structured Output'],
  ['long', 'Long Context'], ['local', 'Local'], ['healthy', 'Healthy'],
];
const CTX_CHIPS = [['ctx32', '32K+', 32000], ['ctx128', '128K+', 128000], ['ctx200', '200K+', 200000], ['ctx1m', '1M+', 1000000]];
const SORTS = [['recommended', 'Recommended'], ['name', 'Name'], ['context', 'Context'], ['price', 'Price'], ['verified', 'Recently Verified']];

const isUnknown = (v) => v === 'unknown' || v == null || v === '';
const num = (v) => (typeof v === 'number' ? v : (isUnknown(v) ? null : Number(v)));

function priceLabel(m) {
  if (m.free === true) return badge('Free', 'green');
  const inp = num(m.inputPrice), outp = num(m.outputPrice);
  if (inp == null && outp == null) return unknownSpan();
  return h('span.mono', { style: 'font-size:var(--fs-xs)' }, [`$${inp ?? '?'}/$${outp ?? '?'}`]);
}
function unknownSpan() { return h('span.muted-3', { title: 'Not reported' }, ['Unknown']); }
function ctxLabel(v) { const n = num(v); if (n == null) return unknownSpan(); return h('span.mono', {}, [n >= 1000 ? `${Math.round(n / 1000)}K` : String(n)]); }

function matches(m) {
  const q = state.q.trim().toLowerCase();
  if (q) {
    const hay = `${m.id} ${m.name} ${m.provider}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (state.provider !== 'all' && String(m.provider) !== state.provider) return false;
  for (const c of state.chips) {
    if (c === 'free' && m.free !== true) return false;
    if (c === 'paid' && !(m.free === false)) return false;
    if (c === 'unknownPrice' && !(isUnknown(m.inputPrice) && isUnknown(m.outputPrice) && isUnknown(m.free))) return false;
    if (c === 'tools' && m.tools !== true) return false;
    if (c === 'reasoning' && m.reasoning !== true) return false;
    if (c === 'vision' && m.vision !== true) return false;
    if (c === 'streaming' && m.streaming !== true) return false;
    if (c === 'structuredOutput' && m.structuredOutput !== true) return false;
    if (c === 'local' && !/local|ollama|127\.0\.0\.1|localhost/i.test(`${m.provider} ${m.source}`)) return false;
    if (c === 'healthy' && m.health?.ok !== true) return false;
    const ctxChip = CTX_CHIPS.find((x) => x[0] === c);
    if (ctxChip) { const n = num(m.contextWindow); if (n == null || n < ctxChip[2]) return false; }
    if (c === 'long') { const n = num(m.contextWindow); if (n == null || n < 128000) return false; }
  }
  return true;
}

function sortModels(list) {
  const s = state.sort;
  const arr = list.slice();
  if (s === 'name') arr.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  else if (s === 'context') arr.sort((a, b) => (num(b.contextWindow) || -1) - (num(a.contextWindow) || -1));
  else if (s === 'price') arr.sort((a, b) => priceSortKey(a) - priceSortKey(b));
  else if (s === 'verified') arr.sort((a, b) => new Date(b.verifiedAt || 0) - new Date(a.verifiedAt || 0));
  else arr.sort((a, b) => recScore(b) - recScore(a)); // recommended
  return arr;
}
function priceSortKey(m) { if (m.free === true) return -1; const p = num(m.inputPrice); return p == null ? Number.MAX_SAFE_INTEGER : p; }
// Transparent capability score from REAL fields only (no fabricated benchmarks).
function recScore(m) {
  let s = 0;
  if (m.free === true) s += 3;
  if (m.tools === true) s += 3;
  if (m.reasoning === true) s += 2;
  if (m.vision === true) s += 1;
  const c = num(m.contextWindow); if (c) s += Math.min(4, c / 200000);
  if (m.health?.ok === true) s += 2;
  return s;
}

function drawerFor(m, ctx) {
  const sec = (title, rows) => h('div.mb-16', {}, [h('div.section-title', { style: 'margin:16px 0 8px' }, [title]), h('dl.dl', {}, rows)]);
  const kv = (k, v) => [h('dt', {}, [k]), h('dd', {}, [v])];
  const body = h('div', {}, [
    sec('Overview', [
      ...kv('Model ID', h('span.mono', {}, [m.id])),
      ...kv('Display name', isUnknown(m.name) ? unknownSpan() : m.name),
      ...kv('Provider', isUnknown(m.provider) ? unknownSpan() : m.provider),
      ...kv('Lifecycle', unknownSpan()),
    ]),
    sec('Capabilities', [
      ...kv('Tools', fmtBool(m.tools)),
      ...kv('Parallel tools', fmtBool(m.parallelTools)),
      ...kv('Vision', fmtBool(m.vision)),
      ...kv('Documents', fmtBool(m.documents)),
      ...kv('Streaming', fmtBool(m.streaming)),
      ...kv('JSON / Structured', fmtBool(m.structuredOutput)),
    ]),
    sec('Limits', [
      ...kv('Context window', ctxLabel(m.contextWindow)),
      ...kv('Max output', m.maxOutputTokens && !isUnknown(m.maxOutputTokens) ? h('span.mono', {}, [fmtNum(num(m.maxOutputTokens))]) : unknownSpan()),
    ]),
    sec('Pricing', [
      ...kv('Free', fmtBool(m.free)),
      ...kv('Input price', isUnknown(m.inputPrice) ? unknownSpan() : h('span.mono', {}, [`$${m.inputPrice}/1M`])),
      ...kv('Output price', isUnknown(m.outputPrice) ? unknownSpan() : h('span.mono', {}, [`$${m.outputPrice}/1M`])),
      ...kv('Cache read/write', unknownSpan()),
    ]),
    sec('Reasoning', [
      ...kv('Reasoning', fmtBool(m.reasoning)),
      ...kv('Reasoning efforts', isUnknown(m.reasoningEfforts) ? unknownSpan() : (Array.isArray(m.reasoningEfforts) ? m.reasoningEfforts.join(', ') : String(m.reasoningEfforts))),
    ]),
    sec('Health', [
      ...kv('Status', m.health ? statusDot(m.health.ok === true ? 'green' : m.health.ok === false ? 'red' : 'gray', m.health.ok === true ? 'Healthy' : m.health.ok === false ? 'Error' : 'Unknown') : statusDot('gray', 'Unknown')),
      ...kv('Latency', m.health && typeof m.health.latencyMs === 'number' ? h('span.mono', {}, [`${m.health.latencyMs}ms`]) : unknownSpan()),
      ...kv('Last verified', isUnknown(m.verifiedAt) ? unknownSpan() : fmtTime(m.verifiedAt)),
    ]),
    sec('Metadata', [
      ...kv('Source', isUnknown(m.source) ? unknownSpan() : h('span.mono', {}, [m.source])),
    ]),
  ]);
  const footer = h('div.row.wrap.gap-8', {}, [
    btn('Use Model', { variant: 'primary', icon: 'check', onClick: async () => { try { await api.useModel(m.id); clearCache(); toast('Active model set', { type: 'success', message: m.id }); closeOverlay(); ctx.refreshHealth(); } catch (e) { toast('Failed', { type: 'error', message: e.message }); } } }),
    btn('Set as Client Model', { icon: 'clients', onClick: () => { closeOverlay(); ctx.navigate('router'); toast('Set per-client models on the Router page'); } }),
    btn('Test', { icon: 'play', onClick: async () => { toast('Safe provider check…'); try { const r = await api.testProvider({ live: false }); toast(r.ok ? 'Provider reachable' : 'Check failed', { type: r.ok ? 'success' : 'error', message: r.error || null }); } catch (e) { toast('Failed', { type: 'error', message: e.message }); } } }),
    btn('Add to Fallback', { icon: 'router', onClick: () => { closeOverlay(); ctx.navigate('router'); toast('Manage the fallback chain on the Router page'); } }),
  ]);
  drawer({ title: isUnknown(m.name) ? m.id : m.name, subtitle: m.id, body, footer });
}

function renderTable(list, ctx) {
  const rows = list.map((m) => h('tr', { onclick: () => drawerFor(m, ctx), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') drawerFor(m, ctx); } }, [
    h('td.mono', {}, [m.id]),
    h('td', {}, [h('div.row.gap-8', {}, [createLogo(m.provider || m.id, { size: 18 }), h('span', {}, [isUnknown(m.provider) ? unknownSpan() : m.provider])])]),
    h('td', {}, [ctxLabel(m.contextWindow)]),
    h('td', {}, [m.maxOutputTokens && !isUnknown(m.maxOutputTokens) ? h('span.mono', {}, [fmtNum(num(m.maxOutputTokens))]) : unknownSpan()]),
    h('td', {}, [capDot(m.tools)]),
    h('td', {}, [capDot(m.reasoning)]),
    h('td', {}, [capDot(m.vision)]),
    h('td', {}, [priceLabel(m)]),
    h('td', {}, [m.health ? statusDot(m.health.ok === true ? 'green' : m.health.ok === false ? 'red' : 'gray', m.health.ok === true ? 'OK' : m.health.ok === false ? 'Err' : '?') : statusDot('gray', '?')]),
  ]));
  return h('div.table-wrap.only-desktop', { style: 'display:block' }, [
    h('div.table-scroll', {}, [
      h('table.data', {}, [
        h('thead', {}, [h('tr', {}, ['Model', 'Provider', 'Context', 'Output', 'Tools', 'Reasoning', 'Vision', 'Price', 'Health'].map((t) => h('th', {}, [t])))]),
        h('tbody', {}, rows),
      ]),
    ]),
  ]);
}
function capDot(v) {
  if (v === true) return h('span.row.gap-6', {}, [h('span.dot.dot-green', { 'aria-hidden': 'true' }), h('span.sr-only', {}, ['Yes'])]);
  if (v === false) return h('span.muted-3', {}, ['No']);
  return h('span.row.gap-6', {}, [h('span.dot.dot-gray', { 'aria-hidden': 'true' }), h('span.sr-only', {}, ['Unknown']), h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['?'])]);
}

function renderCards(list, ctx) {
  return h('div.grid.grid-cards.only-mobile', {}, list.map((m) => h('div.card.card-hover', { onclick: () => drawerFor(m, ctx), tabindex: '0', onkeydown: (e) => { if (e.key === 'Enter') drawerFor(m, ctx); } }, [
    h('div.row-between.mb-8', {}, [h('div.mono', { style: 'font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis' }, [m.id]), priceLabel(m)]),
    h('div.muted.mb-8', { style: 'font-size:var(--fs-sm)' }, [isUnknown(m.provider) ? 'Unknown provider' : m.provider]),
    h('div.chips', {}, [
      m.tools === true ? h('span.chip.active', {}, ['Tools']) : null,
      m.reasoning === true ? h('span.chip.active', {}, ['Reasoning']) : null,
      m.vision === true ? h('span.chip.active', {}, ['Vision']) : null,
      h('span.chip', {}, ['ctx ', ctxLabel(m.contextWindow)]),
    ]),
  ])));
}

let resultsHolder, countEl;
function applyFilters(ctx) {
  const filtered = sortModels(state.models.filter(matches));
  if (countEl) countEl.textContent = `${filtered.length} of ${state.models.length}`;
  while (resultsHolder.firstChild) resultsHolder.removeChild(resultsHolder.firstChild);
  if (!state.models.length) {
    resultsHolder.appendChild(emptyState({ icon: 'models', title: 'No models discovered yet', text: 'Refresh models after connecting a provider.', action: btn('Refresh Models', { variant: 'primary', icon: 'refresh', onClick: () => doRefresh(ctx) }) }));
    return;
  }
  if (!filtered.length) { resultsHolder.appendChild(emptyState({ icon: 'search', title: 'No models match your filters', text: 'Try clearing some filters or the search query.' })); return; }
  resultsHolder.appendChild(renderTable(filtered, ctx));
  resultsHolder.appendChild(renderCards(filtered, ctx));
}

async function doRefresh(ctx) {
  toast('Refreshing models…');
  try { const r = await api.refreshModels(); state.models = r.models || []; state.source = r.source; clearCache(); toast(`${state.models.length} models`, { type: 'success' }); applyFilters(ctx); }
  catch (e) { toast('Refresh failed', { type: 'error', message: e.message }); }
}

export async function render(page, ctx) {
  state.ctx = ctx;
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Models']), h('div.page-sub', {}, ['Explore every model your providers expose'])]),
    h('div.page-head-actions', {}, [btn('Refresh Models', { icon: 'refresh', onClick: () => doRefresh(ctx) })]),
  ]));

  const loading = h('div', {}, [skeleton('skeleton-line', 'width:40%'), skeleton('skeleton-card'), skeleton('skeleton-card')]);
  page.appendChild(loading);

  let data;
  try { data = await api.models(); } catch (e) { data = { models: [], error: e.message }; }
  state.models = data.models || [];
  state.source = data.source;
  page.removeChild(loading);

  // controls
  const search = h('input.input', { type: 'search', placeholder: 'Search models, providers, capabilities…', 'aria-label': 'Search models', oninput: (e) => { state.q = e.target.value; applyFilters(ctx); } });
  const providerNames = Array.from(new Set(state.models.map((m) => m.provider).filter((p) => p && p !== 'unknown')));
  const providerSel = h('select.select', { 'aria-label': 'Filter by provider', style: 'max-width:200px', onchange: (e) => { state.provider = e.target.value; applyFilters(ctx); } }, [
    h('option', { value: 'all' }, ['All providers']),
    ...providerNames.map((p) => h('option', { value: p }, [p])),
  ]);
  const sortSel = h('select.select', { 'aria-label': 'Sort', style: 'max-width:180px', onchange: (e) => { state.sort = e.target.value; applyFilters(ctx); } },
    SORTS.map(([v, l]) => h('option', { value: v }, [l])));

  const chipEls = [];
  const chipRow = h('div.chips.mb-12', {}, [...CAP_CHIPS, ...CTX_CHIPS.map((c) => [c[0], c[1]])].map(([key, label]) => {
    const el = h('button.chip', { onclick: () => { state.chips.has(key) ? state.chips.delete(key) : state.chips.add(key); el.classList.toggle('active'); applyFilters(ctx); } }, [label]);
    chipEls.push(el); return el;
  }));

  countEl = h('span.muted-3', { style: 'font-size:var(--fs-sm)' }, ['']);
  page.appendChild(h('div.card.mb-16', {}, [
    h('div.row.wrap.gap-8.mb-12', {}, [h('div', { style: 'flex:1;min-width:200px' }, [search]), providerSel, sortSel]),
    chipRow,
    h('div.row-between', {}, [countEl, state.source ? badge(`Source: ${state.source}`, 'gray') : null]),
  ]));

  resultsHolder = h('div');
  page.appendChild(resultsHolder);
  applyFilters(ctx);
}

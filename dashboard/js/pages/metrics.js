// Metrics — real charts only. Never fabricates data points.
import { api } from '../api.js';
import {
  h, icon, btn, badge, skeleton, errorState, emptyState, fmtMs, fmtNum, fmtTime, UNKNOWN,
} from '../ui.js';

function metricCard(label, value, { foot, unknown } = {}) {
  return h('div.metric', {}, [
    h('div.metric-label', {}, [label]),
    h('div', { class: `metric-value${unknown ? ' unknown' : ''}` }, [value]),
    foot ? h('div.metric-foot', {}, [foot]) : null,
  ]);
}

// Horizontal ranked bar list (real counts)
function rankList(items, { unit = '' } = {}) {
  const rows = items || [];
  if (!rows.length) return h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No data yet']);
  const max = Math.max(...rows.map((r) => r.value), 1);
  return h('div.stack', { style: 'gap:10px' }, rows.map((r) => h('div', {}, [
    h('div.row.row-between', { style: 'font-size:var(--fs-sm);margin-bottom:4px' }, [
      h('span.truncate', { style: 'max-width:70%' }, [r.name || UNKNOWN]),
      h('span.mono.muted', { style: 'font-size:var(--fs-xs)' }, [`${fmtNum(r.value)}${unit}`]),
    ]),
    h('div.scorebar', {}, [h('div.scorebar-fill', { style: `width:${Math.round((r.value / max) * 100)}%` })]),
  ])));
}

// Vertical bars for requests-over-time (ok + error stacked, real counts)
function timeBars(buckets) {
  const rows = buckets || [];
  if (!rows.length) return h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No data yet']);
  const max = Math.max(...rows.map((b) => b.total || 0), 1);
  return h('div', {}, [
    h('div.bars', {}, rows.map((b) => {
      const total = b.total || 0;
      const err = b.error || 0;
      const ok = Math.max(total - err, 0);
      const totalH = Math.round((total / max) * 100);
      const errH = total ? Math.round((err / total) * totalH) : 0;
      const okH = totalH - errH;
      return h('div', {
        title: `${fmtTime(b.time)} · ${total} request${total === 1 ? '' : 's'}${err ? `, ${err} error${err === 1 ? '' : 's'}` : ''}`,
        style: 'flex:1;min-width:3px;display:flex;flex-direction:column;justify-content:flex-end;height:100%',
      }, [
        errH ? h('div', { style: `height:${errH}%;background:linear-gradient(180deg,var(--red),#a03);border-radius:3px 3px 0 0;min-height:2px` }) : null,
        h('div', { style: `height:${okH}%;background:linear-gradient(180deg,var(--violet),var(--indigo));border-radius:${errH ? '0' : '3px 3px 0 0'};min-height:${total ? '2px' : '0'}` }),
      ]);
    })),
    h('div.row.row-between.mt-8', { style: 'font-size:var(--fs-xs)' }, [
      h('span.muted-3', {}, [rows.length ? fmtTime(rows[0].time) : '']),
      h('span.muted-3', {}, [rows.length ? fmtTime(rows[rows.length - 1].time) : '']),
    ]),
  ]);
}

// Latency distribution bars from recent per-request values (real)
function latencyBars(values) {
  const nums = (values || []).filter((v) => typeof v === 'number' && isFinite(v));
  if (!nums.length) return h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No data yet']);
  const max = Math.max(...nums, 1);
  return h('div.bars', {}, nums.map((v) => h('div.bar', {
    title: fmtMs(v), style: `height:${Math.max(Math.round((v / max) * 100), 2)}%`,
  })));
}

function chartCard(title, sub, body) {
  return h('div.card', {}, [
    h('div.card-head', {}, [h('div', {}, [h('div.card-title', {}, [title]), sub ? h('div.card-sub', {}, [sub]) : null])]),
    h('div.mt-12', {}, [body]),
  ]);
}

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [
      h('h1.page-title', {}, ['Metrics']),
      h('div.page-sub', {}, ['Traffic, latency, and usage — computed from real recorded requests only']),
    ]),
    h('div.page-head-actions', {}, [
      btn('Refresh', { icon: 'refresh', sm: true, onClick: () => ctx.navigate('metrics', true) }),
    ]),
  ]));

  const loading = h('div', {}, [skeleton('skeleton-line', 'width:25%'), h('div.grid.grid-metrics', {}, Array.from({ length: 4 }, () => skeleton('skeleton-card')))]);
  page.appendChild(loading);

  let m, reqData;
  try {
    [m, reqData] = await Promise.all([api.metrics(), api.requests(200)]);
  } catch (e) {
    page.removeChild(loading);
    page.appendChild(errorState({ title: 'Could not load metrics', message: e.message, onRetry: () => ctx.navigate('metrics', true) }));
    return;
  }
  page.removeChild(loading);

  if (!m.hasData) {
    page.appendChild(emptyState({
      icon: 'metrics',
      title: 'No data yet',
      text: 'Metrics will populate after traffic begins. Once clients send requests through PromptRelay, latency, usage, and reliability charts appear here.',
    }));
    return;
  }

  const reqs = reqData.requests || [];

  // ---- summary cards ----
  const successPct = m.successRate === UNKNOWN || m.successRate == null ? null : Math.round(Number(m.successRate) * (Number(m.successRate) <= 1 ? 100 : 1));
  page.appendChild(h('div.grid.grid-metrics.mb-16', {}, [
    metricCard('Total requests', fmtNum(m.total)),
    metricCard('Success rate', successPct == null ? UNKNOWN : `${successPct}%`, { unknown: successPct == null, foot: successPct == null ? 'No data' : `${fmtNum(m.total - (m.errorCount || 0))} ok / ${fmtNum(m.total)}` }),
    metricCard('Errors', fmtNum(m.errorCount || 0), { foot: (m.errorCount || 0) > 0 ? 'across recorded window' : 'none recorded' }),
    metricCard('Fallback events', fmtNum(m.fallbackCount || 0)),
    metricCard('Median total', fmtMs(m.medianTotalMs)),
    metricCard('Median TTFT', fmtMs(m.medianTtftMs)),
  ]));

  // ---- requests over time ----
  page.appendChild(chartCard(
    'Requests over time', 'Per-minute buckets · red = errors',
    timeBars(m.overTime),
  ));

  // ---- latency row ----
  const ttftVals = reqs.map((r) => r.ttftMs).filter((v) => typeof v === 'number');
  const totalVals = reqs.map((r) => r.totalMs).filter((v) => typeof v === 'number');
  page.appendChild(h('div.grid.grid-cards.mt-16', {}, [
    chartCard('Time to first token', ttftVals.length ? `${ttftVals.length} sampled · median ${fmtMs(m.medianTtftMs)}` : 'Streaming requests only', latencyBars(ttftVals.slice().reverse())),
    chartCard('Total latency', totalVals.length ? `${totalVals.length} sampled · median ${fmtMs(m.medianTotalMs)}` : null, latencyBars(totalVals.slice().reverse())),
  ]));

  // ---- provider / model usage ----
  page.appendChild(h('div.grid.grid-cards.mt-16', {}, [
    chartCard('Provider usage', 'Requests by provider', rankList(m.byProvider)),
    chartCard('Model usage', 'Requests by model', rankList(m.byModel)),
  ]));

  // ---- status / client ----
  page.appendChild(h('div.grid.grid-cards.mt-16', {}, [
    chartCard('Status distribution', 'HTTP status by count', rankList((m.byStatus || []).map((s) => ({ name: String(s.name), value: s.value })))),
    chartCard('Client usage', 'Requests by client', rankList(m.byClient)),
  ]));

  // ---- token usage & estimated cost (aggregated from real request records) ----
  let tokIn = 0, tokOut = 0, tokTotal = 0, tokSamples = 0;
  let cost = 0, costSamples = 0;
  reqs.forEach((r) => {
    if (r.tokens && r.tokens !== UNKNOWN && typeof r.tokens === 'object') {
      if (typeof r.tokens.input === 'number') tokIn += r.tokens.input;
      if (typeof r.tokens.output === 'number') tokOut += r.tokens.output;
      if (typeof r.tokens.total === 'number') tokTotal += r.tokens.total;
      else if (typeof r.tokens.input === 'number' || typeof r.tokens.output === 'number') tokTotal += (r.tokens.input || 0) + (r.tokens.output || 0);
      tokSamples++;
    }
    if (typeof r.cost === 'number' && isFinite(r.cost)) { cost += r.cost; costSamples++; }
  });

  const tokenBody = tokSamples
    ? h('div.grid.grid-metrics', {}, [
        metricCard('Input tokens', fmtNum(tokIn)),
        metricCard('Output tokens', fmtNum(tokOut)),
        metricCard('Total tokens', fmtNum(tokTotal)),
      ])
    : h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No data yet — token usage was not reported by providers for recorded requests']);

  const costBody = costSamples
    ? h('div', {}, [
        h('div.metric-value', {}, [`$${cost.toFixed(4)}`]),
        h('div.metric-foot', {}, [`Estimated from ${fmtNum(costSamples)} request${costSamples === 1 ? '' : 's'} with pricing`]),
      ])
    : h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No data yet — cost requires model pricing metadata']);

  page.appendChild(h('div.grid.grid-cards.mt-16', {}, [
    chartCard('Token usage', tokSamples ? `From ${fmtNum(tokSamples)} request${tokSamples === 1 ? '' : 's'} reporting usage` : null, tokenBody),
    chartCard('Estimated cost', 'Approximate — from recorded requests', costBody),
  ]));

  // ---- window footer ----
  page.appendChild(h('div.row.gap-8.mt-16', { style: 'align-items:center' }, [
    icon('metrics'),
    h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, [
      m.firstAt && m.lastAt ? `Window: ${fmtTime(m.firstAt)} — ${fmtTime(m.lastAt)} · in-memory, resets on gateway restart` : 'In-memory metrics · resets on gateway restart',
    ]),
  ]));
}

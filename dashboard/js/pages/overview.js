// Overview — the command center.
import { api, clearCache } from '../api.js';
import {
  h, icon, btn, badge, statusDot, skeleton, skeletonCards, toast,
  fmtNum, fmtMs, fmtTime, timeAgo, healthTone,
} from '../ui.js';

function metric(label, value, foot, unknown) {
  return h('div.metric', {}, [
    h('div.metric-label', {}, [label]),
    h(`div.metric-value${unknown ? '.unknown' : ''}`, {}, [value]),
    foot ? h('div.metric-foot', {}, [foot]) : null,
  ]);
}

function statusToneFromString(s, problems) {
  if (s === 'ok') return problems && problems.length ? { tone: 'amber', label: 'Degraded' } : { tone: 'green', label: 'Healthy' };
  return { tone: 'red', label: 'Attention needed' };
}

export async function render(page, ctx) {
  // header skeleton
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Overview']), h('div.page-sub', {}, ['Loading gateway status…'])]),
  ]));
  const body = h('div', {}, [skeletonCards(5)]);
  page.appendChild(body);

  const [status, clients] = await Promise.all([api.status(), api.clients().catch(() => ({ clients: [] }))]);

  clearNode(page);

  const st = statusToneFromString(status.status, status.problems);
  // ---- Header ----
  page.appendChild(h('div.page-head', {}, [
    h('div', { style: 'min-width:0' }, [
      h('div.row.gap-12', { style: 'align-items:center' }, [
        h('h1.page-title', {}, ['PromptRelay']),
        h(`span.badge.badge-${st.tone === 'green' ? 'green' : st.tone === 'amber' ? 'amber' : 'red'}`, {}, [
          h(`span.dot.dot-${st.tone}`, { 'aria-hidden': 'true', style: 'margin-right:2px' }),
          st.label,
        ]),
      ]),
      h('div.page-sub.row.wrap.gap-16', { style: 'margin-top:6px' }, [
        kv('Version', h('span.mono', {}, [status.version || '—'])),
        kv('Gateway', h('span.mono', {}, [status.gatewayURL || '—'])),
        kv('Profile', status.active?.activeProfile || '—'),
        kv('Provider', status.active?.provider || '—'),
        kv('Model', h('span.mono', {}, [status.active?.model || '—'])),
      ]),
    ]),
    h('div.page-head-actions', {}, [
      btn('Refresh', { icon: 'refresh', onClick: () => { clearCache(); ctx.navigate('overview', true); } }),
    ]),
  ]));

  // remote-access warning
  if (status.boundNonLoopback || status.remoteAccessAllowed) {
    page.appendChild(h('div.card.mb-16', { style: 'border-color:rgba(245,181,68,0.4);background:var(--amber-dim)' }, [
      h('div.row.gap-8', {}, [
        icon('shield'),
        h('div', {}, [
          h('strong', {}, ['Remote access notice']),
          h('div.muted', { style: 'font-size:var(--fs-sm)' }, [
            status.remoteAccessAllowed
              ? 'Dashboard remote access is ALLOWED. Anyone who can reach this host can view the dashboard.'
              : `Gateway is bound to ${status.host} (not loopback). Prefer 127.0.0.1 for local-only security.`,
          ]),
        ]),
      ]),
    ]));
  }

  // ---- Summary metrics ----
  const c = status.counts || {};
  const unk = (v) => v === 'unknown' || v == null;
  page.appendChild(h('div.grid.grid-metrics.mb-16', {}, [
    metric('Clients Connected', unk(c.clients) ? '—' : String(c.clients), c.clientsDetected != null ? `${c.clientsDetected} detected` : null, unk(c.clients)),
    metric('Providers', unk(c.providers) ? '—' : String(c.providers), null, unk(c.providers)),
    metric('Models', unk(c.models) ? 'No data yet' : fmtNum(c.models), status.modelsCache ? `via ${status.modelsCache.source}` : 'Refresh on Models page', unk(c.models)),
    metric('Verified Free', unk(c.freeModels) ? '—' : fmtNum(c.freeModels), null, unk(c.freeModels)),
    metric('Healthy Candidates', unk(c.healthyCandidates) ? '—' : fmtNum(c.healthyCandidates), null, unk(c.healthyCandidates)),
  ]));

  // ---- Quick actions ----
  page.appendChild(h('div.row.wrap.gap-8.mb-16', {}, [
    btn('Add Provider', { variant: 'primary', icon: 'plus', onClick: () => { ctx.navigate('providers'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:add-provider')), 60); } }),
    btn('Detect Clients', { icon: 'clients', onClick: () => { ctx.navigate('clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:detect-clients')), 60); } }),
    btn('Run Doctor', { icon: 'doctor', onClick: () => { ctx.navigate('diagnostics'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:run-diagnostics')), 60); } }),
    btn('Autopilot', { icon: 'wand', onClick: () => { ctx.navigate('diagnostics'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:run-autopilot')), 60); } }),
  ]));

  // ---- Client summary cards ----
  page.appendChild(h('div.section-title', {}, ['Clients']));
  const clientList = clients.clients || [];
  if (!clientList.length) {
    page.appendChild(h('div.card.muted', {}, ['No supported coding clients detected.']));
  } else {
    page.appendChild(h('div.grid.grid-cards.mb-16', {}, clientList.map((cl) => {
      const tone = !cl.found ? 'gray' : cl.configured ? 'green' : 'amber';
      const label = !cl.found ? 'Not configured' : cl.configured ? 'Connected' : 'Detected';
      return h('div.card', {}, [
        h('div.row-between.mb-12', {}, [
          h('div.card-title', {}, [cl.label]),
          statusDot(tone, label),
        ]),
        h('div.muted', { style: 'font-size:var(--fs-sm)' }, [cl.protocol === 'anthropic' ? 'Anthropic Messages' : 'OpenAI ingress']),
        h('div.dl.mt-12', {}, [
          h('dt', {}, ['Endpoint']), h('dd', {}, [h('span.mono', {}, [cl.endpoint || '—'])]),
          h('dt', {}, ['Model']), h('dd', {}, [h('span.mono', {}, [(cl.details && cl.details.model) || 'Auto'])]),
        ]),
      ]);
    })));
  }

  // ---- Live system row ----
  page.appendChild(h('div.section-title', {}, ['Live system']));
  const m = status.metrics || {};
  const hasData = m.hasData;
  page.appendChild(h('div.grid.grid-metrics', {}, [
    metric('Uptime', status.uptimeSeconds != null ? fmtDuration(status.uptimeSeconds) : '—', null, status.uptimeSeconds == null),
    metric('Requests', hasData ? fmtNum(m.total) : 'No data yet', null, !hasData),
    metric('Success Rate', hasData && m.successRate != null ? `${m.successRate}%` : 'No data yet', null, !(hasData && m.successRate != null)),
    metric('Median Latency', hasData && typeof m.medianLatencyMs === 'number' ? fmtMs(m.medianLatencyMs) : 'No data yet', null, !(hasData && typeof m.medianLatencyMs === 'number')),
    metric('TTFT', hasData && typeof m.medianTtftMs === 'number' ? fmtMs(m.medianTtftMs) : 'No data yet', null, !(hasData && typeof m.medianTtftMs === 'number')),
    metric('Est. Cost', 'Unknown', 'Not reported by provider', true),
  ]));
}

// helpers
function kv(label, value) {
  return h('span.row.gap-6', { style: 'align-items:baseline' }, [
    h('span.muted-3', { style: 'font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.04em' }, [label]),
    h('span', {}, [value]),
  ]);
}
function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const hr = Math.floor(m / 60); const mm = m % 60; if (hr < 24) return `${hr}h ${mm}m`;
  const d = Math.floor(hr / 24); return `${d}d ${hr % 24}h`;
}
function clearNode(el) { while (el.firstChild) el.removeChild(el.firstChild); }

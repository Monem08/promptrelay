// Requests — a privacy-first request inspector. Metadata only, never prompt bodies.
import { api } from '../api.js';
import {
  h, icon, btn, iconBtn, badge, statusDot, skeleton, toast, dialog, drawer, closeOverlay,
  emptyState, errorState, fmtVal, fmtBool, fmtMs, fmtTime, timeAgo, unknownSpan, UNKNOWN, copyText,
} from '../ui.js';

function statusCell(entry) {
  if (entry.status === UNKNOWN || entry.status === 'unknown' || entry.status == null) {
    return statusDot('gray', 'Unknown', { srPrefix: 'Status:' });
  }
  const tone = entry.ok ? 'green' : 'red';
  return h('span.row.gap-6', { style: 'align-items:center' }, [
    statusDot(tone, entry.ok ? 'Success' : 'Error', { srPrefix: 'Status:' }),
    h('span.mono', { style: 'font-size:var(--fs-xs)' }, [String(entry.status)]),
  ]);
}

function tokensShort(tokens) {
  if (!tokens || tokens === UNKNOWN || tokens === 'unknown') return unknownSpan();
  const total = tokens.total != null ? tokens.total : (tokens.input != null && tokens.output != null ? tokens.input + tokens.output : null);
  if (total == null) return unknownSpan();
  return h('span.mono', { style: 'font-size:var(--fs-xs)' }, [Number(total).toLocaleString()]);
}

function costShort(cost) {
  if (cost === UNKNOWN || cost === 'unknown' || cost == null) return unknownSpan();
  const n = Number(cost);
  if (!isFinite(n)) return unknownSpan();
  return h('span.mono', { style: 'font-size:var(--fs-xs)' }, [n === 0 ? '$0.00' : `$${n.toFixed(4)}`]);
}

export async function render(page, ctx) {
  const head = h('div.page-head', {}, [
    h('div', {}, [
      h('h1.page-title', {}, ['Requests']),
      h('div.page-sub', {}, ['Privacy-first inspector — metadata only, never prompt or response bodies']),
    ]),
    h('div.row.gap-8', {}, [
      btn('Refresh', { icon: 'refresh', sm: true, onClick: () => ctx.navigate('requests', true) }),
      btn('Clear', { icon: 'trash', variant: 'ghost', sm: true, onClick: () => confirmClear(ctx) }),
    ]),
  ]);
  page.appendChild(head);

  // Privacy banner
  page.appendChild(h('div.card.mb-16', { style: 'border-color:rgba(53,201,230,0.35);background:var(--cyan-dim)' }, [
    h('div.row.gap-8', { style: 'align-items:flex-start' }, [
      icon('shield'),
      h('div', {}, [
        h('div', { style: 'font-weight:600;color:var(--text-1)' }, ['Full prompt logging is OFF by default']),
        h('div.muted', { style: 'font-size:var(--fs-sm)' }, ['PromptRelay records request metadata (timing, tokens, routing) in memory only. Prompt and response contents are never stored or shown here.']),
      ]),
    ]),
  ]));

  const loading = h('div', {}, [skeleton('skeleton-line', 'width:25%'), skeleton('skeleton-card'), skeleton('skeleton-card')]);
  page.appendChild(loading);

  let data;
  try {
    data = await api.requests(200);
  } catch (e) {
    page.removeChild(loading);
    page.appendChild(errorState({ title: 'Could not load requests', message: e.message, onRetry: () => ctx.navigate('requests', true) }));
    return;
  }
  page.removeChild(loading);

  const rows = data.requests || [];
  if (!rows.length) {
    page.appendChild(emptyState({
      icon: 'inbox',
      title: 'No requests yet',
      text: 'Requests will appear here after clients use PromptRelay. Point OpenCode, Claude Code, or Hermes at the gateway to start recording metadata.',
    }));
    return;
  }

  page.appendChild(h('div.row.row-between.mb-12', {}, [
    h('span.muted', { style: 'font-size:var(--fs-sm)' }, [`${rows.length.toLocaleString()} recent request${rows.length === 1 ? '' : 's'} (newest first)`]),
    h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['In-memory ring buffer — cleared on gateway restart']),
  ]));

  // ---- desktop table ----
  const COLS = ['Time', 'Client', 'Provider', 'Model', 'Status', 'TTFT', 'Total', 'Reasoning', 'Tools', 'Tokens', 'Cost', 'Fallback'];
  const tbody = h('tbody');
  rows.forEach((r) => {
    const tr = h('tr', {
      tabindex: '0', role: 'button', 'aria-label': `Request ${r.id} details`,
      style: 'cursor:pointer',
      onclick: () => openDetails(r.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(r.id); } },
    }, [
      h('td', { title: fmtTime(r.time) }, [h('span.muted', { style: 'font-size:var(--fs-xs)' }, [timeAgo(r.time)])]),
      h('td', {}, [fmtVal(r.client)]),
      h('td', {}, [fmtVal(r.provider)]),
      h('td', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [r.model && r.model !== UNKNOWN ? r.model : '—'])]),
      h('td', {}, [statusCell(r)]),
      h('td', {}, [fmtMs(r.ttftMs)]),
      h('td', {}, [fmtMs(r.totalMs)]),
      h('td', {}, [r.reasoning && r.reasoning !== UNKNOWN ? badge(String(r.reasoning), 'violet') : unknownSpan()]),
      h('td', {}, [fmtBool(r.tools)]),
      h('td', {}, [tokensShort(r.tokens)]),
      h('td', {}, [costShort(r.cost)]),
      h('td', {}, [r.fallback ? badge('Yes', 'amber') : h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['No'])]),
    ]);
    tbody.appendChild(tr);
  });
  const table = h('div.table-wrap.only-desktop', { style: 'display:block' }, [
    h('div.table-scroll', {}, [
      h('table.data', {}, [
        h('thead', {}, [h('tr', {}, COLS.map((c) => h('th', {}, [c])))]),
        tbody,
      ]),
    ]),
  ]);
  page.appendChild(table);

  // ---- mobile cards ----
  const mobile = h('div.only-mobile.stack', { style: 'gap:10px' });
  rows.forEach((r) => {
    mobile.appendChild(h('div.card.card-hover', {
      tabindex: '0', role: 'button', style: 'cursor:pointer',
      onclick: () => openDetails(r.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(r.id); } },
    }, [
      h('div.row.row-between', {}, [
        h('span.mono', { style: 'font-size:var(--fs-xs)' }, [r.model && r.model !== UNKNOWN ? r.model : '—']),
        statusCell(r),
      ]),
      h('div.row.wrap.gap-8.mt-8', { style: 'font-size:var(--fs-xs)' }, [
        h('span.muted', {}, [fmtVal(r.client)]),
        h('span.muted-3', {}, ['·']),
        h('span.muted', {}, [fmtVal(r.provider)]),
        h('span.muted-3', {}, ['·']),
        h('span.muted', {}, [timeAgo(r.time)]),
      ]),
      h('div.row.wrap.gap-12.mt-8', { style: 'font-size:var(--fs-xs)' }, [
        h('span.muted-3', {}, ['TTFT ', fmtMs(r.ttftMs)]),
        h('span.muted-3', {}, ['Total ', fmtMs(r.totalMs)]),
        h('span.muted-3', {}, ['Tokens ', tokensShort(r.tokens)]),
        r.fallback ? badge('Fallback', 'amber') : h('span'),
      ]),
    ]));
  });
  page.appendChild(mobile);

  async function openDetails(id) {
    const body = h('div', {}, [skeleton('skeleton-line', 'width:60%'), skeleton('skeleton-line', 'width:40%')]);
    drawer({ title: 'Request details', subtitle: id, body });
    let d;
    try {
      d = await api.request(id);
    } catch (e) {
      while (body.firstChild) body.removeChild(body.firstChild);
      body.appendChild(errorState({ title: 'Could not load request', message: e.message }));
      return;
    }
    while (body.firstChild) body.removeChild(body.firstChild);

    const tokensNode = (() => {
      if (!d.tokens || d.tokens === UNKNOWN) return unknownSpan();
      const t = d.tokens;
      const parts = [];
      if (t.input != null) parts.push(`${Number(t.input).toLocaleString()} in`);
      if (t.output != null) parts.push(`${Number(t.output).toLocaleString()} out`);
      if (t.total != null) parts.push(`${Number(t.total).toLocaleString()} total`);
      return parts.length ? h('span.mono', { style: 'font-size:var(--fs-sm)' }, [parts.join(' · ')]) : unknownSpan();
    })();

    const dl = h('dl.dl', {}, [
      h('dt', {}, ['Request ID']), h('dd', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [d.id]), iconBtn('copy', { title: 'Copy ID', cls: 'sm', onClick: () => { copyText(d.id); toast('Request ID copied'); } })]),
      h('dt', {}, ['Time']), h('dd', {}, [fmtTime(d.time)]),
      h('dt', {}, ['Client']), h('dd', {}, [fmtVal(d.client)]),
      h('dt', {}, ['Ingress protocol']), h('dd', {}, [fmtVal(d.ingress)]),
      h('dt', {}, ['Selected provider']), h('dd', {}, [fmtVal(d.provider)]),
      h('dt', {}, ['Selected model']), h('dd', {}, [d.model && d.model !== UNKNOWN ? h('span.mono', { style: 'font-size:var(--fs-sm)' }, [d.model]) : unknownSpan()]),
      h('dt', {}, ['Routing profile']), h('dd', {}, [d.profile && d.profile !== UNKNOWN ? badge(d.profile, 'violet') : unknownSpan()]),
      h('dt', {}, ['Status']), h('dd', {}, [statusCell(d)]),
      h('dt', {}, ['Streaming']), h('dd', {}, [fmtBool(d.stream)]),
      h('dt', {}, ['Reasoning']), h('dd', {}, [d.reasoning && d.reasoning !== UNKNOWN ? badge(String(d.reasoning), 'violet') : unknownSpan()]),
      h('dt', {}, ['Tools']), h('dd', {}, [fmtBool(d.tools)]),
      h('dt', {}, ['TTFT']), h('dd', {}, [fmtMs(d.ttftMs)]),
      h('dt', {}, ['Total time']), h('dd', {}, [fmtMs(d.totalMs)]),
      h('dt', {}, ['Usage (tokens)']), h('dd', {}, [tokensNode]),
      h('dt', {}, ['Estimated cost']), h('dd', {}, [costShort(d.cost)]),
      h('dt', {}, ['Retry events']), h('dd', {}, [d.retries != null && d.retries !== UNKNOWN ? String(d.retries) : unknownSpan()]),
      h('dt', {}, ['Fallback events']), h('dd', {}, [d.fallback ? badge('Yes — fallback used', 'amber') : h('span.muted', {}, ['None'])]),
    ]);
    body.appendChild(dl);

    // Routing explanation (only what is recorded)
    body.appendChild(h('div.mt-16', {}, [
      h('div.section-title', {}, ['Routing explanation']),
      h('p.muted', { style: 'font-size:var(--fs-sm)' }, [
        d.profile && d.profile !== UNKNOWN
          ? `Routed under the “${d.profile}” profile. Per-request scoring detail is not retained in the metadata buffer.`
          : 'Routing profile was not recorded for this request.',
      ]),
    ]));

    // Error details
    body.appendChild(h('div.mt-16', {}, [
      h('div.section-title', {}, ['Error details']),
      d.error
        ? h('pre.mono', { style: 'white-space:pre-wrap;word-break:break-word;background:var(--bg-sunken);padding:12px;border-radius:var(--r-md);font-size:var(--fs-xs);color:var(--red)' }, [String(d.error)])
        : h('p.muted', { style: 'font-size:var(--fs-sm)' }, ['No error recorded for this request.']),
    ]));
  }
}

function confirmClear(ctx) {
  dialog({
    title: 'Clear request history?', icon: 'trash',
    body: h('p.muted', {}, ['This removes all recorded request metadata from the in-memory buffer. It does not affect the gateway or clients. This cannot be undone.']),
    footer: h('div.row.gap-8', {}, [
      btn('Cancel', { onClick: () => closeOverlay() }),
      btn('Clear history', { variant: 'danger', icon: 'trash', onClick: async () => {
        try { await api.clearRequests(); closeOverlay(); toast('Request history cleared'); ctx.navigate('requests', true); }
        catch (e) { toast('Could not clear history', { type: 'error', message: e.message }); }
      } }),
    ]),
  });
}

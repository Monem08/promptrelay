// PromptRelay Dashboard — UI primitives & helpers
// A tiny hyperscript + reusable component library. No framework.

/** Hyperscript element builder. h('div.card', {onclick}, [children]) */
export function h(tag, props = {}, children = []) {
  let el;
  const parts = String(tag).split(/(?=[.#])/);
  const tagName = parts[0].match(/^[a-z0-9]+/i) ? parts[0].replace(/[.#].*/, '') : 'div';
  el = document.createElement(tagName || 'div');
  for (const p of parts.slice(parts[0].match(/^[.#]/) ? 0 : 1)) {
    if (p.startsWith('.')) el.classList.add(p.slice(1));
    else if (p.startsWith('#')) el.id = p.slice(1);
  }
  if (props && typeof props === 'object' && !Array.isArray(props) && !(props instanceof Node)) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && k !== 'type') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
      else el.setAttribute(k, v);
    }
  } else {
    children = props;
  }
  append(el, children);
  return el;
}

function append(el, children) {
  if (children == null) return;
  if (Array.isArray(children)) children.forEach((c) => append(el, c));
  else if (children instanceof Node) el.appendChild(children);
  else el.appendChild(document.createTextNode(String(children)));
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

/** SVG icon set (feather-style, 24x24 stroke). */
const ICONS = {
  zap: 'M13 2 3 14h7l-1 8 10-12h-7z',
  overview: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z',
  clients: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  providers: 'M22 12h-4l-3 9L9 3l-3 9H2',
  models: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96 12 12.01l8.73-5.05M12 22.08V12',
  router: 'M6 3v12M18 9v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 9a9 9 0 0 1-9 9',
  prompts: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  requests: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  diagnostics: 'M22 12h-4l-3 9L9 3l-3 9H2',
  metrics: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
  settings: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  menu: 'M3 12h18M3 6h18M3 18h18',
  close: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  x: 'M18 6 6 18M6 6l12 12',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15',
  arrowDown: 'M12 5v14M19 12l-7 7-7-7',
  arrowRight: 'M5 12h14M12 5l7 7-7 7',
  play: 'M5 3l14 9-14 9z',
  doctor: 'M8 2v4M16 2v4M3 10h18M12 14v4M10 16h4M5 22h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2z',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M15 9h0M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  chevron: 'm9 18 6-6-6-6',
  copy: 'M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  box: 'M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
};

export function icon(name, cls = '') {
  const path = ICONS[name] || ICONS.box;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (cls) svg.setAttribute('class', cls);
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.appendChild(p);
  return svg;
}

// ---- Components ----
export function btn(label, { variant = '', icon: ic, onClick, sm, disabled, title, block } = {}) {
  const cls = ['btn', variant ? `btn-${variant}` : '', sm ? 'btn-sm' : '', block ? 'btn-block' : ''].filter(Boolean).join(' ');
  const el = h('button', { class: cls, onclick: onClick, disabled, title, type: 'button' }, [ic ? icon(ic) : null, label]);
  return el;
}

export function iconBtn(name, { onClick, title, cls = '' } = {}) {
  return h('button', { class: `icon-btn ${cls}`, onclick: onClick, title, 'aria-label': title, type: 'button' }, [icon(name)]);
}

export function badge(text, tone = 'gray') {
  return h(`span.badge.badge-${tone}`, {}, [text]);
}

/** Status pill with dot + text (never color-only). tone: green/amber/red/blue/gray */
export function statusDot(tone, label, { srPrefix = 'Status: ' } = {}) {
  return h('span.row.gap-6', { style: 'align-items:center' }, [
    h(`span.dot.dot-${tone}`, { 'aria-hidden': 'true' }),
    h('span.sr-only', {}, [srPrefix]),
    h('span', { style: 'font-size:var(--fs-sm)' }, [label]),
  ]);
}

export function skeleton(cls = 'skeleton-line', style = '') {
  return h(`div.skeleton.${cls}`, { style });
}

export function skeletonCards(n = 4) {
  return h('div.grid.grid-cards', {}, Array.from({ length: n }, () => h('div.skeleton.skeleton-card')));
}

export function emptyState({ icon: ic = 'inbox', title, text, action }) {
  return h('div.empty', {}, [
    h('div.empty-icon', {}, [icon(ic)]),
    h('div.empty-title', {}, [title]),
    text ? h('div.empty-text', {}, [text]) : null,
    action || null,
  ]);
}

export function errorState({ title = 'Something went wrong', message, detail, onRetry, action }) {
  const details = detail ? h('details', { style: 'margin-top:8px;width:100%;max-width:520px' }, [
    h('summary', { style: 'cursor:pointer;color:var(--text-2);font-size:var(--fs-sm)' }, ['Technical details']),
    h('pre.mono', { style: 'white-space:pre-wrap;word-break:break-word;font-size:var(--fs-xs);color:var(--text-3);margin-top:6px' }, [detail]),
  ]) : null;
  return h('div.errorstate', {}, [
    h('div.empty-icon', { style: 'background:var(--red-dim);color:var(--red)' }, [icon('alert')]),
    h('div.empty-title', {}, [title]),
    message ? h('div.empty-text', {}, [message]) : null,
    details,
    h('div.row.gap-8.mt-12', {}, [
      onRetry ? btn('Retry', { variant: 'primary', icon: 'refresh', onClick: onRetry }) : null,
      action || null,
    ]),
  ]);
}

// ---- Toast ----
export function toast(title, { message, type = 'default', timeout = 4000 } = {}) {
  const root = document.getElementById('toast-root');
  const el = h(`div.toast.${type}`, { role: 'status' }, [
    h('div.toast-body', {}, [
      h('div.toast-title', {}, [title]),
      message ? h('div.toast-msg', {}, [message]) : null,
    ]),
    iconBtn('close', { title: 'Dismiss', onClick: () => remove() }),
  ]);
  root.appendChild(el);
  const remove = () => { el.style.opacity = '0'; el.style.transform = 'translateX(20px)'; setTimeout(() => el.remove(), 200); };
  if (timeout) setTimeout(remove, timeout);
  return remove;
}

// ---- Overlay-based Drawer / Dialog / Command palette ----
let activeOverlay = null;

export function openOverlay(node, { onClose } = {}) {
  closeOverlay();
  const root = document.getElementById('overlay-root');
  const scrim = h('div.overlay', { onclick: () => closeOverlay() });
  root.appendChild(scrim);
  root.appendChild(node);
  const onKey = (e) => { if (e.key === 'Escape') closeOverlay(); };
  document.addEventListener('keydown', onKey);
  activeOverlay = { nodes: [scrim, node], onKey, onClose };
  // focus first focusable
  setTimeout(() => {
    const f = node.querySelector('input,button,textarea,select,[tabindex]');
    if (f) f.focus();
  }, 30);
  return closeOverlay;
}

export function closeOverlay() {
  if (!activeOverlay) return;
  document.removeEventListener('keydown', activeOverlay.onKey);
  activeOverlay.nodes.forEach((n) => n.remove());
  if (activeOverlay.onClose) activeOverlay.onClose();
  activeOverlay = null;
}

export function drawer({ title, body, footer, subtitle }) {
  const node = h('div.drawer', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('div.drawer-head', {}, [
      h('div.stack', { style: 'flex:1;min-width:0' }, [
        h('div.card-title.truncate', {}, [title]),
        subtitle ? h('div.card-sub.truncate', {}, [subtitle]) : null,
      ]),
      iconBtn('close', { title: 'Close', onClick: () => closeOverlay() }),
    ]),
    h('div.drawer-body', {}, [body]),
    footer ? h('div.drawer-foot', {}, [footer]) : null,
  ]);
  return openOverlay(node);
}

export function dialog({ title, body, footer, icon: ic }) {
  const node = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
    h('div.dialog-head', {}, [
      ic ? h('div.brand-mark', { style: 'background:var(--surface-3);color:var(--violet-2);box-shadow:none' }, [icon(ic)]) : null,
      h('div.card-title', { style: 'flex:1' }, [title]),
      iconBtn('close', { title: 'Close', onClick: () => closeOverlay() }),
    ]),
    h('div.dialog-body', {}, [body]),
    footer ? h('div.dialog-foot', {}, [footer]) : null,
  ]);
  return openOverlay(node);
}

// ---- formatting helpers ----
export const UNKNOWN = 'Unknown';

export function fmtVal(v, { unit = '', mono = false } = {}) {
  if (v === 'unknown' || v == null || v === '') return unknownSpan();
  const s = unit ? `${v}${unit}` : String(v);
  return mono ? h('span.mono', {}, [s]) : document.createTextNode(s);
}

export function unknownSpan() { return h('span.muted-3', { title: 'No data / not reported' }, [UNKNOWN]); }

export function fmtBool(v) {
  if (v === true) return badge('Yes', 'green');
  if (v === false) return badge('No', 'gray');
  return badge('Unknown', 'gray');
}

export function fmtNum(v) {
  if (typeof v !== 'number') return UNKNOWN;
  return v.toLocaleString();
}

export function fmtMs(v) {
  if (typeof v !== 'number') return UNKNOWN;
  return v < 1000 ? `${v}ms` : `${(v / 1000).toFixed(2)}s`;
}

export function fmtTime(iso) {
  if (!iso) return UNKNOWN;
  const d = new Date(iso);
  if (isNaN(d)) return UNKNOWN;
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function timeAgo(iso) {
  if (!iso) return UNKNOWN;
  const diff = Date.now() - new Date(iso).getTime();
  if (isNaN(diff)) return UNKNOWN;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const hr = Math.floor(m / 60); if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/** Map a health object to a {tone,label}. Distinguishes unknown (gray) from error (red). */
export function healthTone(h) {
  if (!h) return { tone: 'gray', label: 'Unknown' };
  if (h.ok === true) return { tone: 'green', label: 'Healthy' };
  if (h.ok === false) return { tone: 'red', label: 'Error' };
  return { tone: 'gray', label: 'Unknown' };
}

export function copyText(text, label = 'Copied') {
  navigator.clipboard?.writeText(text).then(() => toast(label, { type: 'success', timeout: 1500 })).catch(() => {});
}

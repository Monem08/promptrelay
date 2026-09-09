// PromptRelay Dashboard — application shell, router & command palette.
// Vanilla ES modules. No framework, no build step. Served static by Express.

import { api, ApiError, clearCache } from './api.js';
import { h, clear, icon, iconBtn, btn, statusDot, toast, openOverlay, closeOverlay, errorState } from './ui.js';

import * as overview from './pages/overview.js';
import * as clients from './pages/clients.js';
import * as providers from './pages/providers.js';
import * as modelsPage from './pages/models.js';
import * as routerPage from './pages/router.js';
import * as prompts from './pages/prompts.js';
import * as requests from './pages/requests.js';
import * as diagnostics from './pages/diagnostics.js';
import * as metrics from './pages/metrics.js';
import * as settings from './pages/settings.js';

// ---- route table ----
const ROUTES = [
  { id: 'overview',    label: 'Overview',    icon: 'overview',    mod: overview },
  { id: 'clients',     label: 'Clients',     icon: 'clients',     mod: clients },
  { id: 'providers',   label: 'Providers',   icon: 'providers',   mod: providers },
  { id: 'models',      label: 'Models',      icon: 'models',      mod: modelsPage },
  { id: 'router',      label: 'Router',      icon: 'router',      mod: routerPage },
  { id: 'prompts',     label: 'Prompt Studio', icon: 'prompts',   mod: prompts },
  { id: 'requests',    label: 'Requests',    icon: 'requests',    mod: requests },
  { id: 'diagnostics', label: 'Diagnostics', icon: 'diagnostics', mod: diagnostics },
  { id: 'metrics',     label: 'Metrics',     icon: 'metrics',     mod: metrics },
  { id: 'settings',    label: 'Settings',    icon: 'settings',    mod: settings },
];
// Pages shown on the mobile bottom nav (space is limited).
const MOBILE_ROUTES = ['overview', 'clients', 'models', 'router', 'diagnostics'];

const routeById = (id) => ROUTES.find((r) => r.id === id) || ROUTES[0];

// ---- shell state ----
const state = {
  collapsed: localStorage.getItem('pr.sidebar.collapsed') === 'true',
  mobileNav: false,
  current: null,
};

// Shared context passed to every page render().
const ctx = {
  api,
  navigate,
  refreshHealth,
  openCommandPalette,
  routes: ROUTES,
};

let appEl, mainEl, healthPillEl, navEl, mobileNavEl;

function build() {
  const root = document.getElementById('app');
  clear(root);

  appEl = h('div.app', { dataset: { collapsed: String(state.collapsed) } });

  // ----- Sidebar -----
  navEl = h('nav.nav', { 'aria-label': 'Primary' });
  const sidebar = h('aside.sidebar', {}, [
    h('div.sidebar-brand', {}, [
      h('div.brand-mark', {}, [icon('zap')]),
      h('span.brand-name', {}, ['PromptRelay']),
    ]),
    navEl,
    h('div.nav-footer', {}, [
      h('span.ver-text', { id: 'ver-text' }, ['Dashboard']),
    ]),
  ]);

  // ----- Topbar -----
  const menuBtn = iconBtn('menu', { title: 'Toggle navigation', cls: 'only-mobile', onClick: toggleMobileNav });
  const collapseBtn = iconBtn('chevron', { title: 'Collapse sidebar', cls: 'only-desktop', onClick: toggleCollapsed });
  const search = h('button.topbar-search', { onclick: openCommandPalette, 'aria-label': 'Open command palette' }, [
    icon('search'),
    h('span.search-text', {}, ['Search or run a command']),
    h('span.kbd', {}, ['⌘K']),
  ]);
  healthPillEl = h('div.health-pill', { id: 'health-pill', title: 'Gateway status' }, [
    h('span.dot.dot-gray', { 'aria-hidden': 'true' }),
    h('span.health-text', {}, ['Checking…']),
  ]);
  const topbar = h('header.topbar', {}, [
    menuBtn, collapseBtn, search,
    h('div.topbar-spacer'),
    healthPillEl,
    iconBtn('refresh', { title: 'Refresh', onClick: () => { clearCache(); navigate(state.current, true); refreshHealth(); } }),
  ]);

  // ----- Main -----
  mainEl = h('main.main', { id: 'main', tabindex: '-1' });

  // ----- Mobile bottom nav -----
  mobileNavEl = h('nav.mobile-nav', { 'aria-label': 'Primary mobile' });

  const scrim = h('div.mobile-scrim', { onclick: () => toggleMobileNav(false) });

  appEl.append(sidebar, topbar, mainEl, scrim);
  root.append(appEl, mobileNavEl);

  renderNav();
  applyCollapseTitles(collapseBtn);
}

function applyCollapseTitles(btnEl) {
  // update collapse chevron rotation via title only; CSS handles look
  btnEl.style.transform = state.collapsed ? 'rotate(0deg)' : 'rotate(180deg)';
}

function renderNav() {
  clear(navEl);
  clear(mobileNavEl);
  for (const r of ROUTES) {
    const active = r.id === state.current;
    navEl.appendChild(h('button.nav-item', {
      class: active ? 'active' : '', onclick: () => navigate(r.id),
      'aria-current': active ? 'page' : null, title: r.label,
    }, [icon(r.icon), h('span.nav-label', {}, [r.label])]));
  }
  for (const id of MOBILE_ROUTES) {
    const r = routeById(id);
    const active = r.id === state.current;
    mobileNavEl.appendChild(h('button.mobile-nav-item', {
      class: active ? 'active' : '', onclick: () => navigate(r.id),
      'aria-current': active ? 'page' : null,
    }, [icon(r.icon), h('span', {}, [r.label])]));
  }
}

function toggleCollapsed() {
  state.collapsed = !state.collapsed;
  localStorage.setItem('pr.sidebar.collapsed', String(state.collapsed));
  appEl.dataset.collapsed = String(state.collapsed);
}

function toggleMobileNav(force) {
  state.mobileNav = typeof force === 'boolean' ? force : !state.mobileNav;
  appEl.dataset.mobileNav = String(state.mobileNav);
}

// ---- routing ----
async function navigate(id, forceReload = false) {
  const route = routeById(id || (location.hash || '').replace(/^#\/?/, '') || 'overview');
  if (location.hash !== `#/${route.id}`) {
    history.replaceState(null, '', `#/${route.id}`);
  }
  const changed = state.current !== route.id;
  state.current = route.id;
  toggleMobileNav(false);
  renderNav();
  document.title = `${route.label} · PromptRelay`;
  if (!changed && !forceReload) return;

  clear(mainEl);
  const page = h('div.page');
  mainEl.appendChild(page);
  mainEl.scrollTop = 0;
  try {
    await route.mod.render(page, ctx);
  } catch (err) {
    clear(page);
    const detail = err instanceof ApiError ? (err.detail || err.message) : (err && err.stack) || String(err);
    page.appendChild(errorState({
      title: 'This page failed to load',
      message: err instanceof ApiError ? err.message : 'An unexpected error occurred while rendering this page.',
      detail,
      onRetry: () => navigate(route.id, true),
    }));
  }
}

// ---- health pill ----
export async function refreshHealth() {
  try {
    const s = await api.status();
    const tone = s.status === 'ok' ? (s.problems && s.problems.length ? 'amber' : 'green') : 'red';
    const label = tone === 'green' ? 'Healthy' : tone === 'amber' ? 'Degraded' : 'Attention';
    clear(healthPillEl);
    healthPillEl.append(
      h(`span.dot.dot-${tone}`, { 'aria-hidden': 'true' }),
      h('span.sr-only', {}, ['Gateway status: ']),
      h('span.health-text', {}, [label]),
    );
    healthPillEl.title = `Gateway ${label} · ${s.gatewayURL || ''}`;
  } catch {
    clear(healthPillEl);
    healthPillEl.append(
      h('span.dot.dot-gray', { 'aria-hidden': 'true' }),
      h('span.sr-only', {}, ['Gateway status: ']),
      h('span.health-text', {}, ['Offline']),
    );
  }
}

// ---- command palette ----
const COMMANDS = [
  { label: 'Go to Overview',       icon: 'overview',    run: () => navigate('overview') },
  { label: 'Add Provider',         icon: 'plus',        run: () => { navigate('providers'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:add-provider')), 60); } },
  { label: 'Switch Provider',      icon: 'providers',   run: () => navigate('providers') },
  { label: 'Switch Model',         icon: 'models',      run: () => navigate('models') },
  { label: 'Detect Clients',       icon: 'clients',     run: () => { navigate('clients'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:detect-clients')), 60); } },
  { label: 'Run Doctor (Diagnostics)', icon: 'doctor',  run: () => { navigate('diagnostics'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:run-diagnostics')), 60); } },
  { label: 'Run Autopilot',        icon: 'wand',        run: () => { navigate('diagnostics'); setTimeout(() => window.dispatchEvent(new CustomEvent('pr:run-autopilot')), 60); } },
  { label: 'Edit Prompt',          icon: 'edit',        run: () => navigate('prompts') },
  { label: 'Refresh Models',       icon: 'refresh',     run: async () => { toast('Refreshing models…'); try { await api.refreshModels(); clearCache(); toast('Models refreshed', { type: 'success' }); if (state.current === 'models') navigate('models', true); } catch (e) { toast('Refresh failed', { type: 'error', message: e.message }); } } },
  { label: 'Open Router',          icon: 'router',      run: () => navigate('router') },
  { label: 'Open Metrics',         icon: 'metrics',     run: () => navigate('metrics') },
  { label: 'Open Settings',        icon: 'settings',    run: () => navigate('settings') },
  { label: 'Configure OpenCode',   icon: 'clients',     run: () => navigate('clients') },
  { label: 'Configure Claude Code',icon: 'clients',     run: () => navigate('clients') },
  { label: 'Configure Hermes',     icon: 'clients',     run: () => navigate('clients') },
];

export function openCommandPalette() {
  let items = COMMANDS.slice();
  let sel = 0;

  const listEl = h('div.cmdk-list', { role: 'listbox' });
  const input = h('input.cmdk-input', {
    type: 'text', placeholder: 'Type a command…', 'aria-label': 'Command palette',
    autocomplete: 'off', spellcheck: false,
  });
  const node = h('div.cmdk', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Command palette' }, [input, listEl]);

  function renderList() {
    clear(listEl);
    if (!items.length) { listEl.appendChild(h('div.cmdk-empty', {}, ['No matching commands'])); return; }
    items.forEach((cmd, i) => {
      listEl.appendChild(h('div.cmdk-item', {
        class: i === sel ? 'active' : '', role: 'option', 'aria-selected': i === sel,
        onmousemove: () => { if (sel !== i) { sel = i; renderList(); } },
        onclick: () => choose(i),
      }, [icon(cmd.icon), h('span', { style: 'flex:1' }, [cmd.label])]));
    });
  }
  function choose(i) { const c = items[i]; closeOverlay(); if (c) c.run(); }
  function filter(q) {
    const s = q.trim().toLowerCase();
    items = s ? COMMANDS.filter((c) => c.label.toLowerCase().includes(s)) : COMMANDS.slice();
    sel = 0; renderList();
  }
  input.addEventListener('input', () => filter(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, items.length - 1); renderList(); scrollSel(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); renderList(); scrollSel(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
  });
  function scrollSel() { const el = listEl.children[sel]; if (el) el.scrollIntoView({ block: 'nearest' }); }

  renderList();
  openOverlay(node);
}

// ---- global keyboard ----
function onGlobalKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openCommandPalette(); }
}

// ---- boot ----
function boot() {
  build();
  window.addEventListener('hashchange', () => navigate());
  window.addEventListener('keydown', onGlobalKey);
  navigate();
  refreshHealth();
  // light periodic health poll (isolated from hot path; status endpoint is cheap)
  setInterval(refreshHealth, 15000);
}

document.addEventListener('DOMContentLoaded', boot);

// Providers — provider cards + the Add Provider wizard.
import { api, clearCache } from '../api.js';
import {
  h, icon, btn, iconBtn, badge, statusDot, skeletonCards, toast, emptyState,
  openOverlay, closeOverlay, fmtMs, fmtTime, timeAgo, healthTone,
} from '../ui.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- provider cards ----------
function providerCard(p, ctx) {
  const ht = healthTone(p.health);
  const cred = p.credentialStatus;
  const credBadge = cred === 'configured' ? badge('Key configured', 'green')
    : cred === 'missing' ? badge('Key missing', 'red')
    : cred === 'not-required' ? badge('No key needed', 'gray')
    : badge('Via env', 'blue');
  return h('div.card', {}, [
    h('div.row-between.mb-12', {}, [
      h('div.row.gap-12', { style: 'min-width:0' }, [
        h('div.brand-mark', { style: 'background:var(--surface-3);color:var(--cyan);box-shadow:none' }, [icon('providers')]),
        h('div', { style: 'min-width:0' }, [
          h('div.card-title.row.gap-8', {}, [p.name, p.active ? badge('Active', 'violet') : null]),
          h('div.card-sub', {}, [p.transport === 'anthropic' ? 'Anthropic protocol' : p.transport === 'openai' ? 'OpenAI-compatible' : p.transport]),
        ]),
      ]),
      statusDot(ht.tone, ht.label),
    ]),
    h('dl.dl', {}, [
      h('dt', {}, ['Base URL']), h('dd', {}, [h('span.mono.truncate', { title: p.baseURL, style: 'display:inline-block;max-width:100%' }, [p.baseURL || 'Unknown'])]),
      h('dt', {}, ['Model']), h('dd', {}, [h('span.mono', {}, [p.model || 'Unknown'])]),
      h('dt', {}, ['Credentials']), h('dd', {}, [credBadge]),
      h('dt', {}, ['Models']), h('dd', {}, [p.modelCount === 'unknown' || p.modelCount == null ? unknown() : String(p.modelCount)]),
      h('dt', {}, ['Latency']), h('dd', {}, [p.health && typeof p.health.latencyMs === 'number' ? fmtMs(p.health.latencyMs) : unknown()]),
      h('dt', {}, ['Last check']), h('dd', {}, [p.health && p.health.checkedAt ? timeAgo(p.health.checkedAt) : unknown()]),
    ]),
    h('div.row.wrap.gap-8.mt-16', {}, [
      !p.active ? btn('Use', { sm: true, variant: 'primary', icon: 'power', onClick: () => useProvider(p, ctx) }) : null,
      btn('Models', { sm: true, icon: 'models', onClick: () => ctx.navigate('models') }),
      btn('Test', { sm: true, icon: 'check', onClick: () => testProvider(p) }),
    ]),
  ]);
}

function unknown() { return h('span.muted-3', { title: 'No data / not reported' }, ['Unknown']); }

async function useProvider(p, ctx) {
  if (p.id === '(inline)') { toast('This is the active inline provider'); return; }
  try {
    await api.useProvider(p.id);
    clearCache();
    toast(`Switched to ${p.name}`, { type: 'success' });
    ctx.navigate('providers', true);
    ctx.refreshHealth();
  } catch (e) { toast('Could not switch provider', { type: 'error', message: e.message }); }
}

async function testProvider(p) {
  toast(`Testing ${p.name} (safe check)…`);
  try {
    const r = await api.testProvider({ name: p.id === '(inline)' ? undefined : p.id, live: false });
    if (r.ok) toast(`${p.name} reachable`, { type: 'success', message: r.latencyMs != null ? `${r.latencyMs}ms` : null });
    else toast(`${p.name} check failed`, { type: 'error', message: r.error || `status ${r.status}` });
  } catch (e) { toast('Test failed', { type: 'error', message: e.message }); }
}

// ---------- Add Provider wizard ----------
const STEP_LABELS = ['Provider', 'Credentials', 'Discovery', 'Models', 'Recommend', 'Test', 'Finish'];

function openWizard(presets, ctx) {
  const wiz = {
    step: 0,
    preset: null,          // preset object {id,label,transport,needsKey}
    name: '',
    apiKey: '',
    baseURL: '',
    saved: null,           // response from addProvider
    discovery: [],
    modelResult: null,     // {models, source, error}
    recommendation: null,
    testResult: null,
  };

  const bodyEl = h('div.dialog-body', { style: 'min-height:260px' });
  const footEl = h('div.dialog-foot');
  const stepperEl = h('div.stepper');
  const node = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add provider', style: 'width:min(640px,calc(100vw - 32px))' }, [
    h('div.dialog-head', {}, [
      h('div.brand-mark', { style: 'background:var(--surface-3);color:var(--violet-2);box-shadow:none' }, [icon('plus')]),
      h('div.card-title', { style: 'flex:1' }, ['Add Provider']),
      iconBtn('close', { title: 'Close', onClick: () => closeOverlay() }),
    ]),
    stepperEl, bodyEl, footEl,
  ]);

  function renderStepper() {
    while (stepperEl.firstChild) stepperEl.removeChild(stepperEl.firstChild);
    STEP_LABELS.forEach((label, i) => {
      if (i) stepperEl.appendChild(h('div.stepper-sep'));
      const cls = i === wiz.step ? 'active' : i < wiz.step ? 'done' : '';
      stepperEl.appendChild(h(`div.stepper-dot.${cls}`, {}, [
        h('div.stepper-num', {}, [i < wiz.step ? icon('check') : String(i + 1)]),
        h('span.stepper-label', {}, [label]),
      ]));
    });
  }

  function setFoot(buttons) {
    while (footEl.firstChild) footEl.removeChild(footEl.firstChild);
    buttons.filter(Boolean).forEach((b) => footEl.appendChild(b));
  }
  function setBody(node2) { while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild); bodyEl.appendChild(node2); }

  function go(step) { wiz.step = step; render(); }

  function render() {
    renderStepper();
    if (wiz.step === 0) renderChoose();
    else if (wiz.step === 1) renderCreds();
    else if (wiz.step === 2) renderDiscovery();
    else if (wiz.step === 3) renderModels();
    else if (wiz.step === 4) renderRecommend();
    else if (wiz.step === 5) renderTest();
    else renderFinish();
  }

  // Step 1
  function renderChoose() {
    const options = [
      ...presets.map((p) => ({ ...p, custom: false })),
    ];
    // ensure a generic custom entry exists
    if (!options.some((o) => /custom/i.test(o.id))) options.push({ id: 'custom-openai', label: 'Custom Provider', transport: 'openai', needsKey: true, custom: true });
    const grid = h('div.choice-grid', {}, options.map((o) => h('button.choice', {
      class: wiz.preset && wiz.preset.id === o.id ? 'selected' : '',
      onclick: () => { wiz.preset = o; wiz.name = wiz.name || defaultName(o); render(); },
    }, [
      h('div.choice-title', {}, [o.label]),
      h('div.choice-sub', {}, [o.transport === 'anthropic' ? 'Anthropic protocol' : 'OpenAI-compatible', o.needsKey ? ' · API key' : ' · no key']),
    ])));
    setBody(h('div', {}, [h('p.muted.mb-12', {}, ['Choose a provider to connect. You can add more later.']), grid]));
    setFoot([
      btn('Cancel', { variant: 'ghost', onClick: () => closeOverlay() }),
      btn('Continue', { variant: 'primary', icon: 'arrowRight', disabled: !wiz.preset, onClick: () => go(1) }),
    ]);
  }

  // Step 2
  function renderCreds() {
    const p = wiz.preset;
    const needsBase = /ollama-local|custom/i.test(p.id) || p.transport === 'ollama';
    const nameInput = h('input.input', { type: 'text', value: wiz.name, placeholder: 'my-provider', oninput: (e) => { wiz.name = e.target.value; } });
    const keyInput = h('input.input.mono', { type: 'password', value: wiz.apiKey, placeholder: 'sk-…', autocomplete: 'off', oninput: (e) => { wiz.apiKey = e.target.value; } });
    const baseInput = h('input.input.mono', { type: 'text', value: wiz.baseURL, placeholder: defaultBase(p), oninput: (e) => { wiz.baseURL = e.target.value; } });
    setBody(h('div', {}, [
      field('Profile name', nameInput, 'A short identifier for this provider profile.'),
      p.needsKey ? field('API key', keyInput, 'Stored only in the gateway\u2019s .env file (chmod 600). Never written to config and never shown again.') : h('div.card.muted', { style: 'font-size:var(--fs-sm)' }, ['This provider does not require an API key.']),
      needsBase ? field('Base URL', baseInput, 'Leave blank to use the default.') : null,
    ]));
    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(0) }),
      btn('Connect', { variant: 'primary', icon: 'arrowRight', disabled: !wiz.name.trim() || (p.needsKey && !wiz.apiKey.trim()), onClick: () => go(2) }),
    ]);
  }

  // Step 3 — discovery (saves provider + safe checks; activates to enable real discovery)
  async function renderDiscovery() {
    const rows = [
      'Base URL normalized', 'Authentication', 'Protocol detected', 'Models discovered', 'Metadata loaded',
    ].map((label) => h('div.tl-step.tl-running', {}, [h('div.tl-mark.tl-pending', {}, [icon('refresh')]), h('span', {}, [label]), h('span.tl-detail', {})]));
    setBody(h('div.timeline', {}, rows));
    setFoot([btn('Cancel', { variant: 'ghost', onClick: () => closeOverlay() })]);

    const setRow = (i, status, detail) => {
      const row = rows[i]; row.classList.remove('tl-running');
      const mark = row.querySelector('.tl-mark');
      mark.className = `tl-mark tl-${status}`;
      while (mark.firstChild) mark.removeChild(mark.firstChild);
      mark.appendChild(icon(status === 'ok' ? 'check' : status === 'attention' ? 'alert' : 'close'));
      if (detail != null) row.querySelector('.tl-detail').textContent = detail;
    };

    try {
      // 1. Save provider profile + key (key → .env only)
      const payload = { name: wiz.name.trim(), preset: wiz.preset.custom ? undefined : wiz.preset.id };
      const provBlock = {};
      if (wiz.preset.custom) { provBlock.transport = wiz.preset.transport; }
      if (wiz.baseURL.trim()) provBlock.baseURL = wiz.baseURL.trim();
      if (Object.keys(provBlock).length) payload.provider = provBlock;
      if (wiz.apiKey.trim()) payload.apiKey = wiz.apiKey.trim();
      wiz.saved = await api.addProvider(payload);
      await sleep(280); setRow(0, 'ok', wiz.baseURL.trim() || defaultBase(wiz.preset));

      // 2. Activate so discovery reflects THIS provider, then safe auth check
      await api.useProvider(wiz.name.trim());
      clearCache();
      await sleep(220);
      const test = await api.testProvider({ live: false }).catch((e) => ({ ok: false, error: e.message }));
      wiz.testResult = test;
      setRow(1, test.ok ? 'ok' : 'attention', test.ok ? 'Verified' : (wiz.preset.needsKey ? 'Set key to verify' : 'Skipped'));
      await sleep(220);
      setRow(2, 'ok', wiz.preset.transport === 'anthropic' ? 'Anthropic' : 'OpenAI');

      // 3. Discover models (real, no fabrication)
      const models = await api.refreshModels().catch((e) => ({ models: [], error: e.message }));
      wiz.modelResult = models;
      const count = (models.models || []).length;
      setRow(3, count ? 'ok' : 'attention', count ? `${count} models` : (models.error ? 'Failed' : 'None'));
      await sleep(200);
      setRow(4, count ? 'ok' : 'attention', models.source || (models.error ? models.error.slice(0, 40) : 'Unknown'));

      setFoot([btn('Back', { variant: 'ghost', onClick: () => go(1) }), btn('Continue', { variant: 'primary', icon: 'arrowRight', onClick: () => go(3) })]);
    } catch (e) {
      setRow(0, 'attention', 'Failed');
      setBody(h('div.errorstate', { style: 'border:none;background:none;padding:16px 0' }, [
        h('div.empty-title', {}, ['Could not add provider']),
        h('div.empty-text', {}, [e.message]),
      ]));
      setFoot([btn('Back', { variant: 'ghost', onClick: () => go(1) })]);
    }
  }

  // Step 4 — models
  function renderModels() {
    const count = (wiz.modelResult?.models || []).length;
    setBody(h('div', {}, [
      h('div.metric', { style: 'max-width:220px' }, [
        h('div.metric-label', {}, ['Models discovered']),
        h(`div.metric-value${count ? '' : '.unknown'}`, {}, [count ? String(count) : 'None yet']),
        h('div.metric-foot', {}, [wiz.modelResult?.source ? `Source: ${wiz.modelResult.source}` : 'No metadata']),
      ]),
      count ? h('p.muted.mt-16', {}, [`${wiz.name} is connected and its catalog is cached. Browse and filter everything on the Models page.`])
            : h('p.muted.mt-16', {}, ['No models were discovered. Check the base URL and key, or the provider may expose no model list.']),
    ]));
    setFoot([btn('Back', { variant: 'ghost', onClick: () => go(2) }), btn('Continue', { variant: 'primary', icon: 'arrowRight', onClick: () => go(4) })]);
  }

  // Step 5 — recommendation (real ranking via router endpoint, profile=coding)
  async function renderRecommend() {
    setBody(h('div.row.gap-8', {}, [h('div.skeleton.skeleton-line', { style: 'width:60%' })]));
    setFoot([btn('Back', { variant: 'ghost', onClick: () => go(3) })]);
    let rec = null;
    try { const r = await api.router('coding'); rec = r.recommendation; wiz.recommendation = rec; } catch {}
    if (!rec || !rec.model) {
      setBody(h('div.card.muted', {}, ['No recommendation available yet — this needs discovered model metadata.']));
    } else {
      setBody(h('div.card', {}, [
        h('div.row-between.mb-8', {}, [h('div.card-title.mono', {}, [rec.model]), badge(`Score ${rec.score}`, 'violet')]),
        h('div.muted.mb-12', { style: 'font-size:var(--fs-sm)' }, ['Recommended for coding']),
        h('div.chips', {}, (rec.reasons || []).slice(0, 6).map((r) => h('span.chip', {}, [r]))),
        rec.explanation ? h('p.muted.mt-12', { style: 'font-size:var(--fs-sm)' }, [rec.explanation]) : null,
      ]));
    }
    setFoot([btn('Back', { variant: 'ghost', onClick: () => go(3) }), btn('Continue', { variant: 'primary', icon: 'arrowRight', onClick: () => go(5) })]);
  }

  // Step 6 — safe test / optional live
  function renderTest() {
    const t = wiz.testResult;
    const resultBox = h('div');
    const renderResult = () => {
      while (resultBox.firstChild) resultBox.removeChild(resultBox.firstChild);
      if (!t) { resultBox.appendChild(h('div.muted', {}, ['No test run yet.'])); return; }
      resultBox.appendChild(h('div.row.gap-8', {}, [
        statusDot(t.ok ? 'green' : 'amber', t.ok ? 'Reachable' : 'Not verified'),
        t.latencyMs != null ? badge(fmtMs(t.latencyMs), 'gray') : null,
      ]));
      if (t.error) resultBox.appendChild(h('div.mt-8', { style: 'font-size:var(--fs-sm);color:var(--amber)' }, [t.error]));
    };
    renderResult();
    setBody(h('div', {}, [
      h('p.muted.mb-12', {}, ['A safe diagnostic check has already run (no tokens spent). You can optionally run a live test — this may consume a small amount of quota and only runs when you click it.']),
      resultBox,
      h('div.mt-16', {}, [btn('Run Live Test', { icon: 'play', onClick: async (e) => {
        e.target.disabled = true; toast('Running live test…');
        try { const r = await api.testProvider({ live: true }); wiz.testResult = Object.assign({}, r); renderResult(); toast(r.ok ? 'Live test passed' : 'Live test failed', { type: r.ok ? 'success' : 'error', message: r.error || null }); }
        catch (err) { toast('Live test failed', { type: 'error', message: err.message }); }
        finally { e.target.disabled = false; }
      } })]),
    ]));
    setFoot([btn('Back', { variant: 'ghost', onClick: () => go(4) }), btn('Continue', { variant: 'primary', icon: 'arrowRight', onClick: () => go(6) })]);
  }

  // Step 7 — finish
  function renderFinish() {
    setBody(h('div', { style: 'text-align:center;padding:12px 0' }, [
      h('div.empty-icon', { style: 'background:var(--green-dim);color:var(--green);margin:0 auto 12px;width:52px;height:52px' }, [icon('check')]),
      h('div.empty-title', {}, [`${wiz.name} is ready`]),
      h('div.empty-text', { style: 'margin:6px auto 0' }, [wiz.saved?.keyStored ? 'Provider saved and API key stored securely in .env.' : 'Provider saved. It is now the active provider.']),
    ]));
    setFoot([
      btn('Configure Client', { icon: 'clients', onClick: () => { closeOverlay(); ctx.navigate('clients'); } }),
      btn('Open Router', { icon: 'router', onClick: () => { closeOverlay(); ctx.navigate('router'); } }),
      btn('Done', { variant: 'primary', icon: 'check', onClick: () => { closeOverlay(); clearCache(); ctx.navigate('providers', true); ctx.refreshHealth(); } }),
    ]);
  }

  openOverlay(node);
  render();
}

function field(label, input, hint) {
  return h('div.field', {}, [h('label.field-label', {}, [label]), input, hint ? h('div.field-hint', {}, [hint]) : null]);
}
function defaultName(p) { return String(p.id || 'provider').replace(/[^a-z0-9]+/gi, '-').toLowerCase(); }
function defaultBase(p) {
  if (/ollama-local/i.test(p.id)) return 'http://127.0.0.1:11434';
  if (/openrouter/i.test(p.id)) return 'https://openrouter.ai/api';
  if (/anthropic/i.test(p.id)) return 'https://api.anthropic.com';
  return 'https://api.example.com/v1';
}

// ---------- page ----------
export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Providers']), h('div.page-sub', {}, ['AI providers connected to your gateway'])]),
    h('div.page-head-actions', {}, [btn('Add Provider', { variant: 'primary', icon: 'plus', onClick: () => start() })]),
  ]));
  const holder = h('div', {}, [skeletonCards(3)]);
  page.appendChild(holder);

  let presetsCache = [];
  async function start() {
    if (!presetsCache.length) { try { const d = await api.providers(); presetsCache = d.presets || []; } catch {} }
    openWizard(presetsCache, ctx);
  }
  const onAdd = () => start();
  window.addEventListener('pr:add-provider', onAdd, { once: true });

  const data = await api.providers();
  presetsCache = data.presets || [];
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  const list = data.providers || [];
  if (!list.length) {
    holder.appendChild(emptyState({ icon: 'providers', title: 'Connect your first provider', text: 'Add OpenRouter, Anthropic, Ollama, or a custom OpenAI-compatible endpoint.', action: btn('Add Provider', { variant: 'primary', icon: 'plus', onClick: () => start() }) }));
    return;
  }
  holder.appendChild(h('div.grid.grid-cards', {}, list.map((p) => providerCard(p, ctx))));
}

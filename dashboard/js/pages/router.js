// Router — routing modes, constraints, candidate ranking, per-client, fallback.
import { api, clearCache } from '../api.js';
import {
  h, icon, btn, badge, statusDot, skeleton, toast, dialog, closeOverlay, emptyState,
} from '../ui.js';

// UI modes → backend profile id (or null for UI-only constraint modes)
const MODES = [
  ['Balanced', 'balanced'], ['Coding', 'coding'], ['Strongest', 'strongest'], ['Fastest', 'fastest'],
  ['Cheapest', 'cheapest'], ['Free Only', 'free'], ['Reasoning', 'reasoning'], ['Long Context', 'long-context'],
  ['Vision', 'vision'], ['Tools', 'tools'], ['Local Only', null], ['Privacy First', null],
];
const CLIENT_TABS = [['global', 'Global'], ['opencode', 'OpenCode'], ['claude-code', 'Claude Code'], ['hermes', 'Hermes']];
const FB_CONDITIONS = ['429', 'Timeout', '502', '503', '504', 'Model unavailable'];

const isUnknown = (v) => v === 'unknown' || v == null;
const num = (v) => (typeof v === 'number' ? v : (isUnknown(v) ? null : Number(v)));

const state = {
  data: null,
  mode: 'Balanced',
  clientTab: 'global',
  constraints: { tools: false, vision: false, reasoning: false, minContext: 0, verifiedFree: false, localOnly: false, crossProvider: false },
};

function modeToProfile(mode) { const e = MODES.find((m) => m[0] === mode); return e && e[1] ? e[1] : 'balanced'; }

function candidateMatchesConstraints(c) {
  const k = state.constraints;
  if (k.tools && c.tools !== true) return false;
  if (k.vision && c.vision !== true) return false;
  if (k.reasoning && c.reasoning !== true) return false;
  if (k.verifiedFree && c.free !== true) return false;
  if (k.minContext) { const n = num(c.contextWindow); if (n == null || n < k.minContext) return false; }
  if ((k.localOnly || state.mode === 'Local Only') && !/local|ollama|127\.0\.0\.1|localhost/i.test(`${c.provider}`)) return false;
  return true;
}

function whyDialog(c) {
  dialog({
    title: 'Why this ranking?', icon: 'router',
    body: h('div', {}, [
      h('div.row-between.mb-12', {}, [h('div.card-title.mono', {}, [c.id]), badge(`Score ${c.score}`, 'violet')]),
      h('div.section-title', { style: 'margin-top:0' }, ['Scoring factors (from real metadata)']),
      (c.reasons && c.reasons.length)
        ? h('div.stack.gap-6', {}, c.reasons.map((r) => h('div.row.gap-8', {}, [h('span.dot.dot-green', { 'aria-hidden': 'true' }), h('span', {}, [r])])))
        : h('div.muted', {}, ['No scoring factors reported for this model.']),
      h('p.muted-3.mt-16', { style: 'font-size:var(--fs-xs)' }, ['PromptRelay ranks on real capability metadata only. It does not fabricate benchmark intelligence scores.']),
    ]),
    footer: btn('Close', { onClick: () => closeOverlay() }),
  });
}

function renderCandidates(holder) {
  const d = state.data;
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  if (!d.hasModels) {
    holder.appendChild(emptyState({ icon: 'models', title: 'No models to rank yet', text: 'Refresh models on the Models page, then routing candidates will appear here.' }));
    return;
  }
  const list = (d.candidates || []).filter(candidateMatchesConstraints);
  if (!list.length) { holder.appendChild(emptyState({ icon: 'router', title: 'No candidates match the constraints', text: 'Relax the constraints panel to see ranked models.' })); return; }
  const maxScore = Math.max(...list.map((c) => c.score || 0), 1);
  list.forEach((c, i) => {
    holder.appendChild(h('div.card.mb-12', {}, [
      h('div.row-between', {}, [
        h('div.row.gap-12', { style: 'min-width:0' }, [
          h('div.metric-value', { style: 'font-size:var(--fs-lg);color:var(--text-3);width:28px' }, [`#${i + 1}`]),
          h('div', { style: 'min-width:0' }, [
            h('div.mono', { style: 'font-weight:600;overflow:hidden;text-overflow:ellipsis' }, [c.id]),
            h('div.muted', { style: 'font-size:var(--fs-xs)' }, [c.provider || '']),
          ]),
        ]),
        h('div.row.gap-8', {}, [badge(`Score ${c.score}`, 'violet'), btn('Why?', { sm: true, variant: 'ghost', onClick: () => whyDialog(c) })]),
      ]),
      h('div.row.gap-8.mt-8', { style: 'align-items:center' }, [
        h('div.scorebar', {}, [h('div.scorebar-fill', { style: `width:${Math.round((c.score / maxScore) * 100)}%` })]),
      ]),
      h('div.chips.mt-8', {}, [
        c.free === true ? h('span.chip.active', {}, ['Free']) : null,
        c.tools === true ? h('span.chip.active', {}, ['Tools']) : null,
        c.reasoning === true ? h('span.chip.active', {}, ['Reasoning']) : null,
        c.vision === true ? h('span.chip.active', {}, ['Vision']) : null,
        num(c.contextWindow) ? h('span.chip', {}, [`${Math.round(num(c.contextWindow) / 1000)}K ctx`]) : null,
      ]),
    ]));
  });
}

async function reloadCandidates(holder) {
  holder.appendChild(skeleton('skeleton-card'));
  try { state.data = await api.router(modeToProfile(state.mode)); } catch (e) { toast('Failed to rank', { type: 'error', message: e.message }); return; }
  renderCandidates(holder);
}

function fallbackChain() {
  const d = state.data;
  const fb = d.fallback || {};
  const primary = d.recommendation?.model || 'Active provider/model';
  const nodes = [h('div.chain-node', {}, [
    h('div.muted-3', { style: 'font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.05em' }, ['Primary']),
    h('div.mono.mt-8', {}, [primary]),
  ])];
  const chain = fb.providers || [];
  if (!chain.length) {
    nodes.push(h('div.chain-arrow', {}, [icon('arrowDown'), 'No fallback configured']));
  } else {
    chain.forEach((p, i) => {
      nodes.push(h('div.chain-arrow', {}, [icon('arrowDown'), 'on 429 / timeout / 5xx']));
      nodes.push(h('div.chain-node', {}, [
        h('div.muted-3', { style: 'font-size:var(--fs-xs);text-transform:uppercase;letter-spacing:0.05em' }, [`Fallback ${i + 1}`]),
        h('div.mono.mt-8', {}, [p]),
      ]));
    });
  }
  return h('div', {}, nodes);
}

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Router']), h('div.page-sub', {}, ['Choose how PromptRelay selects a model for each request'])]),
  ]));
  const loading = h('div', {}, [skeleton('skeleton-line', 'width:50%'), skeleton('skeleton-card')]);
  page.appendChild(loading);

  try { state.data = await api.router('balanced'); } catch (e) { page.removeChild(loading); page.appendChild(emptyState({ icon: 'router', title: 'Router unavailable', text: e.message })); return; }
  const d = state.data;
  // sync mode from saved profile
  const savedMode = MODES.find((m) => m[1] === d.currentProfile);
  if (savedMode) state.mode = savedMode[0];
  state.constraints.crossProvider = Boolean(d.fallback?.crossProvider);
  page.removeChild(loading);

  // ---- Mode selector ----
  page.appendChild(h('div.section-title', { style: 'margin-top:0' }, ['Routing mode']));
  const modeGrid = h('div.choice-grid.mb-16');
  const candHolder = h('div');
  const rebuildModes = () => {
    while (modeGrid.firstChild) modeGrid.removeChild(modeGrid.firstChild);
    MODES.forEach(([label, profile]) => {
      const active = state.mode === label;
      modeGrid.appendChild(h('button.choice', { class: active ? 'selected' : '', onclick: async () => {
        state.mode = label;
        if (label === 'Privacy First') state.constraints.crossProvider = false;
        rebuildModes();
        if (profile) { try { await api.saveRouter({ profile }); toast(`Mode: ${label}`, { type: 'success' }); } catch (e) { toast('Could not save mode', { type: 'error', message: e.message }); } }
        else { toast(`${label} is a constraint mode`, { type: 'info', message: 'Applied as a session filter on candidates.' }); }
        await reloadCandidates(candHolder);
      } }, [
        h('div.choice-title', {}, [label]),
        h('div.choice-sub', {}, [profile ? 'Ranked profile' : 'Constraint mode']),
      ]));
    });
  };
  rebuildModes();
  page.appendChild(modeGrid);

  // ---- Constraints panel ----
  page.appendChild(h('div.section-title', {}, ['Constraints']));
  const kc = state.constraints;
  const mkToggle = (label, key) => h('label.toggle', {}, [
    h('input', { type: 'checkbox', checked: kc[key], onchange: (e) => { kc[key] = e.target.checked; renderCandidates(candHolder); } }),
    h('span.toggle-track', {}, [h('span.toggle-thumb')]),
    h('span', {}, [label]),
  ]);
  const minCtx = h('select.select', { style: 'max-width:160px', onchange: (e) => { kc.minContext = Number(e.target.value); renderCandidates(candHolder); } }, [
    ['0', 'Any context'], ['32000', '32K+'], ['128000', '128K+'], ['200000', '200K+'], ['1000000', '1M+'],
  ].map(([v, l]) => h('option', { value: v }, [l])));
  page.appendChild(h('div.card.mb-16', {}, [
    h('div.row.wrap.gap-16', {}, [
      mkToggle('Must support tools', 'tools'),
      mkToggle('Must support vision', 'vision'),
      mkToggle('Must support reasoning', 'reasoning'),
      mkToggle('Verified free only', 'verifiedFree'),
      mkToggle('Local only', 'localOnly'),
    ]),
    h('div.field.mt-12', { style: 'max-width:200px;margin-bottom:0' }, [h('label.field-label', {}, ['Minimum context']), minCtx]),
    h('p.field-hint.mt-8', {}, ['Constraints filter the ranked candidates below in this session.']),
  ]));

  // ---- Candidate ranking ----
  page.appendChild(h('div.section-title', {}, ['Candidate ranking']));
  page.appendChild(candHolder);
  await reloadCandidates(candHolder);

  // ---- Per-client routing ----
  page.appendChild(h('div.section-title', {}, ['Per-client routing']));
  const tabsEl = h('div.tabs');
  const tabBody = h('div');
  const renderTab = () => {
    while (tabBody.firstChild) tabBody.removeChild(tabBody.firstChild);
    if (state.clientTab === 'global') {
      tabBody.appendChild(h('div.card', {}, [h('div.muted', {}, ['The global routing mode above applies to every client unless overridden per client.'])]));
      return;
    }
    const cur = d.clientProfiles?.[state.clientTab] || 'inherit';
    const sel = h('select.select', { style: 'max-width:240px', onchange: async (e) => {
      try { await api.saveRouter({ clientProfiles: { [state.clientTab]: e.target.value } }); toast('Per-client profile saved', { type: 'success' }); d.clientProfiles[state.clientTab] = e.target.value; } catch (err) { toast('Save failed', { type: 'error', message: err.message }); }
    } }, [
      h('option', { value: 'inherit', selected: cur === 'inherit' }, ['Inherit global']),
      ...(d.profiles || []).map((p) => h('option', { value: p, selected: cur === p }, [p])),
    ]);
    tabBody.appendChild(h('div.card', {}, [
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Routing profile for this client']), sel]),
    ]));
  };
  CLIENT_TABS.forEach(([id, label]) => {
    tabsEl.appendChild(h('button.tab', { class: state.clientTab === id ? 'active' : '', onclick: () => { state.clientTab = id; Array.from(tabsEl.children).forEach((t, i) => t.classList.toggle('active', CLIENT_TABS[i][0] === id)); renderTab(); } }, [label]));
  });
  page.appendChild(tabsEl);
  page.appendChild(tabBody);
  renderTab();

  // ---- Fallback chain ----
  page.appendChild(h('div.section-title', {}, ['Fallback chain']));
  const fbHolder = h('div.card', {}, [fallbackChain()]);
  page.appendChild(fbHolder);

  const privacyBox = h('div.mt-12');
  const renderPrivacy = () => {
    while (privacyBox.firstChild) privacyBox.removeChild(privacyBox.firstChild);
    if (kc.crossProvider) {
      privacyBox.appendChild(h('div.card', { style: 'border-color:rgba(245,181,68,0.4);background:var(--amber-dim)' }, [
        h('div.row.gap-8', {}, [icon('alert'), h('div', {}, [h('strong', {}, ['Privacy warning']), h('div.muted', { style: 'font-size:var(--fs-sm)' }, ['Cross-provider fallback can send your prompts to a different provider. Only enable if that is acceptable for your data.'])])]),
      ]));
    }
  };
  page.appendChild(h('div.card.mt-12', {}, [
    h('div.row-between', {}, [
      h('div', {}, [h('strong', {}, ['Allow cross-provider fallback']), h('div.muted', { style: 'font-size:var(--fs-sm)' }, ['Off by default. When on, requests may be sent to a different provider on failure.'])]),
      h('label.toggle', {}, [
        h('input', { type: 'checkbox', checked: kc.crossProvider, onchange: async (e) => {
          kc.crossProvider = e.target.checked;
          try { await api.saveRouter({ fallback: { crossProvider: e.target.checked } }); toast('Fallback setting saved', { type: 'success' }); } catch (err) { toast('Save failed', { type: 'error', message: err.message }); }
          renderPrivacy();
        } }),
        h('span.toggle-track', {}, [h('span.toggle-thumb')]),
      ]),
    ]),
    privacyBox,
    h('div.section-title', {}, ['Trigger conditions']),
    h('div.chips', {}, FB_CONDITIONS.map((c) => h('span.chip', {}, [c]))),
  ]));
  renderPrivacy();
}

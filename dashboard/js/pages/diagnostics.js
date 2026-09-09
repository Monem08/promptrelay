// Diagnostics — a system health console, plus the Autopilot panel.
import { api } from '../api.js';
import {
  h, icon, btn, badge, skeleton, toast, dialog, closeOverlay, errorState, fmtTime,
} from '../ui.js';

const STATUS_META = {
  ok: { mark: 'tl-ok', ic: 'check', sr: 'Passed' },
  error: { mark: 'tl-error', ic: 'x', sr: 'Failed' },
  attention: { mark: 'tl-attention', ic: 'alert', sr: 'Needs attention' },
  unknown: { mark: 'tl-unknown', ic: null, sr: 'Unknown' },
  skipped: { mark: 'tl-skipped', ic: null, sr: 'Skipped' },
  pending: { mark: 'tl-pending', ic: null, sr: 'Pending' },
};

function mark(status) {
  const m = STATUS_META[status] || STATUS_META.unknown;
  return h(`span.tl-mark.${m.mark}`, { role: 'img', 'aria-label': m.sr }, m.ic ? [icon(m.ic)] : []);
}

function checkRow(check) {
  return h('div.tl-step', {}, [
    mark(check.status),
    h('span', {}, [check.label]),
    check.detail ? h('span.tl-detail', {}, [check.detail]) : null,
  ]);
}

let prefersReduced = false;
try { prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* ignore */ }
const sleep = (ms) => new Promise((r) => setTimeout(r, prefersReduced ? 0 : ms));

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [
      h('h1.page-title', {}, ['Diagnostics']),
      h('div.page-sub', {}, ['System health console — verify the gateway, providers, models, clients, and security']),
    ]),
    h('div.page-head-actions', {}, [
      btn('Run Diagnostics', { icon: 'doctor', variant: 'primary', sm: true, onClick: () => runDiag(false) }),
      btn('Run Deep Diagnostics', { icon: 'doctor', sm: true, onClick: () => runDiag(true) }),
      btn('Repair Safe Issues', { icon: 'wand', sm: true, onClick: () => repairSafe() }),
    ]),
  ]));

  // ---- Autopilot panel ----
  const autoBody = h('div', {}, [
    h('p.muted', { style: 'font-size:var(--fs-sm)' }, ['Runs a sequence of safe checks and refreshes. Autopilot never runs paid tests or sends live prompts.']),
  ]);
  const autoBtn = btn('Run Autopilot \u26a1', { variant: 'primary', icon: 'zap', onClick: () => runAutopilot() });
  page.appendChild(h('div.card.mb-16', { style: 'border-color:rgba(124,92,255,0.35)' }, [
    h('div.row.row-between.wrap.gap-12', {}, [
      h('div.row.gap-10', { style: 'align-items:center' }, [
        h('span.tl-mark.tl-ok', { 'aria-hidden': 'true', style: 'background:var(--violet-dim);color:var(--violet)' }, [icon('wand')]),
        h('div', {}, [
          h('div.card-title', {}, ['Autopilot']),
          h('div.card-sub', {}, ['One click to validate, refresh, and evaluate — safely']),
        ]),
      ]),
      autoBtn,
    ]),
    autoBody,
  ]));

  const results = h('div');
  page.appendChild(results);

  const loading = h('div', {}, [skeleton('skeleton-line', 'width:30%'), skeleton('skeleton-card'), skeleton('skeleton-card')]);
  results.appendChild(loading);

  let cache = null;
  async function load(deep) {
    let data;
    try { data = deep == null ? await api.diagnostics(false) : await api.runDiagnostics(deep); }
    catch (e) {
      while (results.firstChild) results.removeChild(results.firstChild);
      results.appendChild(errorState({ title: 'Diagnostics failed to run', message: e.message, onRetry: () => runDiag(false) }));
      return;
    }
    cache = data;
    renderResults(data);
  }

  function renderResults(data) {
    while (results.firstChild) results.removeChild(results.firstChild);

    const problems = data.problems || [];
    const bannerTone = data.ok ? 'green' : (problems.length ? 'red' : 'amber');
    results.appendChild(h('div.card.mb-16', {
      style: `border-color:${data.ok ? 'rgba(63,185,110,0.4)' : 'rgba(240,90,90,0.4)'};background:${data.ok ? 'var(--green-dim)' : 'var(--red-dim)'}`,
    }, [
      h('div.row.row-between.wrap.gap-8', {}, [
        h('div.row.gap-8', { style: 'align-items:center' }, [
          icon(data.ok ? 'check' : 'alert'),
          h('div', {}, [
            h('div', { style: 'font-weight:600;color:var(--text-1)' }, [data.ok ? 'All checks passed' : `${problems.length} issue${problems.length === 1 ? '' : 's'} found`]),
            data.ranAt ? h('div.muted-3', { style: 'font-size:var(--fs-xs)' }, [`Last run ${fmtTime(data.ranAt)}${data.deep ? ' · deep' : ''}`]) : null,
          ]),
        ]),
        badge(data.ok ? 'Healthy' : 'Attention needed', bannerTone),
      ]),
    ]));

    (data.sections || []).forEach((section) => {
      const checks = section.checks || [];
      const bad = checks.filter((c) => c.status === 'error').length;
      const warn = checks.filter((c) => c.status === 'attention').length;
      results.appendChild(h('div.card.mb-12', {}, [
        h('div.row.row-between.mb-8', {}, [
          h('div.card-title', {}, [section.name]),
          bad ? badge(`${bad} failing`, 'red') : warn ? badge(`${warn} warning${warn === 1 ? '' : 's'}`, 'amber') : badge('OK', 'green'),
        ]),
        h('div.timeline', {}, checks.length ? checks.map(checkRow) : [h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No checks reported.'])]),
      ]));
    });
  }

  async function runDiag(deep) {
    while (results.firstChild) results.removeChild(results.firstChild);
    results.appendChild(h('div.card', {}, [
      h('div.row.gap-8.mb-12', { style: 'align-items:center' }, [icon('doctor'), h('span', {}, [deep ? 'Running deep diagnostics…' : 'Running diagnostics…'])]),
      h('div.progress', {}, [h('div.progress-bar', { style: 'width:40%' })]),
    ]));
    await load(deep);
    toast(deep ? 'Deep diagnostics complete' : 'Diagnostics complete');
  }

  function repairSafe() {
    const problems = (cache && cache.problems) || [];
    dialog({
      title: 'Repair safe issues', icon: 'wand',
      body: h('div', {}, [
        h('p.muted.mb-12', { style: 'font-size:var(--fs-sm)' }, ['PromptRelay applies fixes through its CLI so changes are explicit and auditable. Review the suggested actions, then run them from a terminal or use Autopilot for safe, read-only refreshes.']),
        problems.length
          ? h('ul', { style: 'margin:0 0 12px 18px;color:var(--text-2);font-size:var(--fs-sm)' }, problems.map((p) => h('li', { style: 'margin-bottom:4px' }, [String(p)])))
          : h('p.muted', { style: 'font-size:var(--fs-sm)' }, ['No issues detected in the last run — nothing to repair.']),
        h('div.section-title', {}, ['Suggested commands']),
        h('pre.mono', { style: 'white-space:pre-wrap;background:var(--bg-sunken);padding:12px;border-radius:var(--r-md);font-size:var(--fs-xs)' }, [
          'promptrelay doctor --fix     # apply safe automated fixes\npromptrelay refresh          # refresh model metadata cache\npromptrelay setup            # re-run guided configuration',
        ]),
      ]),
      footer: h('div.row.gap-8', {}, [
        btn('Close', { onClick: () => closeOverlay() }),
        btn('Run Autopilot instead', { variant: 'primary', icon: 'zap', onClick: () => { closeOverlay(); runAutopilot(); } }),
      ]),
    });
  }

  async function runAutopilot() {
    autoBtn.disabled = true;
    while (autoBody.firstChild) autoBody.removeChild(autoBody.firstChild);
    const tl = h('div.timeline');
    const bar = h('div.progress-bar', { style: 'width:5%' });
    autoBody.appendChild(h('div.progress.mb-12', {}, [bar]));
    autoBody.appendChild(tl);

    let data;
    try { data = await api.autopilot(); }
    catch (e) {
      while (autoBody.firstChild) autoBody.removeChild(autoBody.firstChild);
      autoBody.appendChild(errorState({ title: 'Autopilot failed', message: e.message, onRetry: () => runAutopilot() }));
      autoBtn.disabled = false;
      return;
    }

    const steps = data.steps || [];
    // Subtle staggered reveal
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const running = h('div.tl-step.tl-running', {}, [
        h('span.tl-mark.tl-pending', { 'aria-hidden': 'true' }, [icon('refresh')]),
        h('span', {}, [s.label]),
      ]);
      tl.appendChild(running);
      bar.style.width = `${Math.round(((i + 1) / steps.length) * 100)}%`;
      await sleep(320);
      tl.removeChild(running);
      const meta = STATUS_META[s.status] || STATUS_META.unknown;
      tl.appendChild(h('div.tl-step', {}, [
        h(`span.tl-mark.${meta.mark}`, { role: 'img', 'aria-label': meta.sr }, meta.ic ? [icon(meta.ic)] : []),
        h('span', {}, [s.label]),
        s.detail ? h('span.tl-detail', {}, [s.detail]) : null,
      ]));
    }
    bar.style.width = '100%';

    const sum = data.summary || {};
    autoBody.appendChild(h('div.row.wrap.gap-8.mt-12', { style: 'align-items:center' }, [
      badge(data.ready ? 'READY' : 'Needs attention', data.ready ? 'green' : 'amber'),
      typeof sum.ok === 'number' ? badge(`${sum.ok} ok`, 'green') : null,
      typeof sum.attention === 'number' && sum.attention ? badge(`${sum.attention} needs attention`, 'amber') : null,
      typeof sum.skipped === 'number' && sum.skipped ? badge(`${sum.skipped} skipped`, 'gray') : null,
    ]));
    toast(data.ready ? 'Autopilot: ready' : 'Autopilot finished with items to review', { type: data.ready ? 'success' : 'default' });
    autoBtn.disabled = false;
    // Refresh diagnostics view to reflect any refreshed metadata
    load(null);
  }

  // Event hooks from command palette (auto-removed after firing, matching other pages)
  window.addEventListener('pr:run-diagnostics', () => runDiag(false), { once: true });
  window.addEventListener('pr:run-autopilot', () => runAutopilot(), { once: true });

  await load(null);
}

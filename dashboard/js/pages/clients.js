// Clients — dedicated multi-client management with official brand logos,
// middle-truncated paths with copy buttons, and responsive grid layout.
import { api } from '../api.js';
import {
  h, icon, btn, badge, statusDot, skeletonCards, toast, dialog, closeOverlay,
  emptyState, timeAgo, copyText, createLogo,
} from '../ui.js';

function clientCard(cl, ctx) {
  const tone = !cl.found ? 'gray' : cl.valid === false ? 'red' : cl.configured ? 'green' : 'amber';
  const label = !cl.found ? 'Not installed' : cl.valid === false ? 'Invalid config' : cl.configured ? 'Connected' : 'Detected, not wired';
  const d = cl.details || {};

  return h('div.card.client-card', {}, [
    h('div.row-between.mb-12', {}, [
      h('div.row.gap-12', { style: 'min-width:0' }, [
        createLogo(cl.id, { size: 36 }),
        h('div', { style: 'min-width:0' }, [
          h('div.card-title.truncate', {}, [cl.label]),
          h('div.card-sub', {}, [cl.protocol === 'anthropic' ? 'Anthropic Messages API' : 'OpenAI-compatible ingress']),
        ]),
      ]),
      statusDot(tone, label),
    ]),
    h('dl.dl', {}, [
      h('dt', {}, ['Version']), h('dd', {}, [d.version ? h('span.mono', {}, [d.version]) : unknown()]),
      h('dt', {}, ['Ingress']), h('dd', {}, [h('span.mono', {}, [cl.ingress || '—'])]),
      h('dt', {}, ['Endpoint']), h('dd', {}, [h('span.mono', {}, [cl.endpoint || '—'])]),
      h('dt', {}, ['Config path']), h('dd', {}, [pathBox(cl.path)]),
      h('dt', {}, ['Active model']), h('dd', {}, [h('span.mono', {}, [d.model || 'Auto'])]),
      h('dt', {}, ['Last checked']), h('dd', {}, [cl.lastChecked || cl.checkedAt ? timeAgo(cl.lastChecked || cl.checkedAt) : unknown()]),
    ]),
    cl.error ? h('div.mt-8', { style: 'font-size:var(--fs-sm);color:var(--danger)' }, [cl.error]) : null,
    h('div.row.wrap.gap-8.mt-16', {}, [
      !cl.configured
        ? btn('Configure', { sm: true, variant: 'primary', icon: 'gear', onClick: () => showConfigure(cl, ctx) })
        : btn('Reconfigure', { sm: true, icon: 'gear', onClick: () => showConfigure(cl, ctx) }),
      btn('Test', { sm: true, icon: 'check', onClick: () => testClient(cl, ctx) }),
      btn('Repair', { sm: true, icon: 'wand', onClick: () => showRepair(cl, ctx) }),
      cl.configured ? btn('Disconnect', { sm: true, variant: 'danger', icon: 'trash', onClick: () => confirmRemove(cl, ctx) }) : null,
    ]),
  ]);
}

function pathBox(val) {
  if (!val || val === '—') return unknown();
  return h('div.path-box', { title: val }, [
    h('span.path-text', {}, [val]),
    btn('', {
      sm: true, variant: 'ghost', icon: 'copy', title: 'Copy path to clipboard',
      onClick: (e) => { e.stopPropagation(); copyText(val, 'Path copied'); }
    }),
  ]);
}

function unknown() { return h('span.muted-3', { title: 'No data / not reported' }, ['Unknown']); }

function showConfigure(cl, ctx) {
  const cmd = `promptrelay client setup ${cl.id}`;
  dialog({
    title: `Configure ${cl.label}`, icon: 'gear',
    body: h('div', {}, [
      h('p.muted', {}, [`Wire ${cl.label} to PromptRelay with automatic configuration, comment preservation, and backup safety:`]),
      h('div.editor.mt-12', {}, [
        h('div.editor-bar', {}, [h('span.muted', {}, ['Terminal']), h('div', { style: 'flex:1' }), btn('Copy', { sm: true, variant: 'ghost', icon: 'copy', onClick: () => copyText(cmd) })]),
        h('pre.mono', { style: 'padding:14px 16px;margin:0;color:var(--text-primary)' }, [cmd]),
      ]),
      h('p.muted.mt-12', { style: 'font-size:var(--fs-sm)' }, [`Target gateway endpoint: ${cl.endpoint}`]),
    ]),
    footer: h('div.row.gap-8', {}, [
      btn('Close', { onClick: () => closeOverlay() }),
      btn('Configure Now ⚡', {
        variant: 'primary', icon: 'gear',
        onClick: async () => {
          closeOverlay();
          toast(`Configuring ${cl.label}…`);
          try {
            await api.configureClient(cl.id, {});
            toast(`${cl.label} configured successfully!`, { type: 'success' });
            ctx.navigate('clients', true);
          } catch (err) {
            toast(`Failed to configure ${cl.label}`, { type: 'error', message: err.message });
          }
        },
      }),
    ]),
  });
}

function showRepair(cl, ctx) {
  const cmd = `promptrelay client repair ${cl.id}`;
  dialog({
    title: `Repair ${cl.label}`, icon: 'wand',
    body: h('div', {}, [
      h('p.muted', {}, [`Repair restores PromptRelay wiring for ${cl.label} while preserving your existing config and creating an atomic backup:`]),
      h('div.editor.mt-12', {}, [
        h('div.editor-bar', {}, [h('span.muted', {}, ['Terminal']), h('div', { style: 'flex:1' }), btn('Copy', { sm: true, variant: 'ghost', icon: 'copy', onClick: () => copyText(cmd) })]),
        h('pre.mono', { style: 'padding:14px 16px;margin:0;color:var(--text-primary)' }, [cmd]),
      ]),
    ]),
    footer: h('div.row.gap-8', {}, [
      btn('Close', { onClick: () => closeOverlay() }),
      btn('Repair Now 🪄', {
        variant: 'primary', icon: 'wand',
        onClick: async () => {
          closeOverlay();
          toast(`Repairing ${cl.label}…`);
          try {
            await api.configureClient(cl.id, {});
            toast(`${cl.label} repaired successfully!`, { type: 'success' });
            ctx.navigate('clients', true);
          } catch (err) {
            toast(`Failed to repair ${cl.label}`, { type: 'error', message: err.message });
          }
        },
      }),
    ]),
  });
}

function confirmRemove(cl, ctx) {
  dialog({
    title: `Disconnect ${cl.label}?`, icon: 'trash',
    body: h('p.muted', {}, [`Remove PromptRelay wiring from ${cl.label}? Existing settings will be restored from backup.`]),
    footer: h('div.row.gap-8', {}, [
      btn('Cancel', { onClick: () => closeOverlay() }),
      btn('Disconnect', {
        variant: 'danger', icon: 'trash',
        onClick: async () => {
          closeOverlay();
          try {
            await api.removeClient(cl.id);
            toast(`Removed PromptRelay from ${cl.label}`);
            ctx.navigate('clients', true);
          } catch (e) {
            toast('Failed to disconnect', { type: 'error', message: e.message });
          }
        },
      }),
    ]),
  });
}

async function testClient(cl, ctx) {
  toast(`Testing ${cl.label}…`);
  try {
    const res = await api.testClient(cl.id);
    const s = res.status || {};
    if (s.found && s.configured && s.valid !== false) {
      toast(`${cl.label} is connected and ready`, { type: 'success' });
    } else if (s.found && !s.configured) {
      toast(`${cl.label} detected but not wired`, { type: 'info', message: 'Click Configure to connect it to PromptRelay.' });
    } else {
      toast(`${cl.label} status: ${s.error || 'Not detected'}`, { type: 'error' });
    }
    ctx.navigate('clients', true);
  } catch (e) {
    toast('Test failed', { type: 'error', message: e.message });
  }
}

async function runDetect(page, ctx) {
  const steps = ['OpenCode', 'Claude Code', 'Hermes'];
  const rows = steps.map((s) => h('div.tl-step.tl-running', {}, [
    h('div.tl-mark.tl-pending', {}, [icon('refresh')]),
    h('span', {}, [s]),
  ]));
  dialog({
    title: 'Detecting clients', icon: 'clients',
    body: h('div.timeline', {}, rows),
    footer: null,
  });
  let data;
  try { data = await api.clients(); } catch (e) { closeOverlay(); toast('Detection failed', { type: 'error', message: e.message }); return; }
  const list = data.clients || [];
  for (let i = 0; i < steps.length; i++) {
    await sleep(260);
    const cl = list.find((c) => c.label === steps[i]) || {};
    const found = cl.found;
    const row = rows[i];
    row.classList.remove('tl-running');
    while (row.firstChild) row.removeChild(row.firstChild);
    row.append(
      h(`div.tl-mark.${found ? 'tl-ok' : 'tl-unknown'}`, {}, [icon(found ? 'check' : 'close')]),
      h('span', {}, [steps[i]]),
      h('span.tl-detail', {}, [found ? (cl.configured ? 'Connected' : 'Detected') : 'Not found']),
    );
  }
  await sleep(350);
  closeOverlay();
  ctx.navigate('clients', true);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Clients']), h('div.page-sub', {}, ['Coding clients wired to PromptRelay gateway'])]),
    h('div.page-head-actions', {}, [btn('Detect Clients', { variant: 'primary', icon: 'refresh', onClick: () => runDetect(page, ctx) })]),
  ]));
  const holder = h('div', {}, [skeletonCards(3)]);
  page.appendChild(holder);

  const onDetect = () => runDetect(page, ctx);
  window.addEventListener('pr:detect-clients', onDetect, { once: true });

  const data = await api.clients();
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  const list = data.clients || [];
  if (!list.length) {
    holder.appendChild(emptyState({ icon: 'clients', title: 'No supported coding clients detected', text: 'Install OpenCode, Claude Code, or Hermes, then run Detect Clients.' }));
    return;
  }
  holder.appendChild(h('div.grid.grid-cards', {}, list.map((cl) => clientCard(cl, ctx))));
}

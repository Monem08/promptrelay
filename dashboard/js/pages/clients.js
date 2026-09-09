// Clients — dedicated client management.
import { api } from '../api.js';
import {
  h, icon, btn, badge, statusDot, skeletonCards, toast, dialog, closeOverlay,
  emptyState, fmtTime, copyText,
} from '../ui.js';

function clientCard(cl, ctx) {
  const tone = !cl.found ? 'gray' : cl.valid === false ? 'red' : cl.configured ? 'green' : 'amber';
  const label = !cl.found ? 'Not configured' : cl.valid === false ? 'Invalid config' : cl.configured ? 'Connected' : 'Detected, not wired';
  const d = cl.details || {};
  return h('div.card', {}, [
    h('div.row-between.mb-12', {}, [
      h('div.row.gap-12', {}, [
        h('div.brand-mark', { style: 'background:var(--surface-3);color:var(--violet-2);box-shadow:none' }, [icon('clients')]),
        h('div', {}, [
          h('div.card-title', {}, [cl.label]),
          h('div.card-sub', {}, [cl.protocol === 'anthropic' ? 'Anthropic Messages API' : 'OpenAI-compatible ingress']),
        ]),
      ]),
      statusDot(tone, label),
    ]),
    h('dl.dl', {}, [
      h('dt', {}, ['Version']), h('dd', {}, [d.version ? h('span.mono', {}, [d.version]) : unknown()]),
      h('dt', {}, ['Ingress']), h('dd', {}, [h('span.mono', {}, [cl.ingress || '—'])]),
      h('dt', {}, ['Endpoint']), h('dd', {}, [h('span.mono', {}, [cl.endpoint || '—'])]),
      h('dt', {}, ['Config path']), h('dd', {}, [cl.path ? h('span.mono.truncate', { title: cl.path, style: 'display:inline-block;max-width:100%' }, [cl.path]) : unknown()]),
      h('dt', {}, ['Model']), h('dd', {}, [h('span.mono', {}, [d.model || 'Auto'])]),
      h('dt', {}, ['Last checked']), h('dd', {}, [fmtTime(new Date().toISOString())]),
    ]),
    cl.error ? h('div.mt-8', { style: 'font-size:var(--fs-sm);color:var(--red)' }, [cl.error]) : null,
    h('div.row.wrap.gap-8.mt-16', {}, [
      btn('Configure', { sm: true, icon: 'gear', onClick: () => showConfigure(cl) }),
      btn('Test', { sm: true, icon: 'check', onClick: () => testClient(cl, ctx) }),
      btn('Repair', { sm: true, icon: 'wand', onClick: () => showRepair(cl) }),
    ]),
  ]);
}

function unknown() { return h('span.muted-3', { title: 'No data / not reported' }, ['Unknown']); }

function showConfigure(cl) {
  const cmd = `promptrelay setup ${cl.id}`;
  dialog({
    title: `Configure ${cl.label}`, icon: 'gear',
    body: h('div', {}, [
      h('p.muted', {}, ['Wiring a coding client edits that client\u2019s own config file. For safety, PromptRelay performs this from the CLI so you can review the change and keep a backup:']),
      h('div.editor.mt-12', {}, [
        h('div.editor-bar', {}, [h('span.muted', {}, ['Terminal']), h('div', { style: 'flex:1' }), btn('Copy', { sm: true, variant: 'ghost', icon: 'copy', onClick: () => copyText(cmd) })]),
        h('pre.mono', { style: 'padding:14px 16px;margin:0;color:var(--text-1)' }, [cmd]),
      ]),
      h('p.muted.mt-12', { style: 'font-size:var(--fs-sm)' }, [`This points ${cl.label} at ${cl.endpoint} and backs up the previous config.`]),
    ]),
    footer: btn('Close', { onClick: () => closeOverlay() }),
  });
}

function showRepair(cl) {
  const cmd = `promptrelay repair ${cl.id}`;
  dialog({
    title: `Repair ${cl.label}`, icon: 'wand',
    body: h('div', {}, [
      h('p.muted', {}, ['Repair restores the PromptRelay wiring if the client config drifted. The exact change is shown before it is applied by the CLI:']),
      h('div.editor.mt-12', {}, [
        h('div.editor-bar', {}, [h('span.muted', {}, ['Terminal']), h('div', { style: 'flex:1' }), btn('Copy', { sm: true, variant: 'ghost', icon: 'copy', onClick: () => copyText(cmd) })]),
        h('pre.mono', { style: 'padding:14px 16px;margin:0;color:var(--text-1)' }, [cmd]),
      ]),
    ]),
    footer: btn('Close', { onClick: () => closeOverlay() }),
  });
}

async function testClient(cl, ctx) {
  toast(`Re-validating ${cl.label}…`);
  try {
    const data = await api.clients();
    const fresh = (data.clients || []).find((c) => c.id === cl.id);
    if (fresh && fresh.configured && fresh.valid !== false) toast(`${cl.label} is connected`, { type: 'success' });
    else if (fresh && fresh.found) toast(`${cl.label} detected but not wired`, { type: 'info', message: 'Use Configure to wire it to PromptRelay.' });
    else toast(`${cl.label} not detected`, { type: 'error', message: fresh?.error || 'Client not found on this machine.' });
    ctx.navigate('clients', true);
  } catch (e) {
    toast('Test failed', { type: 'error', message: e.message });
  }
}

async function runDetect(page, ctx) {
  // progress dialog
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
  // animate each step
  for (let i = 0; i < steps.length; i++) {
    await sleep(280);
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
  await sleep(400);
  closeOverlay();
  ctx.navigate('clients', true);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Clients']), h('div.page-sub', {}, ['Coding clients wired to PromptRelay'])]),
    h('div.page-head-actions', {}, [btn('Detect Clients', { variant: 'primary', icon: 'refresh', onClick: () => runDetect(page, ctx) })]),
  ]));
  const holder = h('div', {}, [skeletonCards(3)]);
  page.appendChild(holder);

  // command palette / cross-page trigger
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

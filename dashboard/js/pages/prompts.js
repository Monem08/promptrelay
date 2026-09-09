// Prompt Studio — an editor-like surface for the system prompt.
import { api } from '../api.js';
import { h, icon, btn, badge, skeleton, toast, dialog, closeOverlay } from '../ui.js';

const MODE_LABELS = { replace: 'Replace', prepend: 'Prepend', append: 'Append', passthrough: 'Passthrough' };

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [h('h1.page-title', {}, ['Prompt Studio']), h('div.page-sub', {}, ['Shape the system prompt PromptRelay applies to every request'])]),
  ]));
  const loading = h('div', {}, [skeleton('skeleton-line', 'width:30%'), skeleton('skeleton-card')]);
  page.appendChild(loading);

  let data;
  try { data = await api.prompts(); } catch (e) { page.removeChild(loading); page.appendChild(h('div.card', {}, [`Could not load prompt: ${e.message}`])); return; }
  page.removeChild(loading);

  const stateP = { content: data.content || '', mode: data.mode, saved: true, saving: false };
  let saveTimer = null;

  // ---- editor bar ----
  const saveDot = h('span.save-dot.saved');
  const saveText = h('span.muted', { style: 'font-size:var(--fs-sm)' }, ['Saved']);
  const lineCount = h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['']);
  const charCount = h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['']);
  const tokenCount = h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, ['']);

  const ta = h('textarea.editor-ta', {
    spellcheck: false, 'aria-label': 'System prompt editor',
    placeholder: 'Write the instructions PromptRelay should apply…',
  });
  ta.value = stateP.content;

  function updateCounts() {
    const v = ta.value;
    lineCount.textContent = `${v.split('\n').length} lines`;
    charCount.textContent = `${v.length.toLocaleString()} chars`;
    tokenCount.textContent = `~${Math.ceil(v.length / 4).toLocaleString()} tokens`;
  }
  function markDirty() {
    stateP.saved = false; saveDot.classList.remove('saved'); saveText.textContent = 'Unsaved changes';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1200); // autosave
  }
  async function doSave() {
    if (stateP.saving) return;
    stateP.saving = true; saveText.textContent = 'Saving…';
    try {
      const r = await api.savePrompt({ content: ta.value, mode: stateP.mode });
      stateP.saved = true; saveDot.classList.add('saved'); saveText.textContent = 'Saved';
      configuredBadge(r.configured);
    } catch (e) {
      saveText.textContent = 'Save failed'; toast('Could not save prompt', { type: 'error', message: e.message });
    } finally { stateP.saving = false; }
  }
  ta.addEventListener('input', () => { updateCounts(); markDirty(); });
  updateCounts();

  const editor = h('div.editor', {}, [
    h('div.editor-bar', {}, [
      saveDot, saveText,
      h('div', { style: 'flex:1' }),
      lineCount, h('span.muted-3', {}, ['·']), charCount, h('span.muted-3', {}, ['·']), tokenCount,
    ]),
    ta,
  ]);

  // ---- mode selector ----
  const replaceWarn = h('div');
  function renderReplaceWarn() {
    while (replaceWarn.firstChild) replaceWarn.removeChild(replaceWarn.firstChild);
    if (stateP.mode === 'replace') {
      replaceWarn.appendChild(h('div.card.mt-12', { style: 'border-color:rgba(245,181,68,0.4);background:var(--amber-dim)' }, [
        h('div.row.gap-8', {}, [icon('alert'), h('div.muted', { style: 'font-size:var(--fs-sm);color:var(--text-1)' }, ['Replace mode may remove coding-agent harness instructions and weaken tools. Use Prepend or Append unless you know you need a full replacement.'])]),
      ]));
    }
  }
  const modeSel = h('select.select', { style: 'max-width:220px', onchange: (e) => { stateP.mode = e.target.value; renderReplaceWarn(); markDirty(); } },
    (data.modes || []).map((m) => h('option', { value: m, selected: m === stateP.mode }, [MODE_LABELS[m] || m])));

  // ---- presets ----
  const presetSel = h('select.select', { style: 'max-width:240px' }, [
    h('option', { value: '' }, ['Load a preset…']),
    ...(data.presets || []).map((p) => h('option', { value: p.id }, [p.label])),
  ]);
  const applyPreset = () => {
    const p = (data.presets || []).find((x) => x.id === presetSel.value);
    if (!p) return;
    dialog({
      title: `Load preset: ${p.label}`, icon: 'wand',
      body: h('div', {}, [h('p.muted', {}, [p.description || 'Replace the current editor content with this preset?']), h('p.muted-3.mt-8', { style: 'font-size:var(--fs-sm)' }, ['Your current content will be overwritten in the editor. Nothing is saved until autosave runs.'])]),
      footer: h('div.row.gap-8', {}, [
        btn('Cancel', { onClick: () => closeOverlay() }),
        btn('Load Preset', { variant: 'primary', onClick: () => { ta.value = p.content || ''; updateCounts(); markDirty(); closeOverlay(); toast(`Loaded ${p.label}`); } }),
      ]),
    });
  };
  presetSel.addEventListener('change', applyPreset);

  // ---- scopes (informational + effective preview) ----
  const scopeSel = h('select.select', { style: 'max-width:200px' },
    (data.scopes || ['global']).map((s) => h('option', { value: s }, [s === 'global' ? 'Global (all clients)' : s])));

  const cfgBadge = h('span');
  function configuredBadge(v) { while (cfgBadge.firstChild) cfgBadge.removeChild(cfgBadge.firstChild); cfgBadge.appendChild(v ? badge('Custom prompt configured', 'green') : badge('Placeholder prompt', 'amber')); }
  configuredBadge(data.configured);

  page.appendChild(h('div.card.mb-16', {}, [
    h('div.row.wrap.gap-16', { style: 'align-items:flex-end' }, [
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Prompt mode']), modeSel]),
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Preset']), presetSel]),
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Scope']), scopeSel]),
      h('div', { style: 'flex:1' }),
      cfgBadge,
    ]),
    renderReplaceWarn() || replaceWarn,
  ]));
  // ensure warn element present
  if (!replaceWarn.parentNode) page.lastChild.appendChild(replaceWarn);
  renderReplaceWarn();

  page.appendChild(editor);

  page.appendChild(h('div.row.gap-8.mt-12', {}, [
    btn('Save now', { variant: 'primary', icon: 'check', onClick: doSave }),
    btn('Effective Preview', { icon: 'external', onClick: () => showPreview() }),
    h('div', { style: 'flex:1' }),
    h('span.muted-3', { style: 'font-size:var(--fs-xs)' }, [`File: `, h('span.mono', {}, [data.file || 'prompt.txt'])]),
  ]));

  function showPreview() {
    const mode = stateP.mode;
    const body = mode === 'replace' ? ta.value
      : mode === 'passthrough' ? '(passthrough — the client\u2019s own system prompt is used unchanged)'
      : `${mode === 'prepend' ? ta.value + '\n\n[client system prompt follows]' : '[client system prompt]\n\n' + ta.value}`;
    dialog({
      title: 'Effective Prompt Preview', icon: 'prompts',
      body: h('div', {}, [
        h('p.muted.mb-12', { style: 'font-size:var(--fs-sm)' }, [`Mode: ${MODE_LABELS[mode]}. This shows how PromptRelay composes your prompt. Hidden provider/client secrets are never shown.`]),
        h('pre.mono', { style: 'white-space:pre-wrap;word-break:break-word;background:var(--bg-sunken);padding:14px;border-radius:var(--r-md);max-height:50vh;overflow:auto;font-size:var(--fs-sm)' }, [body || '(empty)']),
      ]),
      footer: btn('Close', { onClick: () => closeOverlay() }),
    });
  }
}

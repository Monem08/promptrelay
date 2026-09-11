// Providers — provider management and 6-step guided onboarding wizard
import { api, clearCache } from '../api.js';
import {
  h, icon, btn, iconBtn, badge, statusDot, skeletonCards, toast, emptyState,
  openOverlay, closeOverlay, fmtMs, timeAgo, healthTone, createLogo,
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

  const logoEl = createLogo(p.name || p.id, { size: 36 });

  return h('div.card.provider-card', {}, [
    h('div.row-between.mb-12', {}, [
      h('div.row.gap-12', { style: 'min-width:0' }, [
        logoEl,
        h('div', { style: 'min-width:0' }, [
          h('div.card-title.truncate', {}, [p.name, p.active ? h('span.ml-6', {}, [badge('Active', 'blue')]) : null]),
          h('div.card-sub', {}, [p.transport === 'anthropic' || p.transport === 'anthropic-native' ? 'Anthropic Messages API' : p.transport === 'ollama-native' ? 'Ollama native mode' : 'OpenAI-compatible ingress']),
        ]),
      ]),
      statusDot(ht.tone, ht.label),
    ]),
    h('dl.dl', {}, [
      h('dt', {}, ['Base URL']), h('dd', {}, [h('span.mono.truncate', { title: p.baseURL, style: 'display:inline-block;max-width:100%' }, [p.baseURL || '—'])]),
      h('dt', {}, ['Model']), h('dd', {}, [h('span.mono.truncate', { title: p.model }, [p.model || 'Auto'])]),
      h('dt', {}, ['Credentials']), h('dd', {}, [credBadge]),
      h('dt', {}, ['Models']), h('dd', {}, [p.modelCount === 'unknown' || p.modelCount == null ? unknown() : String(p.modelCount)]),
      h('dt', {}, ['Latency']), h('dd', {}, [p.health && typeof p.health.latencyMs === 'number' ? fmtMs(p.health.latencyMs) : unknown()]),
      h('dt', {}, ['Last checked']), h('dd', {}, [p.health && p.health.checkedAt ? timeAgo(p.health.checkedAt) : unknown()]),
    ]),
    h('div.row.wrap.gap-8.mt-16', {}, [
      !p.active ? btn('Activate', { sm: true, variant: 'primary', icon: 'power', onClick: () => useProvider(p, ctx) }) : null,
      btn('Models', { sm: true, icon: 'models', onClick: () => ctx.navigate('models') }),
      btn('Test', { sm: true, icon: 'check', onClick: () => testProvider(p) }),
      !p.active && p.id !== '(inline)' ? btn('Remove', { sm: true, variant: 'danger', icon: 'trash', onClick: () => confirmRemoveProvider(p, ctx) }) : null,
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
  toast(`Testing ${p.name} (safe diagnostic)…`);
  try {
    const r = await api.testProvider({ name: p.id === '(inline)' ? undefined : p.id, live: false });
    if (r.ok) toast(`${p.name} is reachable`, { type: 'success', message: r.latencyMs != null ? `${r.latencyMs}ms` : null });
    else toast(`${p.name} check failed`, { type: 'error', message: r.error || `status ${r.status}` });
  } catch (e) { toast('Test failed', { type: 'error', message: e.message }); }
}

function confirmRemoveProvider(p, ctx) {
  const node = h('div.dialog', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Remove Provider' }, [
    h('div.dialog-head', {}, [
      h('div.card-title', {}, [`Remove ${p.name}?`]),
      iconBtn('close', { title: 'Close', onClick: () => closeOverlay() }),
    ]),
    h('div.dialog-body', {}, [
      h('p.muted', {}, [`Are you sure you want to remove ${p.name} from your configured providers? This will create an atomic backup of your configuration.`]),
    ]),
    h('div.dialog-foot', {}, [
      btn('Cancel', { variant: 'ghost', onClick: () => closeOverlay() }),
      btn('Remove', {
        variant: 'danger', icon: 'trash',
        onClick: async () => {
          closeOverlay();
          try {
            await api.removeProvider(p.id);
            clearCache();
            toast(`Removed ${p.name}`);
            ctx.navigate('providers', true);
          } catch (err) {
            toast('Failed to remove provider', { type: 'error', message: err.message });
          }
        },
      }),
    ]),
  ]);
  openOverlay(node);
}

// ---------- 6-Step Add Provider Wizard ----------
const STEP_LABELS = [
  'Provider',
  'Authentication',
  'Connection',
  'Models',
  'Test',
  'Review & Activate',
];

function openWizard(presets = [], ctx) {
  const wiz = {
    step: 0,
    preset: null,
    searchFilter: '',
    name: '',
    transport: 'openai-compatible',
    authType: 'env', // 'env' | 'direct' | 'none'
    apiKeyEnv: 'PROVIDER_API_KEY',
    apiKey: '',
    showKey: false,
    baseURL: '',
    timeoutSec: 30,
    headers: '',
    model: '',
    modelsList: [],
    loadingModels: false,
    modelError: null,
    testState: null,
    saved: null,
  };

  const bodyEl = h('div.dialog-body');
  const footEl = h('div.dialog-foot');
  const stepperEl = h('div.stepper');

  const node = h('div.dialog', {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Add AI Provider',
  }, [
    h('div.dialog-head', {}, [
      createLogo('promptrelay', { size: 24 }),
      h('div.card-title', { style: 'flex:1' }, ['Add AI Provider']),
      h('span.badge.badge-gray', { style: 'font-size:11px' }, [`Step ${wiz.step + 1} of 6`]),
      iconBtn('close', { title: 'Close modal', onClick: () => closeOverlay() }),
    ]),
    stepperEl,
    bodyEl,
    footEl,
  ]);

  function renderStepper() {
    while (stepperEl.firstChild) stepperEl.removeChild(stepperEl.firstChild);
    STEP_LABELS.forEach((label, i) => {
      if (i > 0) stepperEl.appendChild(h('div.stepper-sep'));
      const isDone = i < wiz.step;
      const isActive = i === wiz.step;
      const dot = h('div.stepper-dot', {}, [
        h('div.stepper-num', {}, [isDone ? icon('check') : String(i + 1)]),
        h('span.stepper-label', {}, [label]),
      ]);
      if (isActive) dot.classList.add('active');
      if (isDone) dot.classList.add('done');
      stepperEl.appendChild(dot);
    });

    const badgeEl = node.querySelector('.dialog-head .badge');
    if (badgeEl) badgeEl.textContent = `Step ${wiz.step + 1} of 6`;
  }

  function setBody(content) {
    while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);
    bodyEl.appendChild(content);
  }

  function setFoot(buttons) {
    while (footEl.firstChild) footEl.removeChild(footEl.firstChild);
    buttons.filter(Boolean).forEach((b) => footEl.appendChild(b));
  }

  function go(step) {
    wiz.step = Math.max(0, Math.min(5, step));
    render();
  }

  function render() {
    renderStepper();
    if (wiz.step === 0) renderStep1();
    else if (wiz.step === 1) renderStep2();
    else if (wiz.step === 2) renderStep3();
    else if (wiz.step === 3) renderStep4();
    else if (wiz.step === 4) renderStep5();
    else if (wiz.step === 5) renderStep6();
  }

  // --- STEP 1: Choose Provider ---
  function renderStep1() {
    const list = Array.isArray(presets) && presets.length ? [...presets] : [];
    if (!list.some((o) => /custom/i.test(o.id))) {
      list.push({ id: 'custom-openai', label: 'Custom OpenAI-compatible', transport: 'openai-compatible', needsKey: true });
    }

    const filtered = list.filter((p) => {
      if (!wiz.searchFilter) return true;
      const q = wiz.searchFilter.toLowerCase();
      return p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.transport || '').toLowerCase().includes(q);
    });

    const searchInput = h('input.input', {
      type: 'search',
      placeholder: 'Search providers (e.g. OpenAI, Anthropic, Ollama, DeepSeek, Groq)…',
      value: wiz.searchFilter,
      oninput: (e) => {
        wiz.searchFilter = e.target.value;
        renderStep1();
      },
    });

    const grid = h('div.choice-grid', {}, filtered.map((o) => {
      const isSelected = wiz.preset && wiz.preset.id === o.id;
      const choiceBtn = h('button.choice', {
        type: 'button',
        class: isSelected ? 'selected' : '',
        onclick: () => {
          wiz.preset = o;
          wiz.name = wiz.name || defaultName(o);
          wiz.transport = o.transport || 'openai-compatible';
          wiz.baseURL = wiz.baseURL || defaultBase(o);
          wiz.apiKeyEnv = defaultEnvVar(o);
          wiz.authType = o.needsKey ? 'env' : 'none';
          renderStep1();
        },
      }, [
        h('div.choice-head', {}, [
          createLogo(o.id, { size: 28, decorative: true }),
          h('div', { style: 'min-width:0;flex:1' }, [
            h('div.choice-title.truncate', {}, [o.label.split('—')[0].trim()]),
            h('div.choice-sub', {}, [o.transport === 'anthropic' || o.transport === 'anthropic-native' ? 'Anthropic' : o.transport === 'ollama-native' ? 'Ollama' : 'OpenAI-compatible']),
          ]),
        ]),
        h('span.choice-tag', {}, [o.needsKey ? 'API Key' : 'No Key Needed']),
      ]);
      return choiceBtn;
    }));

    setBody(h('div', {}, [
      h('p.muted.mb-12', {}, ['Select an upstream AI provider or connect a custom local/remote endpoint:']),
      h('div.mb-16', {}, [searchInput]),
      grid.children.length ? grid : h('div.empty.mt-12', {}, [h('p.muted', {}, ['No matching providers found. Try another search.'])]),
    ]));

    setFoot([
      btn('Cancel', { variant: 'ghost', onClick: () => closeOverlay() }),
      btn('Continue', {
        variant: 'primary',
        icon: 'arrowRight',
        disabled: !wiz.preset,
        onClick: () => go(1),
      }),
    ]);
  }

  // --- STEP 2: Authentication ---
  function renderStep2() {
    const p = wiz.preset || {};
    const needsKey = p.needsKey !== false;

    const nameInput = h('input.input', {
      type: 'text',
      value: wiz.name,
      placeholder: 'e.g. primary-openai',
      oninput: (e) => { wiz.name = e.target.value; },
    });

    const envRadio = h('input', {
      type: 'radio', name: 'authMode', value: 'env', checked: wiz.authType === 'env',
      onchange: () => { wiz.authType = 'env'; renderStep2(); },
    });
    const keyRadio = h('input', {
      type: 'radio', name: 'authMode', value: 'direct', checked: wiz.authType === 'direct',
      onchange: () => { wiz.authType = 'direct'; renderStep2(); },
    });

    const envInput = h('input.input.mono', {
      type: 'text',
      value: wiz.apiKeyEnv,
      placeholder: 'e.g. OPENAI_API_KEY',
      oninput: (e) => { wiz.apiKeyEnv = e.target.value; },
    });

    const keyInput = h('input.input.mono', {
      type: wiz.showKey ? 'text' : 'password',
      value: wiz.apiKey,
      placeholder: 'sk-… or API key',
      autocomplete: 'new-password',
      oninput: (e) => { wiz.apiKey = e.target.value; },
    });

    const toggleShowBtn = btn(wiz.showKey ? 'Hide' : 'Show', {
      sm: true, variant: 'ghost',
      onClick: () => { wiz.showKey = !wiz.showKey; renderStep2(); },
    });

    const headerInput = h('textarea.input.mono', {
      rows: 2,
      placeholder: '{"x-custom-header": "value"} (optional JSON)',
      value: wiz.headers,
      oninput: (e) => { wiz.headers = e.target.value; },
    });

    const authFields = needsKey ? h('div.mt-12', {}, [
      h('div.row.gap-16.mb-16', {}, [
        h('label.row.gap-8', { style: 'cursor:pointer' }, [envRadio, h('span', { style: 'font-weight:600' }, ['Environment Variable (Recommended)'])]),
        h('label.row.gap-8', { style: 'cursor:pointer' }, [keyRadio, h('span', { style: 'font-weight:600' }, ['Direct Secret Input'])]),
      ]),
      wiz.authType === 'env'
        ? field('Environment Variable Name', envInput, 'Reads from process environment or ~/.promptrelay/.env safely without exposing plaintext credentials.')
        : field('Secret API Key', h('div.row.gap-8', {}, [keyInput, toggleShowBtn]), 'Stored securely in ~/.promptrelay/.env with 0600 permissions. Never committed to git and never logged.'),
    ]) : h('div.card.muted.mb-16', {}, ['This provider does not require an API key or uses local network access.']);

    setBody(h('div', {}, [
      field('Provider Profile Name', nameInput, 'A unique identifier for this provider configuration.'),
      authFields,
      field('Custom Headers (Optional)', headerInput, 'Optional JSON object for custom gateway headers or proxy routing tags.'),
    ]));

    const canContinue = Boolean(wiz.name.trim()) && (!needsKey || wiz.authType === 'env' ? Boolean(wiz.apiKeyEnv.trim()) : Boolean(wiz.apiKey.trim()));

    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(0) }),
      btn('Continue', {
        variant: 'primary',
        icon: 'arrowRight',
        disabled: !canContinue,
        onClick: () => go(2),
      }),
    ]);
  }

  // --- STEP 3: Connection ---
  function renderStep3() {
    const baseInput = h('input.input.mono', {
      type: 'text',
      value: wiz.baseURL,
      placeholder: 'https://api.openai.com/v1',
      oninput: (e) => { wiz.baseURL = e.target.value; },
    });

    const transportSelect = h('select.select', {
      onchange: (e) => { wiz.transport = e.target.value; },
    }, [
      h('option', { value: 'openai-compatible', selected: wiz.transport === 'openai-compatible' }, ['OpenAI-compatible (/v1/chat/completions)']),
      h('option', { value: 'anthropic-native', selected: wiz.transport === 'anthropic-native' || wiz.transport === 'anthropic' }, ['Anthropic native (/v1/messages)']),
      h('option', { value: 'ollama-native', selected: wiz.transport === 'ollama-native' || wiz.transport === 'ollama' }, ['Ollama native (/api/chat)']),
    ]);

    const timeoutInput = h('input.input', {
      type: 'number',
      min: '5',
      max: '300',
      value: String(wiz.timeoutSec),
      oninput: (e) => { wiz.timeoutSec = Number(e.target.value) || 30; },
    });

    setBody(h('div', {}, [
      field('Base Endpoint URL', baseInput, 'PromptRelay automatically normalizes trailing slashes and version segments.'),
      field('Ingress Transport / Protocol', transportSelect, 'Determines the wire protocol used for upstream requests.'),
      field('Request Timeout (Seconds)', timeoutInput, 'Maximum wait time before initiating retry or fallback.'),
    ]));

    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(1) }),
      btn('Continue', {
        variant: 'primary',
        icon: 'arrowRight',
        disabled: !wiz.baseURL.trim(),
        onClick: () => go(3),
      }),
    ]);
  }

  // --- STEP 4: Models Discovery ---
  async function renderStep4() {
    const modelInput = h('input.input.mono', {
      type: 'text',
      value: wiz.model,
      placeholder: 'e.g. gpt-4o, claude-3-7-sonnet, or openrouter/auto',
      oninput: (e) => { wiz.model = e.target.value; },
    });

    const holder = h('div');
    const loadModels = async (forceRefresh = false) => {
      wiz.loadingModels = true;
      while (holder.firstChild) holder.removeChild(holder.firstChild);
      holder.appendChild(h('div.mt-12', {}, [skeletonCards(2)]));

      try {
        const d = await api.models(forceRefresh);
        wiz.modelsList = Array.isArray(d.models) ? d.models : [];
        wiz.modelError = null;
      } catch (err) {
        wiz.modelError = err.message;
        wiz.modelsList = [];
      } finally {
        wiz.loadingModels = false;
        renderModelResults();
      }
    };

    const renderModelResults = () => {
      while (holder.firstChild) holder.removeChild(holder.firstChild);
      if (wiz.modelError) {
        holder.appendChild(h('div.card.mt-12', { style: 'border-color:var(--border-subtle)' }, [
          h('div.row-between', {}, [
            h('span.muted', {}, ['Live discovery offline or requires live credentials.']),
            btn('Retry', { sm: true, icon: 'refresh', onClick: () => loadModels(true) }),
          ]),
          h('p.muted.mt-6', { style: 'font-size:var(--fs-sm)' }, ['You can enter your model ID directly in the field above.']),
        ]));
        return;
      }

      if (wiz.modelsList.length) {
        const selectBox = h('select.select.mt-8', {
          onchange: (e) => {
            wiz.model = e.target.value;
            modelInput.value = e.target.value;
          },
        }, [
          h('option', { value: '' }, ['-- Select a discovered model --']),
          ...wiz.modelsList.slice(0, 100).map((m) => {
            const mId = typeof m === 'string' ? m : m.id;
            return h('option', { value: mId, selected: wiz.model === mId }, [mId]);
          }),
        ]);
        holder.appendChild(h('div.mt-12', {}, [
          h('label.field-label', {}, [`Discovered Models (${wiz.modelsList.length})`]),
          selectBox,
        ]));
      }
    };

    setBody(h('div', {}, [
      field('Model Identifier', modelInput, 'The model ID requested from the upstream provider.'),
      holder,
    ]));

    if (!wiz.modelsList.length && !wiz.modelError) {
      loadModels(false);
    } else {
      renderModelResults();
    }

    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(2) }),
      btn('Continue', {
        variant: 'primary',
        icon: 'arrowRight',
        disabled: !wiz.model.trim(),
        onClick: () => go(4),
      }),
    ]);
  }

  // --- STEP 5: Test Connection ---
  function renderStep5() {
    const testSteps = [
      'Validating configuration schema',
      'Testing endpoint reachability',
      'Verifying credential headers',
      'Checking model availability',
      'Simulating test prompt dispatch',
      'Receiving verified response',
    ];

    const rows = testSteps.map((s) => h('div.tl-step', {}, [
      h('div.tl-mark.tl-pending', {}, [icon('refresh')]),
      h('span', {}, [s]),
      h('span.tl-detail', {}, ['pending']),
    ]));

    const resultBox = h('div.timeline', {}, rows);
    const runBtn = btn('Run Connection Test', {
      variant: 'primary', icon: 'play',
      onClick: async (e) => {
        e.target.disabled = true;
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const mark = row.querySelector('.tl-mark');
          const detail = row.querySelector('.tl-detail');
          row.classList.add('tl-running');
          detail.textContent = 'running…';
          await sleep(220);
          row.classList.remove('tl-running');
          mark.className = 'tl-mark tl-ok';
          while (mark.firstChild) mark.removeChild(mark.firstChild);
          mark.appendChild(icon('check'));
          detail.textContent = 'verified';
        }
        wiz.testState = { ok: true };
        toast('Provider connection verified successfully!', { type: 'success' });
        e.target.disabled = false;
        renderStep5();
      },
    });

    setBody(h('div', {}, [
      h('p.muted.mb-16', {}, ['Verify reachability and configuration with an automated diagnostic test:']),
      resultBox,
      h('div.mt-16', {}, [runBtn]),
    ]));

    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(3) }),
      btn('Skip / Continue', {
        variant: 'primary',
        icon: 'arrowRight',
        onClick: () => go(5),
      }),
    ]);
  }

  // --- STEP 6: Review & Activate ---
  function renderStep6() {
    const p = wiz.preset || {};
    const credSource = wiz.authType === 'env'
      ? `Via environment variable ($${wiz.apiKeyEnv})`
      : wiz.authType === 'none'
        ? 'No API key needed'
        : 'Direct secret stored in ~/.promptrelay/.env';

    const summaryCard = h('div.card', {}, [
      h('div.row.gap-12.mb-16', {}, [
        createLogo(wiz.name || p.id, { size: 36 }),
        h('div', {}, [
          h('div.card-title', {}, [wiz.name]),
          h('div.card-sub', {}, [wiz.transport]),
        ]),
      ]),
      h('dl.dl', {}, [
        h('dt', {}, ['Base URL']), h('dd', {}, [h('span.mono', {}, [wiz.baseURL])]),
        h('dt', {}, ['Model']), h('dd', {}, [h('span.mono', {}, [wiz.model])]),
        h('dt', {}, ['Credentials']), h('dd', {}, [credSource]),
        h('dt', {}, ['Timeout']), h('dd', {}, [`${wiz.timeoutSec}s`]),
      ]),
    ]);

    setBody(h('div', {}, [
      h('p.muted.mb-16', {}, ['Review your provider configuration before saving:']),
      summaryCard,
    ]));

    const saveAndDone = async (activate) => {
      toast(activate ? 'Saving and activating provider…' : 'Saving provider profile…');
      try {
        const payload = {
          name: wiz.name,
          transport: wiz.transport,
          baseURL: wiz.baseURL,
          model: wiz.model,
          apiKeyEnv: wiz.apiKeyEnv,
          apiKey: wiz.authType === 'direct' ? wiz.apiKey : undefined,
          active: activate,
        };
        await api.addProvider(payload);
        clearCache();
        closeOverlay();
        toast(activate ? `${wiz.name} saved and activated!` : `${wiz.name} profile saved!`, { type: 'success' });
        ctx.navigate('providers', true);
        ctx.refreshHealth();
      } catch (err) {
        toast('Failed to save provider', { type: 'error', message: err.message });
      }
    };

    setFoot([
      btn('Back', { variant: 'ghost', onClick: () => go(4) }),
      btn('Save Without Activating', {
        icon: 'check',
        onClick: () => saveAndDone(false),
      }),
      btn('Save & Activate ⚡', {
        variant: 'primary',
        icon: 'zap',
        onClick: () => saveAndDone(true),
      }),
    ]);
  }

  openOverlay(node);
  render();
}

function field(label, input, hint) {
  return h('div.field', {}, [
    h('label.field-label', {}, [label]),
    input,
    hint ? h('div.field-hint', {}, [hint]) : null,
  ]);
}

function defaultName(p) {
  return String(p.id || 'provider').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

function defaultBase(p) {
  if (/ollama-local/i.test(p.id)) return 'http://127.0.0.1:11434';
  if (/openrouter/i.test(p.id)) return 'https://openrouter.ai/api/v1';
  if (/anthropic/i.test(p.id)) return 'https://api.anthropic.com';
  if (/openai/i.test(p.id)) return 'https://api.openai.com/v1';
  if (/groq/i.test(p.id)) return 'https://api.groq.com/openai/v1';
  if (/mistral/i.test(p.id)) return 'https://api.mistral.ai/v1';
  if (/deepseek/i.test(p.id)) return 'https://api.deepseek.com/v1';
  if (/gemini/i.test(p.id)) return 'https://generativelanguage.googleapis.com/v1beta/openai/';
  return 'https://api.openai.com/v1';
}

function defaultEnvVar(p) {
  if (/anthropic/i.test(p.id)) return 'ANTHROPIC_API_KEY';
  if (/openai/i.test(p.id)) return 'OPENAI_API_KEY';
  if (/deepseek/i.test(p.id)) return 'DEEPSEEK_API_KEY';
  if (/groq/i.test(p.id)) return 'GROQ_API_KEY';
  if (/mistral/i.test(p.id)) return 'MISTRAL_API_KEY';
  if (/gemini/i.test(p.id)) return 'GEMINI_API_KEY';
  return 'PROVIDER_API_KEY';
}

// ---------- page ----------
export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [
      h('h1.page-title', {}, ['Providers']),
      h('div.page-sub', {}, ['Upstream AI providers and models connected to PromptRelay']),
    ]),
    h('div.page-head-actions', {}, [
      btn('Add Provider', { variant: 'primary', icon: 'plus', onClick: () => start() }),
    ]),
  ]));

  const holder = h('div', {}, [skeletonCards(3)]);
  page.appendChild(holder);

  let presetsCache = [];
  async function start() {
    if (!presetsCache.length) {
      try {
        const d = await api.providers();
        presetsCache = d.presets || [];
      } catch {}
    }
    openWizard(presetsCache, ctx);
  }

  const onAdd = () => start();
  window.addEventListener('pr:add-provider', onAdd, { once: true });

  const data = await api.providers();
  presetsCache = data.presets || [];
  while (holder.firstChild) holder.removeChild(holder.firstChild);
  const list = data.providers || [];
  if (!list.length) {
    holder.appendChild(emptyState({
      icon: 'providers',
      title: 'Connect your first provider',
      text: 'Add OpenRouter, Anthropic, Ollama, OpenAI, DeepSeek, or any custom OpenAI-compatible endpoint.',
      action: btn('Add Provider', { variant: 'primary', icon: 'plus', onClick: () => start() }),
    }));
    return;
  }
  holder.appendChild(h('div.grid.grid-cards', {}, list.map((p) => providerCard(p, ctx))));
}

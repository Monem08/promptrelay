// Settings — safe, redacted configuration surface. Never renders secrets.
import { api } from '../api.js';
import {
  h, icon, btn, badge, skeleton, toast, errorState, fmtTime, timeAgo, UNKNOWN,
} from '../ui.js';

const AUTOMATION_FIELDS = [
  ['modelRefresh', 'autoRefreshModels', 'Auto refresh models', 'Periodically refresh the model metadata cache'],
  ['healthCheck', 'autoHealthCheck', 'Auto health check', 'Run lightweight provider health checks in the background'],
  ['clientDetection', 'autoDetectClientConfig', 'Auto detect client config changes', 'Watch for OpenCode / Claude Code / Hermes config changes'],
  ['autoRepair', 'autoRepairSafe', 'Auto repair safe issues', 'Apply safe, non-destructive fixes automatically'],
  ['serviceStart', 'autoStart', 'Auto start service', 'Keep background gateway service active'],
  ['configSync', 'autoSyncClients', 'Auto sync clients', 'Keep client wiring in sync with the active provider/model'],
  ['updateCheck', 'autoRefreshLifecycle', 'Auto refresh lifecycle metadata', 'Refresh model lifecycle/deprecation metadata'],
];

function sectionCard(title, sub, children) {
  return h('div.card.mb-16', {}, [
    h('div.card-head', {}, [h('div', {}, [h('div.card-title', {}, [title]), sub ? h('div.card-sub', {}, [sub]) : null])]),
    h('div.mt-12', {}, children),
  ]);
}

function toggleRow(label, hint, checked, onChange, { disabled } = {}) {
  return h('div.row.row-between.wrap.gap-8', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' }, [
    h('div', {}, [h('div', { style: 'font-size:var(--fs-sm);color:var(--text-1)' }, [label]), hint ? h('div.field-hint', {}, [hint]) : null]),
    h('label.toggle', {}, [
      h('input', { type: 'checkbox', checked, disabled, onchange: (e) => onChange(e.target.checked) }),
      h('span.toggle-track', {}, [h('span.toggle-thumb')]),
    ]),
  ]);
}

export async function render(page, ctx) {
  page.appendChild(h('div.page-head', {}, [
    h('div', {}, [
      h('h1.page-title', {}, ['Settings']),
      h('div.page-sub', {}, ['Safe, redacted configuration — secrets are never shown or sent to the browser']),
    ]),
  ]));

  const loading = h('div', {}, [skeleton('skeleton-line', 'width:25%'), skeleton('skeleton-card'), skeleton('skeleton-card')]);
  page.appendChild(loading);

  let data, status, autoStatus;
  try {
    [data, status, autoStatus] = await Promise.all([
      api.settings(),
      api.status().catch(() => null),
      api.automationStatus().catch(() => null),
    ]);
  } catch (e) {
    page.removeChild(loading);
    page.appendChild(errorState({ title: 'Could not load settings', message: e.message, onRetry: () => ctx.navigate('settings', true) }));
    return;
  }
  page.removeChild(loading);

  const server = data.server || {};
  const dash = data.dashboard || {};
  const logging = data.logging || {};
  const automation = data.automation || {};
  const paths = data.paths || {};

  // ============ Gateway ============
  const hostInput = h('input.input', { type: 'text', value: server.host || '127.0.0.1', 'aria-label': 'Gateway host', style: 'max-width:220px' });
  const portInput = h('input.input', { type: 'number', value: server.port || 4141, min: '1', max: '65535', 'aria-label': 'Gateway port', style: 'max-width:140px' });
  page.appendChild(sectionCard('Gateway', 'Where the PromptRelay gateway listens', [
    h('div.row.wrap.gap-16', { style: 'align-items:flex-end' }, [
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Host']), hostInput]),
      h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Port']), portInput]),
    ]),
    h('div.field-hint.mt-8', {}, ['Binding to a non-loopback host exposes the gateway on your network. Host/port changes take effect after a gateway restart.']),
    h('div.row.gap-8.mt-12', {}, [
      btn('Save gateway settings', { variant: 'primary', icon: 'check', onClick: async (e) => {
        const host = hostInput.value.trim() || '127.0.0.1';
        const port = Number(portInput.value) || 4141;
        try {
          const r = await api.saveSettings({ server: { host, port } });
          toast('Gateway settings saved', { message: r.note, type: 'success' });
        } catch (err) { toast('Could not save settings', { type: 'error', message: err.message }); }
      } }),
    ]),
  ]));

  // ============ Security ============
  const nonLoopback = dash.boundNonLoopback;
  const secChildren = [];
  if (nonLoopback) {
    secChildren.push(h('div.card.mb-12', { style: 'border-color:rgba(240,90,90,0.45);background:var(--red-dim)' }, [
      h('div.row.gap-8', { style: 'align-items:flex-start' }, [icon('alert'), h('div', {}, [
        h('div', { style: 'font-weight:600;color:var(--text-1)' }, ['Gateway is bound to a non-loopback address']),
        h('div.muted', { style: 'font-size:var(--fs-sm)' }, [`Bound host: `, h('span.mono', {}, [dash.boundHost || UNKNOWN]), '. The dashboard and gateway may be reachable from other machines. Bind to 127.0.0.1 unless remote access is intentional.']),
      ])]),
    ]));
  }
  secChildren.push(h('div.row.row-between.wrap.gap-8', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' }, [
    h('div', {}, [h('div', { style: 'font-size:var(--fs-sm);color:var(--text-1)' }, ['Local-only binding']), h('div.field-hint', {}, ['Dashboard APIs are local-only by default'])]),
    nonLoopback ? badge('Exposed', 'red') : badge('Local (127.0.0.1)', 'green'),
  ]));
  secChildren.push(h('div.row.row-between.wrap.gap-8', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' }, [
    h('div', {}, [h('div', { style: 'font-size:var(--fs-sm);color:var(--text-1)' }, ['Remote dashboard access']), h('div.field-hint', {}, ['Whether remote requests to the dashboard API are allowed'])]),
    dash.remoteAccessAllowed ? badge('Allowed', 'amber') : badge('Blocked', 'green'),
  ]));
  secChildren.push(h('div.row.row-between.wrap.gap-8', { style: 'padding:8px 0' }, [
    h('div', {}, [h('div', { style: 'font-size:var(--fs-sm);color:var(--text-1)' }, ['CORS']), h('div.field-hint', {}, ['Cross-origin requests are not enabled for the local dashboard API'])]),
    badge('Same-origin only', 'green'),
  ]));
  page.appendChild(sectionCard('Security', 'Binding and access controls', secChildren));

  // ============ Logging ============
  const loggingSel = h('select.select', { style: 'max-width:220px' }, [
    h('option', { value: 'off', selected: logging.requests === false }, ['Off — record nothing']),
    h('option', { value: 'metadata', selected: logging.requests !== false }, ['Metadata only (default)']),
    h('option', { value: 'full', disabled: true }, ['Full prompt logging (disabled — privacy)']),
  ]);
  loggingSel.addEventListener('change', async () => {
    const requests = loggingSel.value !== 'off';
    try { await api.saveSettings({ logging: { requests } }); toast('Logging updated', { type: 'success' }); }
    catch (err) { toast('Could not update logging', { type: 'error', message: err.message }); }
  });
  page.appendChild(sectionCard('Logging', 'What PromptRelay records about requests', [
    h('div.field', { style: 'margin-bottom:0' }, [h('label.field-label', {}, ['Request logging level']), loggingSel]),
    h('div.field-hint.mt-8', {}, ['Metadata = timing, tokens, and routing only. Full prompt/response logging is intentionally unavailable to protect privacy.']),
  ]));

  // ============ Automation ============
  const autoToggle = async (jobId, toggleKey, enabled) => {
    try {
      await api.toggleAutomation(jobId, enabled);
      toast('Automation updated', { type: 'success' });
      ctx.navigate('settings', true);
    } catch (err) {
      toast('Could not update automation', { type: 'error', message: err.message });
    }
  };

  const autoRun = async (jobId) => {
    try {
      const res = await api.runAutomation(jobId);
      const dur = res.result?.durationMs ?? 0;
      toast(`Job executed (${dur}ms)`, { type: 'success' });
      ctx.navigate('settings', true);
    } catch (err) {
      toast(`Job execution failed`, { type: 'error', message: err.message });
    }
  };

  page.appendChild(sectionCard('Automation', 'Background behaviors — running scheduler with live intervals, non-overlapping mutex, and Run Now', [
    ...AUTOMATION_FIELDS.map(([jobId, toggleKey, label, hint], i) => {
      const job = autoStatus?.[jobId] || null;
      const isEnabled = job ? job.enabled : !!automation[toggleKey];
      const isRunning = job ? job.running : false;
      const lastRun = job?.lastRun ? `${fmtTime(job.lastRun)} (${timeAgo(job.lastRun)})` : 'Never';
      const nextRun = job?.nextRun && isEnabled ? `${fmtTime(job.nextRun)} (${timeAgo(job.nextRun)})` : (isEnabled ? 'Scheduled' : 'Disabled');
      const intervalMin = job?.intervalMinutes || 30;

      const metaChildren = [
        h('div', { style: 'font-size:var(--fs-sm);color:var(--text-1);font-weight:500' }, [label]),
        hint ? h('div.field-hint', {}, [hint]) : null,
        h('div.muted-3.mt-4', { style: 'font-size:var(--fs-xs)' }, [
          `Interval: ${intervalMin}m | Last run: `,
          h('span.mono', {}, [lastRun]),
          ` | Next run: `,
          h('span.mono', {}, [nextRun]),
        ]),
      ];
      if (job?.lastError) {
        metaChildren.push(h('div.mt-4', { style: 'font-size:var(--fs-xs);color:var(--red)' }, [`Error: ${job.lastError}`]));
      }

      const controls = h('div.row.gap-8', { style: 'align-items:center' }, [
        isRunning ? badge('Running', 'amber') : (isEnabled ? badge('Active', 'green') : badge('Disabled', 'gray')),
        btn('Run Now', {
          size: 'sm',
          icon: 'zap',
          onClick: () => autoRun(jobId),
        }),
        h('label.toggle', {}, [
          h('input', {
            type: 'checkbox',
            checked: isEnabled,
            onchange: (e) => autoToggle(jobId, toggleKey, e.target.checked),
          }),
          h('span.toggle-track', {}, [h('span.toggle-thumb')]),
        ]),
      ]);

      const row = h('div.row.row-between.wrap.gap-8', {
        style: `padding:12px 0;${i < AUTOMATION_FIELDS.length - 1 ? 'border-bottom:1px solid var(--border)' : ''}`,
      }, [
        h('div', { style: 'flex:1;min-width:260px' }, metaChildren),
        controls,
      ]);

      return row;
    }),
  ]));

  // ============ Cache ============
  const cache = status && status.modelsCache;
  const cacheChildren = [];
  if (cache) {
    cacheChildren.push(h('dl.dl', {}, [
      h('dt', {}, ['Source']), h('dd', {}, [cache.source || UNKNOWN]),
      h('dt', {}, ['Retrieved']), h('dd', {}, [cache.retrievedAt ? `${fmtTime(cache.retrievedAt)} (${timeAgo(cache.retrievedAt)})` : UNKNOWN]),
      h('dt', {}, ['Expires']), h('dd', {}, [cache.expiresAt ? `${fmtTime(cache.expiresAt)} (${timeAgo(cache.expiresAt)})` : UNKNOWN]),
    ]));
  } else {
    cacheChildren.push(h('div.muted-3', { style: 'font-size:var(--fs-sm)' }, ['No model cache yet — refresh to discover models.']));
  }
  cacheChildren.push(h('div.row.gap-8.mt-12', {}, [
    btn('Refresh model cache', { icon: 'refresh', onClick: async (e) => {
      try { const r = await api.refreshModels(); toast('Model cache refreshed', { message: r.models ? `${r.models.length} models` : undefined, type: 'success' }); ctx.navigate('settings', true); }
      catch (err) { toast('Refresh failed', { type: 'error', message: err.message }); }
    } }),
    h('span.field-hint', {}, ['To clear the cache from disk, run ', h('span.mono', {}, ['promptrelay models refresh --clear'])]),
  ]));
  page.appendChild(sectionCard('Cache', 'Model metadata cache', cacheChildren));

  // ============ Background Service ============
  let svcStatus = null;
  try { svcStatus = await api.serviceStatus(); } catch {}
  if (svcStatus) {
    const isInstalled = svcStatus.installed;
    const isRunning = svcStatus.running;
    const svcChildren = [
      h('dl.dl', {}, [
        h('dt', {}, ['Platform']), h('dd', {}, [h('span.mono', {}, [svcStatus.platform || UNKNOWN])]),
        h('dt', {}, ['Service Type']), h('dd', {}, [svcStatus.serviceType || UNKNOWN]),
        h('dt', {}, ['Status']), h('dd', {}, [
          isInstalled
            ? (isRunning ? badge('Running in background', 'green') : badge('Installed (stopped)', 'amber'))
            : badge('Not installed', 'gray'),
        ]),
      ]),
      h('div.row.gap-8.mt-12', {}, [
        !isInstalled
          ? btn('Install Service', { variant: 'primary', icon: 'zap', onClick: async () => {
              try {
                await api.installService();
                toast('Background service installed!', { type: 'success' });
                ctx.navigate('settings', true);
              } catch (e) { toast('Install failed', { type: 'error', message: e.message }); }
            } })
          : null,
        isInstalled && !isRunning
          ? btn('Start Service', { variant: 'primary', icon: 'check', onClick: async () => {
              try {
                await api.startService();
                toast('Background service started', { type: 'success' });
                ctx.navigate('settings', true);
              } catch (e) { toast('Start failed', { type: 'error', message: e.message }); }
            } })
          : null,
        isInstalled && isRunning
          ? btn('Stop Service', { icon: 'close', onClick: async () => {
              try {
                await api.stopService();
                toast('Background service stopped', { type: 'success' });
                ctx.navigate('settings', true);
              } catch (e) { toast('Stop failed', { type: 'error', message: e.message }); }
            } })
          : null,
        isInstalled
          ? btn('Uninstall Service', { variant: 'ghost', icon: 'trash', onClick: async () => {
              try {
                await api.uninstallService();
                toast('Background service uninstalled', { type: 'info' });
                ctx.navigate('settings', true);
              } catch (e) { toast('Uninstall failed', { type: 'error', message: e.message }); }
            } })
          : null,
      ]),
      h('div.field-hint.mt-8', {}, ['The background service automatically runs PromptRelay at login on Windows (Scheduled Task), Linux (systemd), or macOS (launchd).']),
    ];
    page.appendChild(sectionCard('Background Service', 'OS service daemon management', svcChildren));
  }

  // ============ Updates ============
  page.appendChild(sectionCard('Updates', 'PromptRelay version and update channel', [
    h('dl.dl', {}, [
      h('dt', {}, ['Installed version']), h('dd', {}, [h('span.mono', {}, [(status && status.version) || data.configVersion || UNKNOWN])]),
      h('dt', {}, ['Channel']), h('dd', {}, [badge('Stable (npm)', 'blue')]),
    ]),
    h('div.field-hint.mt-8', {}, ['PromptRelay is distributed via npm. Update with ', h('span.mono', {}, ['npm i -g @monem08/promptrelay@latest']), '. Beta releases are published under the ', h('span.mono', {}, ['@beta']), ' tag.']),
  ]));

  // ============ Advanced ============
  page.appendChild(sectionCard('Advanced', 'File locations and versioning (read-only)', [
    h('dl.dl', {}, [
      h('dt', {}, ['Config version']), h('dd', {}, [String(data.configVersion || UNKNOWN)]),
      h('dt', {}, ['Config file']), h('dd', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [paths.configFile || UNKNOWN])]),
      h('dt', {}, ['Prompt file']), h('dd', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [paths.promptFile || UNKNOWN])]),
      h('dt', {}, ['Env file']), h('dd', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [paths.envFile || UNKNOWN])]),
      h('dt', {}, ['Cache file']), h('dd', {}, [h('span.mono', { style: 'font-size:var(--fs-xs)' }, [paths.cacheFile || UNKNOWN])]),
    ]),
    h('div.field-hint.mt-8', {}, ['Provider secrets live in the env file and are never displayed here or sent to the browser.']),
  ]));
}

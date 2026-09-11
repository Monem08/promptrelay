# ⚡ PromptRelay

**Automatic multi-client (OpenCode, Claude Code, Hermes), multi-protocol, multi-provider local AI gateway and prompt engineering studio.**

PromptRelay sits between your coding agents and your LLM providers. It injects (or replaces) system prompts, normalizes reasoning effort across providers, streams responses, forwards tool calls, and provides smart retries, explicit fallbacks, and real-time observability — all with a single local endpoint and zero runtime dependencies beyond Express.

```
OpenCode (OpenAI)       ──┐
Claude Code (Anthropic) ──┼──▶ PromptRelay (localhost:4141) ──▶ OpenRouter / Anthropic / Ollama / Custom
Hermes (OpenAI)         ──┘        │
                                   ├─ OpenAI /v1/chat/completions & Anthropic /v1/messages
                                   ├─ per-client routing profiles & scoped prompts
                                   ├─ atomic safe-writes with automatic backups
                                   ├─ cross-platform background service (Windows, macOS, Linux)
                                   ├─ self-healing diagnostics & automated doctor repair
                                   └─ real-time dashboard with SSE telemetry
```

---

## Quick start

```bash
# 1. Install
npm install -g @monem08/promptrelay

# 2. Run the interactive setup (provider → key → model discovery → prompt → OpenCode)
promptrelay setup

# 3. Start the gateway
promptrelay start

# 4. Check it's healthy
promptrelay doctor
```

That's it. `promptrelay setup` walks you through choosing a provider (OpenRouter is the easiest), pasting your API key, discovering available models, picking one, loading your system prompt, and wiring PromptRelay into OpenCode's config — non-destructively.

Prefer to do it by hand? See [Manual configuration](#manual-configuration).

---

## Table of contents

- [Why PromptRelay](#why-promptrelay)
- [Installation](#installation)
- [Interactive setup](#interactive-setup)
- [Manual configuration](#manual-configuration)
- [Providers](#providers)
- [Model intelligence](#model-intelligence)
- [Reasoning effort](#reasoning-effort)
- [Reliability: retry & fallback](#reliability-retry--fallback)
- [OpenCode integration](#opencode-integration)
- [Security & secret handling](#security--secret-handling)
- [Web dashboard](#web-dashboard)
- [HTTP API](#http-api)
- [CLI reference](#cli-reference)
- [Configuration reference](#configuration-reference)
- [Architecture](#architecture)
- [Development & testing](#development--testing)
- [Troubleshooting](#troubleshooting)

---

## Why PromptRelay

- **One prompt, any provider.** Define your system prompt once. PromptRelay injects or replaces it on every request, regardless of which model or provider you point it at.
- **Reasoning that works everywhere.** A single effort scale (`none → minimal → low → medium → high → max`) is translated to each provider's native knobs (OpenAI `reasoning_effort`, Anthropic/OpenRouter `reasoning` budgets, Ollama `think`, etc.).
- **Honest model data.** Model discovery reports capabilities from the provider's real metadata. Anything the provider doesn't expose is reported as **`unknown`** — never guessed, never fabricated.
- **Reliability built in.** Automatic retries with exponential backoff + jitter and `Retry-After` support for transient errors, plus **explicit** (always-logged, never silent) provider fallback.
- **Safe by default.** Secrets are masked in every log line, status output, and config dump. Your API keys live in `~/.promptrelay/.env`, never in the JSON config.
- **Zero-drama OpenCode integration.** JSONC-aware, comment-preserving, non-destructive merge into your existing OpenCode config, with an automatic backup.
- **Dependency-light.** Express is the only runtime dependency; everything else uses Node's built-ins (`fetch`, `crypto`, `readline`).

---

## Installation

```bash
npm install -g @monem08/promptrelay
```

Requires **Node.js 18, 20, or 22**. No other runtime dependencies to install.

You can also run it without a global install:

```bash
npx @monem08/promptrelay setup
```

---

## Interactive setup

```bash
promptrelay setup
```

The wizard walks you through, in order:

1. **Provider** — pick from presets (OpenRouter, Ollama Cloud, Ollama Local, or a custom OpenAI-compatible / Ollama-native endpoint).
2. **API key** — pasted once and stored in `~/.promptrelay/.env` (masked everywhere thereafter).
3. **Model discovery** — PromptRelay queries the provider's model list and offers a transparent recommendation (with capabilities it could actually verify).
4. **Model** — pick the model to use.
5. **System prompt** — start from the bundled starter prompt or point to your own file.
6. **OpenCode** — optionally merge PromptRelay into your OpenCode config.
7. **Doctor** — a final diagnostic confirms everything is wired correctly.

Run individual wizards any time:

```bash
promptrelay provider     # provider/model wizard
promptrelay prompt       # open/replace your system prompt
promptrelay opencode     # (re)configure the OpenCode integration
```

---

## Manual configuration

Create the config files without overwriting anything that already exists:

```bash
promptrelay init
```

This creates, in the current directory (or `~/.promptrelay/`):

- `promptrelay.json` — the versioned config file.
- `system_prompt.txt` — your system prompt.
- `opencode.jsonc.example` — a sample OpenCode provider block.

Store your API key:

```bash
promptrelay keys set OPENROUTER_API_KEY sk-or-...
```

Then edit `promptrelay.json` (see [Configuration reference](#configuration-reference)) and run `promptrelay config validate`.

---

## Providers

PromptRelay ships with presets for the most common setups:

| Preset | Transport | Notes |
| --- | --- | --- |
| **OpenRouter** | `openai-compatible` | Easiest / recommended. Hundreds of models, rich metadata, free tier. |
| **Ollama Cloud** | `ollama-native` | Native fast mode against Ollama's hosted API. |
| **Ollama Local** | `ollama-native` | No API key needed; talks to a local `ollama serve`. |
| **Custom OpenAI-compatible** | `openai-compatible` | Any endpoint that speaks the OpenAI `/v1/chat/completions` API. |
| **Custom Ollama-native** | `ollama-native` | Any endpoint that speaks Ollama's `/api/chat`. |

Manage provider profiles from the CLI:

```bash
promptrelay provider add            # add a profile interactively
promptrelay provider list           # list configured profiles
promptrelay provider use <name>     # switch the active profile
promptrelay provider test --live    # live health-check the active provider
promptrelay provider remove <name>  # remove a profile
```

Multiple named profiles live under `providers` in the config; `activeProvider` selects which one is live. The legacy single-`provider` block is still fully supported for backward compatibility.

### Base URL normalization

PromptRelay normalizes provider base URLs so you don't have to remember whether to include `/v1`. Both `https://openrouter.ai/api` and `https://openrouter.ai/api/v1` resolve correctly per transport.

---

## Model intelligence

```bash
promptrelay models list             # discover & list models from the active provider
promptrelay models list --json      # machine-readable output
promptrelay models list --refresh   # bypass the cache
promptrelay models free             # list models verified as free
promptrelay models refresh          # refresh the on-disk model cache
promptrelay models recommend        # recommend a model
promptrelay models recommend --profile coding
promptrelay model use <id>          # set the active model
```

**Honest metadata.** Each model's capabilities — vision, tools, reasoning, structured outputs, context length, pricing, free/paid — are read from the provider's own metadata:

- **OpenRouter** exposes rich data (context length, per-token pricing, input modalities, supported parameters), so most fields resolve to concrete `true`/`false` values.
- **Minimal providers** (e.g. a bare OpenAI-compatible `/v1/models`) expose almost nothing, so most fields resolve to **`unknown`**.

PromptRelay **never fabricates** capability data. If a provider doesn't report it, the field is `unknown` — everywhere, consistently.

**Caching.** Discovery results are cached on disk (in `~/.promptrelay/`) to keep the CLI fast; use `--refresh` or `models refresh` to invalidate.

**Ranking & recommendation.** `models recommend` and `auto` rank models against a profile (e.g. coding), preferring verified capabilities and never elevating a model on data that couldn't be confirmed.

---

## Reasoning effort

One scale, mapped to every provider:

```
none  →  minimal  →  low  →  medium  →  high  →  max     (or: auto)
```

```bash
promptrelay reasoning list          # show the levels
promptrelay reasoning set medium    # set the default effort
promptrelay reasoning set auto      # let PromptRelay choose per request
promptrelay reasoning high          # shortcut for `reasoning set high`
```

Each level is translated to the active provider's native mechanism (OpenAI `reasoning_effort`, OpenRouter/Anthropic `reasoning` budgets, Ollama `think`, …). With `auto`, PromptRelay selects an appropriate level per request. Set `reasoning.injectDefault` to apply your default even when a client doesn't specify one.

---

## Reliability: retry & fallback

### Smart retry

Transient upstream failures are retried automatically:

- Retryable statuses: **429, 502, 503, 504** (configurable).
- **Exponential backoff with jitter**, bounded by `baseDelayMs` / `maxDelayMs`.
- Honors the upstream **`Retry-After`** header when present.
- Non-retryable statuses (e.g. `400`, `401`) are forwarded immediately — never retried.

```jsonc
"retry": {
  "enabled": true,
  "maxRetries": 2,
  "baseDelayMs": 500,
  "maxDelayMs": 8000,
  "retryableStatus": [429, 502, 503, 504]
}
```

### Explicit fallback

Fallback is **opt-in and never silent.** When the primary provider fails to connect, PromptRelay tries the configured fallback providers in order and **logs every fallback hop**. It resolves each fallback provider's API key from that provider's own `apiKeyEnv`.

```jsonc
"fallback": {
  "enabled": true,
  "providers": ["backup"]   // names of profiles under `providers`
}
```

If everything fails, the client receives a real error — PromptRelay never masks a total failure as success.

### Health

```bash
promptrelay status          # process status + live /health
promptrelay provider test --live
promptrelay doctor --deep   # deeper diagnostics
promptrelay doctor --fix    # auto-fix common issues
```

---

## OpenCode integration

```bash
promptrelay opencode           # set up the integration (interactive)
promptrelay opencode status    # show current integration status
promptrelay opencode repair    # re-merge the PromptRelay provider block
```

PromptRelay:

- **Locates** your OpenCode config automatically.
- **Backs it up** before any change.
- **Parses JSONC** (comments and trailing commas preserved) and merges **non-destructively** — your existing providers and settings are untouched.
- Writes **only verified limits.** If a model's context/output limits aren't known, they are omitted rather than guessed.

---

## Security & secret handling

- **Keys live outside the config.** API keys are stored in `~/.promptrelay/.env` and referenced by env-var name (`apiKeyEnv`) in `promptrelay.json`.
- **Masked everywhere.** Secrets are redacted in logs, `status`/`doctor` output, and any config dump. You'll see `****…` — never the raw value.
- **Real env vars win.** Values already present in the environment when PromptRelay starts always take precedence over `~/.promptrelay/.env`, so CI/prod secrets aren't overridden.

```bash
promptrelay keys set OPENROUTER_API_KEY sk-or-...   # store a secret
promptrelay keys list                               # list key names (masked)
promptrelay keys remove OPENROUTER_API_KEY          # remove a secret
```

---

## Web dashboard

PromptRelay ships with a built-in web dashboard — a lightweight control panel for
everything the CLI does, served straight from the gateway (no extra install, no
build step, no framework).

```bash
promptrelay dashboard          # start the gateway if needed and open the dashboard
promptrelay dashboard --print  # print the classic terminal status view instead
```

The dashboard is available at **`http://127.0.0.1:4141/dashboard`** while the gateway
is running. It gives you:

- **Overview** — live health, key counts, connected clients, and traffic at a glance.
- **Clients** — every coding client wired to PromptRelay (OpenCode, Claude Code, Hermes) with wiring status.
- **Providers** — provider status and a guided add-provider wizard.
- **Models** — a searchable/filterable explorer with a per-model capability drawer.
- **Router** — pick a routing profile, apply constraints, and preview candidate ranking (global or per-client).
- **Prompt Studio** — edit the system prompt with mode/preset/scope controls and a live effective preview.
- **Requests** — a recent-request inspector (metadata only) with a full per-request detail drawer.
- **Diagnostics** — a system-health console plus one-click **Autopilot** safe checks.
- **Metrics** — traffic, latency, and usage charts computed from real recorded requests only.
- **Settings** — safe, redacted configuration (secrets are never sent to the browser).

**Security.** The dashboard and its `/api/dashboard/*` endpoints are **local-only by
default** — requests from non-loopback addresses are rejected unless you explicitly set
`PROMPTRELAY_DASHBOARD_ALLOW_REMOTE=true`. Secrets and API keys are never exposed to the
browser: keys are masked, errors are sanitized, and full prompt/response logging is
intentionally unavailable. Data is real — when a value is not known it is shown as
*Unknown* / *No data yet* rather than being faked.

---

## HTTP API

PromptRelay exposes a dual-protocol surface on `http://127.0.0.1:4141` (configurable):

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/` | Service info + endpoint index. |
| `GET` | `/health` | Liveness + version. |
| `GET` | `/v1/models` | Model list (proxied/normalized from the active provider). |
| `POST` | `/v1/chat/completions` | OpenAI Chat Completions API — streaming (SSE) and non-streaming, tool-calls, reasoning. |
| `POST` | `/v1/messages` | Anthropic Messages API — streaming (SSE) and non-streaming, tool_use, thoughts/reasoning. |
| `GET` | `/api/dashboard/stream` | Server-Sent Events (SSE) stream for real-time telemetry events. |

Point any OpenAI-compatible or Anthropic Messages client at this base URL. Streaming, tool calls, and usage accounting are preserved end-to-end.

---

## CLI reference

```
Quick start:
  promptrelay setup [--auto] [--dry-run] [--no-start]  Setup wizard (auto/dry-run supported)
  promptrelay start                                    Start the gateway
  promptrelay doctor [--deep] [--fix]                  Diagnose and repair your configuration

Lifecycle:
  promptrelay start [--daemon]                         Start (foreground, or background with --daemon)
  promptrelay stop                                     Stop a running gateway
  promptrelay restart                                  Restart the gateway
  promptrelay status                                   Show running status + live /health

Service (OS Daemon):
  promptrelay service install                          Install user-level background service
  promptrelay service start                            Start background service
  promptrelay service stop                             Stop background service
  promptrelay service restart                          Restart background service
  promptrelay service status                           Show background service status
  promptrelay service uninstall                        Uninstall background service

Providers:
  promptrelay provider                                 Interactive provider/model wizard
  promptrelay provider list                            List configured provider profiles
  promptrelay provider add                             Add a provider profile (interactive)
  promptrelay provider use <name>                      Switch the active provider profile
  promptrelay provider test [--live]                   Health-check the active provider
  promptrelay provider remove <name>                   Remove a provider profile

Models:
  promptrelay models list [--json]                     Discover & list provider models
  promptrelay models free                              List verified free models
  promptrelay models refresh [--clear]                 Refresh (or clear) the model cache
  promptrelay models recommend [--profile <p>]         Recommend a model
  promptrelay model use <id>                           Set the active model

Auto & reasoning:
  promptrelay auto [--profile <p>]                     Auto-select the best model for a profile
  promptrelay reasoning list                           List reasoning levels
  promptrelay reasoning set <lvl>                      Set default reasoning (none…max, or auto)

Prompt & config:
  promptrelay prompt                                   Open your custom system prompt
  promptrelay prompt use <file>                        Load a prompt from a file
  promptrelay config                                   Open the config file
  promptrelay config validate                          Validate the config
  promptrelay config migrate [--dry-run]               Migrate config schema with backups
  promptrelay config backups                           List timestamped configuration backups
  promptrelay config restore <id>                      Restore configuration from a backup

OpenCode:
  promptrelay opencode                                 Set up OpenCode integration
  promptrelay opencode status                          Show OpenCode integration status
  promptrelay opencode repair                          Re-merge the PromptRelay provider

Clients (multi-client integration):
  promptrelay client list                              List supported clients (OpenCode, Claude Code, Hermes)
  promptrelay client detect                            Detect which clients are installed/configured
  promptrelay client status [id]                       Show PromptRelay wiring status for a client (or all)
  promptrelay client setup <id>                        Wire a client to PromptRelay (--model, --small-model)
  promptrelay client repair <id>                       Re-apply the PromptRelay wiring for a client
  promptrelay client validate <id>                     Validate client configuration against expected schema
  promptrelay client remove <id>                       Remove PromptRelay wiring (restores backup-safe)

Compatibility aliases:
  promptrelay repair <client>                          Alias for promptrelay client repair <client>
  promptrelay refresh --clear                          Alias for promptrelay models refresh --clear

Keys:
  promptrelay keys set <ENV> <val>                     Store a secret in ~/.promptrelay/.env
  promptrelay keys list                                List stored key names (masked)
  promptrelay keys remove <ENV>                        Remove a stored secret

Other:
  promptrelay init                                     Create config files without overwriting
  promptrelay dashboard                                Open the web dashboard (starts gateway if needed)
  promptrelay dashboard --print                        Print the terminal status dashboard instead
  promptrelay path                                     Print ~/.promptrelay path
  promptrelay --version                                Print version
  promptrelay --help                                   Show this help
```

---

## Configuration reference

`promptrelay.json` is a **versioned** document. On load, older versions are **migrated automatically** (with a timestamped backup of the previous file), and the result is validated before use.

```jsonc
{
  "version": 3,

  "server": {
    "host": "127.0.0.1",
    "port": 4141
  },

  "prompt": {
    "mode": "replace",                 // "replace", "prepend", "append", or "passthrough"
    "file": "system_prompt.txt",
    "placeholder": "{Paste your instructions here}"
  },

  "promptScopes": {                    // per-client prompt overrides
    "opencode": { "file": "system_prompt_opencode.txt", "mode": "prepend" },
    "claude-code": { "file": "system_prompt_claude.txt", "mode": "append" }
  },

  "routing": {
    "profile": "balanced",             // global routing profile
    "clients": {                       // per-client routing profile overrides
      "opencode": "coding",
      "claude-code": "reasoning"
    }
  },

  "provider": {                        // inline active provider
    "name": "OpenRouter",
    "transport": "openai-compatible",  // or "ollama-native" / "anthropic-native"
    "baseURL": "https://openrouter.ai/api/v1",
    "model": "openrouter/auto",
    "forceModel": true,
    "apiKeyEnv": "OPENROUTER_API_KEY", // env-var NAME, not the key itself
    "auth": { "type": "bearer" },
    "headers": {
      "HTTP-Referer": "https://github.com/Monem08/promptrelay",
      "X-Title": "PromptRelay"
    }
  },

  "providers": {},                     // named profiles; select via activeProvider
  // "activeProvider": "openrouter",

  "reasoning": {
    "default": "low",                  // none|minimal|low|medium|high|max
    "injectDefault": false,            // apply default when client omits it
    "auto": false                      // pick per request
  },

  "retry": {
    "enabled": true,
    "maxRetries": 2,
    "baseDelayMs": 500,
    "maxDelayMs": 8000,
    "retryableStatus": [429, 502, 503, 504]
  },

  "fallback": {
    "enabled": false,
    "providers": []                    // profile names to try, in order
  },

  "logging": {
    "requests": true
  }
}
```

**Config resolution order:** `PROMPTRELAY_CONFIG` env var → `./promptrelay.json` (cwd) → `~/.promptrelay/promptrelay.json` → bundled default.

Validate any time:

```bash
promptrelay config validate
```

---

## Architecture

PromptRelay is organized into small, focused modules:

```
bin/promptrelay.js        Thin CLI router (argv → command)
src/
  cli/                    Command handlers, setup wizard, IO utilities
  clients/                Coding client adapters (OpenCode, Claude Code, Hermes)
  config/                 Versioned schema, safe atomic writes, backups, migrations
  doctor/                 Self-healing diagnostics and automated repair engine
  ir/                     Canonical Intermediate Representation (OpenAI <-> Anthropic)
  models/                 Discovery, capability metadata, cache, ranking
  prompts/                Global and per-client prompt scopes
  providers/              Registry, presets, URL normalization, credentials
  reasoning/              Effort scale + per-provider mappings
  routing/                Runtime routing engine shared across ingress endpoints
  adapters/               openai-compatible, anthropic-native, ollama-native transports
  server/                 Express app, OpenAI & Anthropic ingress, dashboard backend
  service/                Cross-platform OS service manager (systemd, launchd, schtasks)
  telemetry/              Secret masking, log redaction, in-memory telemetry buffer
  testing/                Mock provider servers + integration harness
dashboard/                Vanilla modern SPA (Overview, Clients, Models, Router, Prompt Studio, etc.)
```

Design principles: **preserve existing behavior**, **never fabricate data** (use `unknown`), **explicit over silent**, and **no runtime dependencies beyond Express**.

---

## Development & testing

```bash
git clone https://github.com/Monem08/promptrelay
cd promptrelay
npm install

npm run check     # syntax-check every source & test file
npm test          # run the full test suite (node --test)
```

The suite covers:

- **Unit** — reasoning mappings, URL normalization, capability inference, ranking, config migration, JSONC parsing, secret masking, cache, retry/backoff.
- **Adapters** — openai-compatible and ollama-native transports against mock servers (streaming, tools, usage, failure injection).
- **CLI** — command behavior and idempotency.
- **Integration** — a real gateway booted on an ephemeral port against mock providers: health (no key leak), input validation, retry recovery (503 + 429/`Retry-After`), no-retry on `400`, and explicit fallback on connection failure.

CI runs `npm run check` and `npm test` on **Node 18, 20, and 22**.

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `promptrelay doctor` reports a missing key | `promptrelay keys set <ENV> <value>` — the env name must match the provider's `apiKeyEnv`. |
| Config won't load | `promptrelay config validate` to see the exact error; older configs migrate automatically with a backup. |
| Model list is empty or stale | `promptrelay models refresh` (or `models list --refresh`). |
| Capabilities show `unknown` | The provider didn't expose that metadata — this is expected and honest, not a bug. |
| OpenCode not picking up PromptRelay | `promptrelay opencode status`, then `promptrelay opencode repair`. |
| Provider unreachable | `promptrelay provider test --live`; check the base URL and that any local server (e.g. `ollama serve`) is running. |
| Requests failing intermittently | Retries are on by default; raise `retry.maxRetries` or configure explicit `fallback`. |

---

## License

See [LICENSE](LICENSE).

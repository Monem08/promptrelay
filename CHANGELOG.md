# Changelog

All notable changes to PromptRelay will be documented here.

## Unreleased

### Added

- **Model metadata: detect, propagate, ask** (`src/models/context-presets.js`):
  - `configSync` automation job now resolves the active model's metadata once and hands `modelMeta` + `supportedEfforts` to every client adapter. Previously it passed only `{ baseURL, model }`, so background sync silently dropped the metadata the interactive path already wrote.
  - Hermes client adapter writes verified limits into `~/.hermes/config.yaml`: `model.context_length`, `model.max_output_tokens`, `agent.reasoning_overrides`. This is what stops Hermes falling back to its hard-coded 256K default on an endpoint that publishes no limits.
  - `promptrelay client setup` asks for context window, output limit, and reasoning ladder when detection came back empty and the terminal is interactive. Offers the windows that occur in practice (8K … 1M) with the trade-off spelled out, a free-form custom entry that accepts `65536` / `64K` / `1M`, and an explicit "leave unknown".
  - User answers are stored with `user-selection` provenance, distinct from `provider-metadata`, so a measurement is never confused with a decision.
  - `verifiedMetadata()` writes a key only when the value was observed. `'unknown'` is never written — a wrong number disables the client's own fallback and mis-sizes its auto-compression.
  - `resolveMetadataPassive()` is the non-interactive path for scheduled jobs: verified values pass through, everything else stays unknown. A scheduled task never prompts and never invents a number.
  - `describeMetadata()` on the Hermes adapter; `doctor` now reports per-client context/output/reasoning state, distinguishing "set correctly" from "left unknown on purpose".
  - `updateTopLevelBlock()` in `clients/yaml-edit.js` — comment-preserving upsert for metadata keys, reusing the existing top-level block scanner.
  - `consumesModelMetadata` flag on the client adapters so only clients that actually read model limits are prompted.
  - 30 new tests in `test/model-metadata.test.js`.

### Added (earlier in this release)

- **OpenCode Zen free tier for any client** (`src/providers/zen-free-tier.js`):
  - New opt-in `provider.zenFreeTier` block. When enabled, PromptRelay sends the `opencode/<version>` User-Agent and a stable per-client `x-opencode-session` header — the only two things the Zen relay checks before serving its free models.
  - Session ids are minted locally (`ses_` + 26 hex) and cached per detected client (`X-PromptRelay-Client`, else peer IP) so the relay's prompt cache stays warm across a conversation. Bounded at 512 entries with LRU eviction and a 6-hour idle TTL; ids carry no account or conversation content and are never logged.
  - **No account or API key required.** Anonymous access reaches the free tier; `$OPENCODE_API_KEY` is now optional and only switches requests onto your own quota (BYOK). The `opencode-zen` preset is marked `needsKey: false` and the wizard no longer requires a key.
  - Request bodies are passed through unmodified — tools, streaming, and reasoning are untouched.
  - Wired through the existing `providerHeaders()` chokepoint, so every egress path (OpenAI-compatible, Anthropic ingress via IR, model discovery, health checks) is covered without duplicating logic.
  - Off by default and scoped per provider; no other provider's wire format changes.
  - New `examples/providers/opencode-zen-anonymous.json` (keyless) alongside the updated `opencode-zen.json`.
  - `zenFreeTier` diagnostics on `/health` (enabled state, User-Agent, session counts — never the ids themselves).
  - 37 new tests in `test/zen-free-tier.test.js` covering header construction, session stability and eviction, operator override precedence, config validation, preset opt-in isolation, and gateway end-to-end behaviour against a relay stub that rejects non-OpenCode requests.

### Fixed

- **Setup wizard leaked the previous provider's model id**: switching providers pre-filled the model prompt with `current.provider.model` regardless of which provider was chosen, so OpenRouter → OpenCode Zen asked for `Model [openrouter/auto]:` — an id that does not exist on Zen. The current model is now carried over only when the target endpoint matches the configured one (case-insensitive, trailing slash ignored); otherwise the new preset's own default is offered. Re-running the same provider still keeps the user's model.

### Changed

- `providerHeaders(config)` accepts an optional `{ clientId, ip }` context; `requestContext(req)` derives it from an Express request. All existing call sites keep working unchanged.
- `ir/upstream.js` `buildUpstream()` takes an optional request so the Anthropic ingress keeps per-client session identity.

## 1.3.0 - 2026-09-29

### Added

- **OpenCode Zen & Space Bunny Free Support**:
  - Built-in provider preset `opencode-zen` targeting `https://opencode.ai/zen/v1` and `space-bunny-free`.
  - Automatic detection and masking of `OPENCODE_API_KEY` credentials.
  - Full support for `xhigh` reasoning effort across OpenAI-compatible providers, CLI commands, and dashboard.
  - Automatic priority-based reasoning variant detection (provider metadata -> discovery capabilities -> API metadata -> capability cache -> verified compatibility map -> interactive fallback -> unknown).
  - OpenCode provider block generation with `variants` mapping (`low`, `medium`, `high`, `xhigh`).
  - Example provider configuration in `examples/providers/opencode-zen.json`.

### Fixed

- **Scoped System Prompt Validation**:
  - Fixed false HTTP 503 errors when `promptScopes.opencode` is configured with a custom prompt while the global prompt file remains at placeholder.
  - Evaluates client-specific effective prompt mode (`scopes.modeForScope(clientId, config)`) instead of global mode.
- **Reasoning Distinction**:
  - Prevents global collapse of `xhigh` to `max` or `high`; preserves `xhigh` and `max` as distinct concepts across transports.
  - Distinct Anthropic Extended Thinking token budget allocation (`xhigh: 16000`, `max: 32000`).

## 1.2.0 - 2026-09-11

### Added

- **Unified Automatic Setup**:
  - `promptrelay setup [--auto] [--dry-run] [--no-start]` with zero-mutation dry-run inspection, non-interactive automated provisioning, model discovery, multi-client detection, atomic configuration writes with automated rollback, and idempotent re-runs.
- **Universal Multi-Client Ingress & Support**:
  - Support for OpenCode (`POST /v1/chat/completions`), Claude Code (`POST /v1/messages`), and Hermes (`POST /v1/chat/completions`).
  - Shared normalized intermediate representation (IR) dispatch across both OpenAI-compatible and Anthropic Messages ingress endpoints.
  - Safe, comment-preserving configuration editing for JSONC (`opencode.jsonc`) and YAML (`config.yaml`).
- **Dynamic Multi-Provider Routing & Reliable Fallback**:
  - Routing profiles: `balanced`, `code-specialized`, `speed`, `economy`, and `reasoning`.
  - Per-client routing overrides and preferences (`routing.clientPreferences`).
  - Health-aware target selection that deprioritizes unhealthy or unreachable providers.
  - Capability constraints matching (tools, vision, reasoning).
  - Reliable cross-provider fallback with duplicate prevention, error classification (408, 429, 500, 502, 503, connection timeouts), and Retry-After backoff.
- **Scoped System Prompts**:
  - Per-client prompt scopes (`global`, `opencode`, `claude-code`, `hermes`) with granular modes (`replace`, `prepend`, `append`, `passthrough`).
- **Automation Manager**:
  - Running background scheduler with configurable intervals, non-overlapping mutex locks, cancellation during shutdown, manual Run Now, last-run/next-run tracking, and dynamic enable/disable for:
    - Model metadata refresh
    - Provider health checks
    - Client detection
    - Safe diagnostics auto-repair
    - Service auto-start
    - Client configuration synchronization
    - Model lifecycle & deprecation checks
- **Service Management (OS Daemons)**:
  - Native per-user background service adapters for Linux (`systemd --user`), macOS (`launchd` LaunchAgent), and Windows (Task Scheduler user task).
  - Commands: `promptrelay service install`, `start`, `stop`, `restart`, `status`, `uninstall`.
- **Security & Privacy Hardening**:
  - Default loopback-only binding (`127.0.0.1`).
  - Remote dashboard access protection: token authentication, constant-time verification, CSRF Origin checking, rate limiting (5 attempts/min), security headers (CSP, nosniff, DENY), and non-TLS warning headers.
  - Gateway `/v1/*` token authentication with constant-time verification, unauthenticated health endpoint policy, and seamless token rotation.
  - Complete redaction of API keys, tokens, and secrets from responses, logs, and telemetry.
  - Removed old 100MB body limit in favor of a safe, configurable 2MB default.
  - Privacy-preserving telemetry with "Logging Off" mode that records zero request metadata or content.
- **Configuration Safety Layer**:
  - File write locking (`.lock`), timestamped backups (`.backups/`), same-volume temporary file writes, pre-commit schema validation, and atomic rename with rollback.
  - Configuration migration CLI: `promptrelay config migrate [--dry-run]`, `promptrelay config backups`, `promptrelay config restore <id>`.
  - Diagnostics suite: `promptrelay doctor [--deep] [--fix]`.
- **Modern Responsive Dashboard**:
  - Dark-first aesthetic, real-time metrics, SSE live stream, responsive across all viewports (1440px down to 360px), accessible forms, and zero unmasked secrets.

## 1.1.0 - 2026-09-04

### Added

- Installable `promptrelay` CLI.
- `promptrelay setup` interactive first-run wizard.
- Built-in setup choices for OpenRouter, Ollama Cloud, Ollama Local, custom OpenAI-compatible providers, and custom Ollama-native providers.
- Interactive provider/model/auth reconfiguration through `promptrelay provider`.
- Local secret storage in `~/.promptrelay/.env` with real environment variables taking priority.
- `promptrelay prompt`, `promptrelay config`, `promptrelay opencode`, `promptrelay doctor`, and `promptrelay path` commands.
- Automatic first-run setup when `promptrelay` is launched without user configuration in an interactive terminal.
- Safe OpenCode config generation that does not overwrite an existing config.
- User-level configuration in `~/.promptrelay`.
- GitHub install flow with `npm i -g github:Monem08/promptrelay`.
- npm-ready scoped package metadata for `@monem08/promptrelay`.
- CLI and user-config tests.

### Improved

- Custom provider setup no longer requires editing `server.js` or JSON for normal use.
- Prompt paths resolve relative to the active config directory.
- README is centered on the three-step install → setup → start flow.
- Config resolution supports explicit config, current directory, user config, then bundled defaults.

## 1.0.0 - 2026-09-04

### Added

- OpenRouter default provider configuration.
- Generic OpenAI-compatible adapter.
- Ollama native `/api/chat` adapter.
- Prompt modes: replace, prepend, append, passthrough.
- Hot reload for prompt/provider/model configuration.
- Reasoning normalization.
- Tool calling and streaming support.
- Windows setup and auto-start scripts.
- Linux setup and systemd example.
- Unit tests and GitHub Actions CI.

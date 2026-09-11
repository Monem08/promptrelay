# Changelog

All notable changes to PromptRelay will be documented here.

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

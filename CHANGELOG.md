# Changelog

All notable changes to PromptRelay will be documented here.

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

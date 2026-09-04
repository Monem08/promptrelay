# Changelog

All notable changes to PromptRelay will be documented here.

## 1.1.0 - 2026-09-04

### Added

- Installable `promptrelay` CLI.
- `promptrelay init` for user-level configuration.
- `promptrelay doctor` for setup validation.
- `promptrelay path`, `--help`, and `--version` commands.
- User config directory support at `~/.promptrelay`.
- GitHub install flow with `npm i -g github:Monem08/promptrelay`.
- npm-ready scoped package metadata for `@monem08/promptrelay`.
- CLI tests and package prepublish validation.

### Changed

- README redesigned around a short CLI-first installation flow.
- Config resolution now supports explicit config, current directory, user config, then bundled defaults.
- Prompt files resolve relative to the active config file.

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

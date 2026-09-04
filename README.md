<div align="center">

# ⚡ PromptRelay

### Take control of your coding agent's system prompt.

**OpenCode → PromptRelay → OpenRouter / Ollama / any OpenAI-compatible API**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Default Provider: OpenRouter](https://img.shields.io/badge/default-OpenRouter-7B61FF)](https://openrouter.ai/)
[![Prompt Modes](https://img.shields.io/badge/prompt_modes-4-orange)](#-prompt-modes)

**Replace. Prepend. Append. Route. Reason. Stream.**

</div>

---

PromptRelay is a lightweight local gateway for coding agents such as **OpenCode**. It sits between the agent and the model provider, lets you control the system-prompt layer, and forwards requests to the provider/model you choose.

By default, PromptRelay uses **OpenRouter** with `openrouter/auto`. You can switch to another OpenAI-compatible provider—or use the optimized **Ollama native adapter**—without editing the core server code.

> [!IMPORTANT]
> `replace` mode intentionally removes incoming `system` and `developer` messages before injecting your custom prompt. Coding agents often keep important tool instructions there, so use `prepend` or `append` if you want to preserve the original agent harness.

> [!NOTE]
> PromptRelay only controls messages routed through this local proxy. It does not override provider-side policies, model-level restrictions, account rules, or platform-enforced behavior.

---

## ✨ Features

- 🔁 **4 prompt modes** — `replace`, `prepend`, `append`, `passthrough`
- 📝 **Hot-reloaded prompt file** — edit `system_prompt.txt`; no restart required
- ☁️ **OpenRouter by default** — one API key and you are ready
- 🔌 **Provider-agnostic** — works with OpenAI-compatible endpoints
- ⚡ **Ollama native transport** — optimized `/api/chat` bridge for Ollama Cloud/local
- 🧠 **Reasoning control** — `none`, `low`, `medium`, `high`, `max` where supported
- 🛠️ **Tool calling** — passthrough for OpenAI-compatible providers; translated for Ollama native
- 📡 **Streaming** — OpenAI SSE passthrough or Ollama NDJSON → OpenAI SSE conversion
- 🖼️ **Image input bridge** — data-URL images are mapped for Ollama native
- 🔥 **Provider/model hot reload** — edit `promptrelay.json`; the next request uses it
- 🔐 **Secrets stay in environment variables** — no API keys in config files
- 🪟 **Windows auto-start script** included
- 🐧 **Linux setup + systemd example** included
- ✅ **Tests + GitHub Actions CI** included

---

## 🧠 Architecture

```text
┌─────────────┐
│  OpenCode   │
└──────┬──────┘
       │ OpenAI-compatible request
       ▼
┌───────────────────────────────┐
│         PromptRelay           │
│                               │
│  Prompt policy                │
│  ├─ replace                   │
│  ├─ prepend                   │
│  ├─ append                    │
│  └─ passthrough               │
│                               │
│  + custom system prompt       │
│  + model routing              │
│  + reasoning normalization    │
│  + tool/stream handling       │
└──────────────┬────────────────┘
               │
        ┌──────┴──────────┐
        ▼                 ▼
┌───────────────┐   ┌────────────────┐
│ OpenAI-style  │   │ Ollama native  │
│ provider      │   │ /api/chat      │
└──────┬────────┘   └──────┬─────────┘
       │                   │
       ▼                   ▼
 OpenRouter /         Ollama Cloud /
 custom provider      Ollama Local
```

PromptRelay exposes:

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

---

# 🚀 Quick start

## 1. Clone

```bash
git clone https://github.com/Monem08/promptrelay.git
cd promptrelay
```

## 2. Install

```bash
npm install
npm run check
npm test
```

Requires **Node.js 18+**.

## 3. Add your system instruction

Open:

```text
system_prompt.txt
```

Replace:

```text
{Paste your instructions here}
```

with your own instruction.

Because the prompt lives in a plain text file, you can safely use Markdown, quotes, apostrophes, backticks, code blocks, and long multi-section instructions. No JavaScript escaping is required.

## 4. Set your provider API key

### Windows PowerShell

```powershell
[System.Environment]::SetEnvironmentVariable(
  "PROVIDER_API_KEY",
  "YOUR_API_KEY_HERE",
  "User"
)
```

Open a new PowerShell window after setting it.

### Linux / macOS

```bash
export PROVIDER_API_KEY="YOUR_API_KEY_HERE"
```

## 5. Start PromptRelay

```bash
npm start
```

Health check:

```bash
curl http://127.0.0.1:4141/health
```

---

# 🔌 OpenCode setup

Copy `opencode.jsonc.example` into your OpenCode config, or add this provider manually:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "promptrelay/default",
  "provider": {
    "promptrelay": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "⚡ PromptRelay",
      "options": {
        "baseURL": "http://127.0.0.1:4141/v1",
        "apiKey": "local-promptrelay"
      },
      "models": {
        "default": {
          "name": "PromptRelay Default",
          "limit": {
            "context": 200000,
            "output": 32768
          }
        }
      }
    }
  }
}
```

The local `apiKey` above is only a dummy value. Your real upstream key stays in `PROVIDER_API_KEY` or whichever environment variable you configure.

> [!TIP]
> Set `context` and `output` to the real limits of the upstream model you use.

---

# 🎛️ Prompt modes

Configure the mode in `promptrelay.json`:

```json
"prompt": {
  "mode": "replace",
  "file": "system_prompt.txt",
  "placeholder": "{Paste your instructions here}"
}
```

| Mode | Behavior |
|---|---|
| `replace` | Removes incoming `system` + `developer`, then injects your custom system prompt |
| `prepend` | Adds your custom system prompt before the original messages |
| `append` | Keeps original privileged messages, then adds your custom system prompt before the conversation |
| `passthrough` | Leaves messages untouched and acts only as a provider gateway |

### Replace example

```text
IN:
SYSTEM: OpenCode instructions
DEVELOPER: Agent rules
USER: Build this

OUT:
SYSTEM: Your system_prompt.txt
USER: Build this
```

---

# ☁️ Default provider: OpenRouter

The default `promptrelay.json` uses:

```json
{
  "provider": {
    "name": "OpenRouter",
    "transport": "openai-compatible",
    "baseURL": "https://openrouter.ai/api/v1",
    "model": "openrouter/auto",
    "forceModel": true,
    "apiKeyEnv": "PROVIDER_API_KEY",
    "auth": {
      "type": "bearer"
    }
  }
}
```

With `forceModel: true`, PromptRelay always uses the model configured in `promptrelay.json`.

Set:

```json
"forceModel": false
```

if you want the model ID sent by OpenCode to pass through dynamically.

---

# 🔄 Custom providers

Provider/model settings are loaded from `promptrelay.json` on every request. You can switch providers without changing `src/server.js`.

Examples are included in:

```text
examples/providers/
├── openrouter.json
├── ollama-cloud.json
├── ollama-local.json
└── custom-openai-compatible.json
```

Generic OpenAI-compatible example:

```json
{
  "provider": {
    "name": "My Provider",
    "transport": "openai-compatible",
    "baseURL": "https://api.example.com/v1",
    "model": "my-model-id",
    "forceModel": true,
    "apiKeyEnv": "PROVIDER_API_KEY",
    "auth": {
      "type": "bearer"
    },
    "headers": {}
  }
}
```

PromptRelay expects standard endpoints by default:

```text
BASE_URL/models
BASE_URL/chat/completions
```

---

# ⚡ Ollama native mode

PromptRelay includes a dedicated `ollama-native` transport. Instead of forwarding chat to `/v1/chat/completions`, it translates OpenAI-style requests to Ollama's native `/api/chat` format and converts responses back for OpenCode.

It supports:

- native `think` reasoning levels
- streaming reasoning content
- tool definitions
- assistant tool calls
- tool-result history
- image data URLs
- response usage conversion

Example Ollama Cloud config:

```json
{
  "provider": {
    "name": "Ollama Cloud",
    "transport": "ollama-native",
    "baseURL": "https://ollama.com",
    "model": "glm-5.3-flash",
    "forceModel": true,
    "apiKeyEnv": "PROVIDER_API_KEY",
    "auth": {
      "type": "bearer"
    },
    "chatPath": "/api/chat",
    "modelsPath": "/v1/models"
  },
  "reasoning": {
    "default": "low",
    "injectDefault": true
  }
}
```

For local Ollama:

```json
"baseURL": "http://127.0.0.1:11434",
"auth": {
  "type": "none"
}
```

Use the exact model ID available on your Ollama instance/account.

---

# 🧠 Reasoning

PromptRelay recognizes:

```text
none
low
medium
high
max
```

For OpenAI-compatible providers, explicit reasoning fields are normalized to `reasoning_effort` when configured. For `ollama-native`, reasoning is converted to Ollama's native `think` setting.

Reasoning support depends on the upstream provider/model.

---

# 🛠️ Tool calling

For OpenAI-compatible providers, tool definitions and tool-call payloads are forwarded upstream.

For Ollama native, PromptRelay translates:

```text
OpenAI tools → Ollama tools
Ollama tool calls → OpenAI tool_calls
OpenAI tool results → Ollama role:tool history
```

If you use `replace` mode, include strong tool-use rules in `system_prompt.txt` because the original OpenCode system/developer instructions are intentionally removed.

A starter prompt is available at:

```text
examples/system-prompt.txt
```

---

# 🔥 Hot reload

| Setting | Restart required? |
|---|---:|
| `system_prompt.txt` | No |
| provider | No |
| model | No |
| prompt mode | No |
| reasoning defaults | No |
| auth/header config | No |
| server host/port | **Yes** |

---

# 🪟 Windows

Setup:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Start manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

Install auto-start from **Administrator PowerShell**:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart-windows.ps1
```

Check:

```powershell
Get-ScheduledTask -TaskName "PromptRelay"
curl.exe http://127.0.0.1:4141/health
```

---

# 🐧 Linux

```bash
chmod +x scripts/setup-linux.sh
./scripts/setup-linux.sh
```

A systemd example is included at:

```text
scripts/promptrelay.service.example
```

---

# 🧪 Testing

```bash
npm run check
npm test
```

GitHub Actions CI runs across Node.js 18, 20, and 22.

---

# 🔍 Troubleshooting

### `promptConfigured: false`

Open `system_prompt.txt` and replace:

```text
{Paste your instructions here}
```

with your prompt.

### Port `4141` is unreachable

Run PromptRelay in the foreground:

```bash
npm start
```

Then inspect the actual error.

### Provider returns `401` / `403`

Check your API key, `apiKeyEnv`, auth type, provider base URL, and account permissions.

### Tools became worse after `replace`

Try `prepend`/`append`, or add explicit tool rules to your custom prompt.

### OpenAI-compatible Ollama path is slow

Use:

```json
"transport": "ollama-native"
```

so PromptRelay uses native `/api/chat`.

---

# 🔐 Security

- Never commit API keys.
- Never paste real keys into screenshots, README files, issues, or logs.
- Keep PromptRelay bound to `127.0.0.1` unless you intentionally add authentication/TLS for remote access.
- PromptRelay forwards conversation content, code context, tool definitions, and tool results to the configured upstream provider.
- Review the privacy/data-retention policy of the provider you use.
- `replace` mode can remove client-supplied tooling/safety instructions. Use it deliberately.

See [SECURITY.md](SECURITY.md).

---

# 📁 Project structure

```text
promptrelay/
├── src/
│   ├── server.js
│   ├── config.js
│   ├── prompt.js
│   ├── reasoning.js
│   ├── http.js
│   └── adapters/
│       ├── openai-compatible.js
│       └── ollama-native.js
├── examples/
│   ├── system-prompt.txt
│   └── providers/
├── scripts/
├── test/
├── .github/workflows/ci.yml
├── promptrelay.json
├── system_prompt.txt
├── opencode.jsonc.example
├── .env.example
├── package.json
├── LICENSE
└── README.md
```

---

# 🗺️ Roadmap

- [x] OpenRouter default
- [x] Generic OpenAI-compatible transport
- [x] Ollama native transport
- [x] Replace / prepend / append / passthrough
- [x] Prompt + provider/model hot reload
- [x] Streaming
- [x] Tool calling
- [x] Reasoning normalization
- [x] Windows auto-start
- [x] Linux service example
- [x] Tests + CI
- [ ] Request debug inspector with redacted secrets
- [ ] Per-model reasoning profiles
- [ ] Config schema + editor validation
- [ ] Optional local authentication token
- [ ] Docker image
- [ ] Web dashboard
- [ ] Multiple named provider profiles
- [ ] Prompt presets + version history
- [ ] Latency/token metrics

---

# 🤝 Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# 📄 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**PromptRelay**

*Your agent. Your provider. Your prompt.* ⚡

</div>

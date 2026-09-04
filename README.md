<div align="center">

# ⚡ PromptRelay

### Your agent. Your provider. Your system prompt.

**OpenCode → PromptRelay → OpenRouter / Ollama / any OpenAI-compatible API**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Default Provider: OpenRouter](https://img.shields.io/badge/default-OpenRouter-7B61FF)](https://openrouter.ai/)
[![CLI](https://img.shields.io/badge/CLI-promptrelay-black)](#-cli)

**Replace. Prepend. Append. Route. Reason. Stream.**

</div>

---

PromptRelay is a lightweight local gateway for coding agents such as **OpenCode**. It lets you control the system-prompt layer, route requests to your preferred model provider, and keep streaming, reasoning, and tool calling working through one OpenAI-compatible local endpoint.

> [!IMPORTANT]
> `replace` mode removes incoming `system` and `developer` messages and injects your custom prompt. If you want to preserve the original coding-agent harness, use `prepend` or `append` instead.

---

# ⚡ Install

## GitHub — works now

```bash
npm i -g github:Monem08/promptrelay
```

Then:

```bash
promptrelay init
promptrelay
```

No clone. No manual `npm install`. No editing JavaScript.

## npm package

PromptRelay is prepared to publish as:

```bash
npm i -g @monem08/promptrelay
```

After it is published to npm, the same `promptrelay` CLI will work.

---

# 🚀 60-second setup

### 1. Initialize

```bash
promptrelay init
```

PromptRelay creates:

```text
~/.promptrelay/
├── promptrelay.json
├── system_prompt.txt
└── opencode.jsonc.example
```

On Windows this is typically:

```text
C:\Users\YOUR_NAME\.promptrelay\
```

### 2. Add your system instruction

Open `system_prompt.txt` and replace:

```text
{Paste your instructions here}
```

with your own prompt.

The prompt file is plain text, so Markdown, quotes, backticks, code blocks, and long multi-section instructions are safe.

### 3. Set your provider API key

Windows PowerShell:

```powershell
[System.Environment]::SetEnvironmentVariable(
  "PROVIDER_API_KEY",
  "YOUR_API_KEY_HERE",
  "User"
)
```

Open a new PowerShell window afterward.

Linux / macOS:

```bash
export PROVIDER_API_KEY="YOUR_API_KEY_HERE"
```

### 4. Check setup

```bash
promptrelay doctor
```

### 5. Start

```bash
promptrelay
```

Default endpoint:

```text
http://127.0.0.1:4141/v1
```

---

# 🔌 OpenCode

Use PromptRelay as an OpenAI-compatible provider:

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

The local `apiKey` above is only a dummy value. Your real provider key stays in the environment variable configured by PromptRelay.

---

# ✨ Features

- 🔁 `replace`, `prepend`, `append`, `passthrough` prompt modes
- 📝 hot-reloaded `system_prompt.txt`
- 🔥 provider/model config hot reload
- ☁️ OpenRouter default provider
- 🔌 generic OpenAI-compatible providers
- ⚡ dedicated Ollama native `/api/chat` transport
- 🧠 reasoning control: `none`, `low`, `medium`, `high`, `max` where supported
- 🛠️ tool calling and tool-result translation
- 📡 streaming support
- 🖼️ Ollama image data-URL bridge
- 🔐 API keys kept out of config files
- 🩺 built-in `promptrelay doctor`
- 🪟 Windows + 🐧 Linux support
- ✅ tests + GitHub Actions CI

---

# 🧠 Architecture

```text
┌─────────────┐
│  OpenCode   │
└──────┬──────┘
       │ OpenAI-compatible request
       ▼
┌───────────────────────────────┐
│         PromptRelay           │
│                               │
│  prompt policy                │
│  ├─ replace                   │
│  ├─ prepend                   │
│  ├─ append                    │
│  └─ passthrough               │
│                               │
│  + provider routing           │
│  + reasoning normalization    │
│  + tool/stream translation    │
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

# 🖥️ CLI

```text
promptrelay            Start PromptRelay
promptrelay init       Create user config files
promptrelay doctor     Validate prompt/provider/API-key setup
promptrelay path       Print PromptRelay home directory
promptrelay --version  Print version
promptrelay --help     Show help
```

If no user config exists, running `promptrelay` automatically initializes the PromptRelay home directory and tells you what to configure next.

---

# 🎛️ Prompt modes

Configure `prompt.mode` in `promptrelay.json`:

| Mode | Behavior |
|---|---|
| `replace` | Remove incoming `system` + `developer`, then inject your prompt |
| `prepend` | Put your custom system prompt before the original messages |
| `append` | Keep original privileged messages, then add your custom prompt |
| `passthrough` | Do not modify messages; use PromptRelay only as a provider gateway |

Example:

```json
{
  "prompt": {
    "mode": "replace",
    "file": "system_prompt.txt",
    "placeholder": "{Paste your instructions here}"
  }
}
```

---

# ☁️ Providers

Default provider:

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

Provider examples are included in:

```text
examples/providers/
├── openrouter.json
├── ollama-cloud.json
├── ollama-local.json
└── custom-openai-compatible.json
```

Because provider config is hot-reloaded, changing provider/model does not require restarting PromptRelay.

---

# ⚡ Ollama native mode

For Ollama Cloud or local Ollama, PromptRelay can use native `/api/chat` instead of the OpenAI-compatible chat endpoint.

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

The native adapter translates OpenAI-style requests into Ollama-native messages, tools, reasoning, and streaming responses, then converts them back for OpenCode.

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

Actual support depends on the upstream provider/model.

For OpenAI-compatible providers, reasoning can be normalized to `reasoning_effort`. For Ollama native, it maps to Ollama's `think` setting.

---

# 🛠️ Tool calling

OpenAI-compatible transport forwards tools directly.

Ollama native transport translates:

```text
OpenAI tools         → Ollama tools
Ollama tool calls    → OpenAI tool_calls
OpenAI tool results  → Ollama role:tool history
```

If you use `replace` mode, put strong tool-use rules inside your custom system prompt because the original agent system/developer messages are intentionally removed.

---

# 🔥 Hot reload

| Setting | Restart? |
|---|---:|
| system prompt | No |
| provider | No |
| model | No |
| prompt mode | No |
| reasoning config | No |
| auth/header config | No |
| host/port | **Yes** |

---

# 🧪 Development

Clone manually only if you want to develop PromptRelay itself:

```bash
git clone https://github.com/Monem08/promptrelay.git
cd promptrelay
npm install
npm run check
npm test
npm start
```

Requires Node.js 18+.

---

# 🔐 Security

- Never commit API keys.
- Keep PromptRelay bound to `127.0.0.1` unless you intentionally secure remote access.
- PromptRelay forwards conversation content, code context, tool definitions, and tool results to the configured upstream provider.
- Review the privacy/data-retention policy of your provider.
- `replace` mode deliberately removes client-supplied privileged instructions; use it intentionally.

See [SECURITY.md](SECURITY.md).

---

# 🗺️ Roadmap

- [x] provider-agnostic gateway
- [x] OpenRouter default
- [x] Ollama native adapter
- [x] prompt modes
- [x] reasoning + streaming + tools
- [x] hot reload
- [x] installable CLI
- [x] `init` + `doctor`
- [ ] npm registry release
- [ ] interactive provider setup wizard
- [ ] local authentication token
- [ ] Docker image
- [ ] web dashboard
- [ ] named provider profiles
- [ ] prompt presets/version history
- [ ] latency/token metrics

---

# 📄 License

MIT — see [LICENSE](LICENSE).

<div align="center">

## ⚡ PromptRelay

**Your agent. Your provider. Your prompt.**

</div>

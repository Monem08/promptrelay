<div align="center">

# ⚡ PromptRelay

### Take control of your coding agent's system prompt.

**OpenCode → PromptRelay → OpenRouter / Ollama / any OpenAI-compatible API**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Default Provider: OpenRouter](https://img.shields.io/badge/default-OpenRouter-7B61FF)](https://openrouter.ai/)
[![Prompt Modes](https://img.shields.io/badge/prompt_modes-4-orange)](#prompt-modes)

**Replace. Prepend. Append. Route. Reason. Stream.**

</div>

---

PromptRelay is a lightweight local gateway for coding agents such as **OpenCode**. It sits between your agent and the model provider, lets you control the privileged prompt layer, and forwards the request to your chosen upstream model.

By default, PromptRelay uses **OpenRouter** with `openrouter/auto`. You can switch to another OpenAI-compatible provider—or use the optimized **Ollama native adapter**—without changing the core server code.

> [!IMPORTANT]
> `replace` mode intentionally removes incoming `system` and `developer` messages before injecting your custom system prompt. That can change tool behavior because coding agents often rely on their own system instructions. Use `prepend` or `append` when you want to preserve the original agent harness.

> [!NOTE]
> PromptRelay only controls messages routed through this local proxy. It does **not** override provider-side policies, model-level restrictions, account rules, or platform-enforced behavior.

---

## ✨ Why PromptRelay?

Most coding agents send their own privileged instructions before your task. Sometimes you want to keep them. Sometimes you want to extend them. And sometimes you want a completely custom system prompt.

PromptRelay gives you that choice without hardcoding your prompt into JavaScript:

- 🔁 **4 prompt modes** — `replace`, `prepend`, `append`, `passthrough`
- 📝 **Hot-reloaded prompt file** — edit `system_prompt.txt`; no restart required
- ☁️ **OpenRouter by default** — one API key and you are ready
- 🔌 **Provider-agnostic** — works with OpenAI-compatible endpoints
- ⚡ **Ollama native transport** — optimized `/api/chat` bridge for Ollama Cloud/local
- 🧠 **Reasoning control** — `none`, `low`, `medium`, `high`, `max` where supported
- 🛠️ **Tool calling** — passthrough for OpenAI-compatible providers; translated for Ollama native
- 📡 **Streaming** — SSE passthrough or native Ollama NDJSON → OpenAI SSE conversion
- 🖼️ **Image input bridge** — data-URL images are mapped for Ollama native
- 🔥 **Provider/model hot reload** — edit `promptrelay.json`; next request uses it
- 🔐 **Secrets stay in environment variables** — no API keys in config files
- 🪟 **Windows auto-start script** — Task Scheduler setup included
- 🐧 **Linux setup + systemd example** included
- ✅ **Tests + GitHub Actions CI** included

---

## 🧠 How it works

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

PromptRelay still exposes the interface OpenCode expects:

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
{Ekane tor intrison paste kot}
```

with your own instruction.

Because the prompt lives in a plain text file, you can safely use:

- Markdown
- quotes
- apostrophes
- backticks
- code blocks
- long multi-section instructions

No JavaScript escaping is required.

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

For permanent use, store it in your preferred secret manager, shell profile, or service environment file.

## 5. Start PromptRelay

```bash
npm start
```

You should see something similar to:

```text
══════════════════════════════════════════════
⚡ PROMPTRELAY
══════════════════════════════════════════════
Local       : http://127.0.0.1:4141
Provider    : OpenRouter
Transport   : openai-compatible
Base URL    : https://openrouter.ai/api/v1
Model       : openrouter/auto
Prompt mode : replace
...
```

Check health:

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

The `apiKey` above is only a dummy local value. Your real upstream key remains in `PROVIDER_API_KEY` (or another environment variable you configure).

> [!TIP]
> Set the `context` and `output` numbers to the actual limits of the model you use. PromptRelay does not magically increase model context limits.

Start OpenCode:

```bash
opencode
```

Choose **PromptRelay** and send a test message.

---

# 🎛️ Prompt modes

Set the mode in `promptrelay.json`:

```json
"prompt": {
  "mode": "replace",
  "file": "system_prompt.txt"
}
```

| Mode | What happens |
|---|---|
| `replace` | Removes incoming `system` + `developer`; injects your custom system prompt |
| `prepend` | Adds your custom system prompt before the original messages |
| `append` | Keeps original privileged messages, then adds your custom system prompt before the conversation |
| `passthrough` | Does not modify the prompt at all; PromptRelay acts only as a provider gateway |

### `replace`

```text
IN:
SYSTEM: OpenCode instructions
DEVELOPER: Agent rules
USER: Build this

OUT:
SYSTEM: Your system_prompt.txt
USER: Build this
```

### `prepend`

```text
OUT:
SYSTEM: Your system_prompt.txt
SYSTEM: OpenCode instructions
DEVELOPER: Agent rules
USER: Build this
```

### `append`

```text
OUT:
SYSTEM: OpenCode instructions
DEVELOPER: Agent rules
SYSTEM: Your system_prompt.txt
USER: Build this
```

### `passthrough`

PromptRelay leaves messages untouched.

---

# ☁️ Default provider: OpenRouter

The included `promptrelay.json` uses:

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

### `forceModel: true`

PromptRelay ignores the model name sent by OpenCode and always routes to the model in `promptrelay.json`.

This makes model switching simple: change one value in one file.

Set:

```json
"forceModel": false
```

if you want the model ID sent by OpenCode to pass through dynamically.

---

# 🔄 Switch provider without editing code

Provider settings are loaded from `promptrelay.json` on every request. You can change the provider/model and the next request uses the new settings.

Only server host/port changes require a restart.

Provider examples are included in:

```text
examples/providers/
├── openrouter.json
├── ollama-cloud.json
├── ollama-local.json
└── custom-openai-compatible.json
```

To use an example, copy its contents into `promptrelay.json` and set the required API key.

---

# 🔌 Custom OpenAI-compatible provider

Use:

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

You can override them:

```json
"modelsPath": "models",
"chatPath": "chat/completions"
```

## API-key header auth

For a provider using `x-api-key`:

```json
"auth": {
  "type": "header",
  "headerName": "x-api-key"
}
```

## No authentication

```json
"auth": {
  "type": "none"
}
```

## Custom secret environment variable

```json
"apiKeyEnv": "MY_PROVIDER_KEY"
```

Then set `MY_PROVIDER_KEY` in your environment instead of `PROVIDER_API_KEY`.

---

# ⚡ Ollama Cloud / Ollama Local native mode

PromptRelay includes a dedicated `ollama-native` transport.

Instead of forwarding OpenAI requests to `/v1/chat/completions`, it translates them to Ollama's native `/api/chat` format and converts the response back into the OpenAI-style shape OpenCode expects.

This adapter supports:

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

Local Ollama can use:

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

For OpenAI-compatible providers, explicit reasoning fields are normalized to `reasoning_effort` and otherwise passed through.

For `ollama-native`, reasoning is converted to Ollama's native `think` setting.

Config:

```json
"reasoning": {
  "default": "low",
  "injectDefault": false
}
```

`injectDefault: false` is the safer default for generic OpenAI-compatible providers because not every provider/model accepts `reasoning_effort`.

For Ollama native, `injectDefault` can be enabled and the adapter uses the configured default when the client does not provide a reasoning level.

> [!WARNING]
> Reasoning levels are model/provider dependent. A config value does not guarantee that every upstream model supports that level.

---

# 🛠️ Tool calling

### OpenAI-compatible transport

Tool definitions and tool-call payloads are preserved and forwarded upstream.

### Ollama native transport

PromptRelay translates:

```text
OpenAI tools → Ollama tools
Ollama tool calls → OpenAI tool_calls
OpenAI tool results → Ollama role:tool history
```

This allows OpenCode to keep its normal tool loop while the model runs through native Ollama chat.

Tool behavior still depends heavily on the system prompt. In `replace` mode, include strong tool-use instructions in `system_prompt.txt` if you expect autonomous coding behavior.

A starter prompt is available at:

```text
examples/system-prompt.txt
```

---

# 🔥 Hot reload

These are re-read automatically:

| Setting | Restart required? |
|---|---:|
| `system_prompt.txt` | No |
| provider | No |
| model | No |
| prompt mode | No |
| reasoning defaults | No |
| headers/auth config | No |
| server host/port | **Yes** |

That means you can edit your system prompt and immediately send another OpenCode message—no proxy restart needed.

---

# 🪟 Windows setup

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Start manually:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-windows.ps1
```

## Auto-start with Windows

Run PowerShell as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-autostart-windows.ps1
```

Check:

```powershell
Get-ScheduledTask -TaskName "PromptRelay"
```

Health:

```powershell
curl.exe http://127.0.0.1:4141/health
```

Remove auto-start:

```powershell
Unregister-ScheduledTask -TaskName "PromptRelay" -Confirm:$false
```

> [!TIP]
> If the scheduled task exits immediately, run `node .\src\server.js` manually first. The foreground error usually reveals a missing API key, invalid config, or syntax problem immediately.

---

# 🐧 Linux setup

```bash
chmod +x scripts/setup-linux.sh
./scripts/setup-linux.sh
```

Then:

```bash
export PROVIDER_API_KEY="YOUR_KEY"
npm start
```

A systemd example is included:

```text
scripts/promptrelay.service.example
```

Copy/adapt it to your server and keep secrets in an environment file such as `/etc/promptrelay.env` rather than in the repository.

---

# ⚙️ Environment overrides

Useful overrides:

```text
PROVIDER_API_KEY
PROMPTRELAY_CONFIG
PROMPTRELAY_PROVIDER_NAME
PROMPTRELAY_TRANSPORT
PROMPTRELAY_BASE_URL
PROMPTRELAY_MODEL
PROMPTRELAY_FORCE_MODEL
PROMPTRELAY_PROMPT_MODE
PROMPTRELAY_DEFAULT_REASONING
PROMPTRELAY_HOST
PROMPTRELAY_PORT
PORT
```

Example:

```bash
PROMPTRELAY_MODEL="another-model" npm start
```

---

# 🧪 Testing

Syntax check:

```bash
npm run check
```

Unit tests:

```bash
npm test
```

The repository also includes GitHub Actions CI for Node.js 18, 20, and 22.

---

# 🔍 Troubleshooting

## `promptConfigured: false`

Open `system_prompt.txt` and replace:

```text
{Ekane tor intrison paste kot}
```

with your prompt.

## `apiKeyConfigured: false`

Your configured environment variable is missing.

On Windows:

```powershell
$env:PROVIDER_API_KEY
```

If you just created a persistent environment variable, open a new PowerShell session.

## Port `4141` is unreachable

Run PromptRelay in the foreground:

```bash
npm start
```

Then inspect the actual error.

Also check syntax:

```bash
npm run check
```

## Provider returns `401` or `403`

Check:

- API key
- `apiKeyEnv`
- auth type
- provider account permissions
- provider base URL

## Model not found

Use the exact upstream model ID, or set:

```json
"forceModel": false
```

if you want OpenCode to send the model dynamically.

## Tools became worse after enabling `replace`

That is expected for some agent harnesses: their original system/developer prompts may contain tool-use instructions.

Try:

```json
"mode": "prepend"
```

or add explicit tool rules to your custom prompt.

## OpenAI-compatible Ollama path is slow

Use:

```json
"transport": "ollama-native"
```

so PromptRelay routes chat through native `/api/chat` instead.

---

# 🔐 Security

- Never commit API keys.
- Never paste real keys into screenshots, README files, issues, or logs.
- Keep PromptRelay bound to `127.0.0.1` unless you intentionally add authentication/TLS for remote access.
- PromptRelay forwards conversation content, code context, tool definitions, and tool results to the configured upstream provider.
- Review the privacy/data-retention policy of whichever provider you configure.
- `replace` mode can remove safety/tooling instructions supplied by the client. Use it deliberately.

If you discover a security issue, see [SECURITY.md](SECURITY.md).

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
│
├── examples/
│   ├── system-prompt.txt
│   └── providers/
│       ├── openrouter.json
│       ├── ollama-cloud.json
│       ├── ollama-local.json
│       └── custom-openai-compatible.json
│
├── scripts/
│   ├── setup-windows.ps1
│   ├── start-windows.ps1
│   ├── install-autostart-windows.ps1
│   ├── setup-linux.sh
│   └── promptrelay.service.example
│
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

### v1.x

- [x] OpenRouter default configuration
- [x] Generic OpenAI-compatible transport
- [x] Ollama native transport
- [x] Replace / prepend / append / passthrough modes
- [x] Prompt hot reload
- [x] Provider/model hot reload
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

### Future

- [ ] Web dashboard
- [ ] Multiple named provider profiles
- [ ] Runtime provider/model switching endpoint
- [ ] Prompt presets
- [ ] Prompt version history
- [ ] Latency/token metrics
- [ ] More agent/client presets

---

# 🤝 Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

If you add a provider-specific adapter, keep the OpenAI-facing PromptRelay API stable whenever possible:

```text
/v1/models
/v1/chat/completions
```

---

# 📄 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

**PromptRelay**

*Your agent. Your provider. Your prompt.* ⚡

</div>

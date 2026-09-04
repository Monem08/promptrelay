<div align="center">

# ⚡ PromptRelay

### Your agent. Your provider. Your system prompt.

**OpenCode → PromptRelay → OpenRouter / Ollama / any OpenAI-compatible API**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Default Provider: OpenRouter](https://img.shields.io/badge/default-OpenRouter-7B61FF)](https://openrouter.ai/)
[![CLI](https://img.shields.io/badge/CLI-promptrelay-black)](#-cli-reference)
[![OpenCode](https://img.shields.io/badge/OpenCode-ready-00A67E)](https://opencode.ai/)

**Install → Setup → Start.**

```bash
npm i -g github:Monem08/promptrelay
promptrelay setup
promptrelay
```

</div>

---

PromptRelay is a lightweight local gateway for coding agents such as **OpenCode**. It gives you control over the system-prompt layer while preserving provider routing, streaming, reasoning, and tool calling behind a single local OpenAI-compatible endpoint.

The normal setup requires **no JSON editing**.

> [!IMPORTANT]
> `replace` mode removes incoming `system` and `developer` messages before injecting your custom prompt. This can also remove useful OpenCode tool instructions. Use `prepend` when you want your custom rules **and** the original OpenCode harness.

> [!NOTE]
> PromptRelay changes only the requests routed through this local proxy. It does not bypass upstream provider policies, model limitations, account restrictions, or platform-enforced behavior.

---

## ✨ Highlights

- ⚡ **3-step install** — install, run setup, start
- 🧙 **Interactive setup wizard** — no manual config required
- 🔌 **Custom providers** — OpenAI-compatible and Ollama-native
- ☁️ **OpenRouter default** — easiest first-run path
- 🦙 **Ollama Cloud + Local** — native `/api/chat` adapter
- 📝 **Custom system prompts** — plain text, hot-reloaded
- 🔁 **4 prompt modes** — replace, prepend, append, passthrough
- 🧠 **Reasoning mapping** — none / low / medium / high / max where supported
- 🛠️ **Tool calling** — passthrough or native translation
- 📡 **Streaming** — OpenAI SSE and Ollama NDJSON conversion
- 🔐 **Local secret storage** — API keys can live in `~/.promptrelay/.env`
- 🩺 **Built-in diagnostics** — `promptrelay doctor`
- 🛠️ **OpenCode config generator** — safe install without overwriting existing config
- 🔥 **Hot reload** — prompt/provider/model changes apply without restart

---

## 🧭 Table of contents

- [Quick start](#-quick-start)
- [How PromptRelay works](#-how-promptrelay-works)
- [Provider setup](#-provider-setup)
- [Custom provider setup](#-custom-provider-setup)
- [Prompt modes](#-prompt-modes)
- [OpenCode setup](#-opencode-setup)
- [CLI reference](#-cli-reference)
- [Reasoning](#-reasoning)
- [Tool calling](#-tool-calling)
- [Hot reload](#-hot-reload)
- [Advanced config](#-advanced-config)
- [Security model](#-security-model)
- [Troubleshooting](#-troubleshooting)

---

# 🚀 Quick start

## 1. Install

Install directly from GitHub:

```bash
npm i -g github:Monem08/promptrelay
```

After npm publication, the package is prepared for:

```bash
npm i -g @monem08/promptrelay
```

Requires **Node.js 18+**.

## 2. Run setup

```bash
promptrelay setup
```

You will get an interactive provider menu:

```text
⚡ PromptRelay Setup

Select your provider
  1. OpenRouter — easiest / recommended
  2. Ollama Cloud — native fast mode
  3. Ollama Local — no API key
  4. Custom OpenAI-compatible provider
  5. Custom Ollama-native provider

Choose: _
```

The wizard handles:

```text
Provider
→ Model
→ Authentication / API key
→ Prompt mode
→ System instruction
→ OpenCode config
```

## 3. Start

```bash
promptrelay
```

Check everything anytime:

```bash
promptrelay doctor
```

---

# 🧠 How PromptRelay works

```text
┌────────────────────────────────────────────┐
│                  OpenCode                  │
│                                            │
│ user message + tools + original prompts   │
└──────────────────────┬─────────────────────┘
                       │
                       │ OpenAI-compatible request
                       ▼
┌────────────────────────────────────────────┐
│                PromptRelay                 │
│                                            │
│  Prompt Policy                             │
│  ├─ replace                                │
│  ├─ prepend                                │
│  ├─ append                                 │
│  └─ passthrough                            │
│                                            │
│  Routing                                   │
│  ├─ model override                         │
│  ├─ provider auth                          │
│  └─ custom headers                         │
│                                            │
│  Compatibility                             │
│  ├─ streaming                              │
│  ├─ reasoning                              │
│  ├─ tools                                  │
│  └─ Ollama native translation              │
└──────────────────────┬─────────────────────┘
                       │
             ┌─────────┴─────────┐
             │                   │
             ▼                   ▼
┌─────────────────────┐  ┌─────────────────────┐
│ OpenAI-compatible   │  │ Ollama native       │
│                     │  │                     │
│ OpenRouter          │  │ Ollama Cloud        │
│ custom providers    │  │ Ollama Local        │
│ compatible APIs     │  │ /api/chat           │
└─────────────────────┘  └─────────────────────┘
```

PromptRelay exposes the local API OpenCode expects:

```text
GET  /health
GET  /v1/models
POST /v1/chat/completions
```

Default local base URL:

```text
http://127.0.0.1:4141/v1
```

---

# 🔌 Provider setup

## Built-in choices

| Provider | Transport | API key | Best for |
|---|---|---:|---|
| **OpenRouter** | OpenAI-compatible | Yes | easiest multi-model setup |
| **Ollama Cloud** | Ollama native | Yes | native reasoning + Ollama models |
| **Ollama Local** | Ollama native | No | local/private models |
| **Custom OpenAI-compatible** | OpenAI-compatible | Optional | most third-party APIs |
| **Custom Ollama-native** | Ollama native | Optional | Ollama-like native endpoints |

Change provider anytime:

```bash
promptrelay provider
```

No `server.js` editing required.

---

# 🔧 Custom provider setup

Run:

```bash
promptrelay provider
```

Choose:

```text
4. Custom OpenAI-compatible provider
```

PromptRelay asks only for the values that matter:

```text
Provider name
Base URL
Model ID
Authentication type
API key, if required
```

Example:

```text
Provider name: My Provider
Base URL: https://api.example.com/v1
Model ID: my-model
Authentication:
  1. Bearer token / API key
  2. Custom header
  3. No authentication
```

### Bearer authentication

Use this for APIs that expect:

```http
Authorization: Bearer YOUR_KEY
```

### Custom header authentication

For APIs using headers such as:

```http
x-api-key: YOUR_KEY
```

choose **Custom header** and enter:

```text
x-api-key
```

### No authentication

Perfect for many local servers:

```text
Authentication → No authentication
```

---

# 🎛️ Prompt modes

PromptRelay can either replace or preserve the original OpenCode privileged instructions.

| Mode | Original system/developer | Custom prompt | Recommended use |
|---|---:|---:|---|
| `replace` | Removed | Yes | full custom behavior |
| `prepend` | Kept | Before original | best OpenCode compatibility |
| `append` | Kept | After original privileged layer | additional constraints/preferences |
| `passthrough` | Kept | No | provider gateway only |

### Replace

```text
Incoming:
SYSTEM: OpenCode system prompt
DEVELOPER: OpenCode agent rules
USER: Build this feature

Forwarded:
SYSTEM: Your system_prompt.txt
USER: Build this feature
```

### Prepend

```text
SYSTEM: Your system_prompt.txt
SYSTEM: OpenCode system prompt
DEVELOPER: OpenCode agent rules
USER: Build this feature
```

For most users:

- choose **`replace`** if the goal is complete custom system instructions
- choose **`prepend`** if you want custom rules while keeping OpenCode's tool behavior

---

# ✍️ System prompt editing

Open your prompt:

```bash
promptrelay prompt
```

Default location:

```text
~/.promptrelay/system_prompt.txt
```

The prompt is a normal text file, so this is safe:

```text
# Coding Rules

Use tools proactively.
Read files before editing.
Run relevant tests after changes.

`backticks` are fine.

```js
console.log("code blocks are fine too");
```
```

Prompt changes are hot-reloaded on the **next request**.

---

# 🛠️ OpenCode setup

During setup, answer **Yes** to:

```text
Generate OpenCode config automatically? (Y/n)
```

If OpenCode has no config yet, PromptRelay installs:

```text
~/.config/opencode/opencode.jsonc
```

If a config already exists, it is **not overwritten**. PromptRelay writes a safe alternate file:

```text
~/.config/opencode/opencode.promptrelay.jsonc
```

Generate again anytime:

```bash
promptrelay opencode
```

OpenCode connects to:

```text
http://127.0.0.1:4141/v1
```

---

# ⚡ CLI reference

| Command | Purpose |
|---|---|
| `promptrelay` | start the local gateway |
| `promptrelay setup` | full interactive setup |
| `promptrelay provider` | change provider/model/auth |
| `promptrelay prompt` | open system prompt |
| `promptrelay config` | open advanced JSON config |
| `promptrelay opencode` | generate/install OpenCode config |
| `promptrelay doctor` | validate config, provider key and prompt |
| `promptrelay init` | create config files only |
| `promptrelay path` | print PromptRelay home directory |
| `promptrelay --version` | show version |
| `promptrelay --help` | show CLI help |

First run is friendly too: if user config does not exist and you run `promptrelay` in an interactive terminal, PromptRelay launches setup automatically.

---

# 🧠 Reasoning

PromptRelay understands these normalized reasoning levels where supported:

```text
none
low
medium
high
max
```

### OpenAI-compatible transport

PromptRelay can map reasoning to:

```text
reasoning_effort
```

### Ollama-native transport

PromptRelay maps reasoning to Ollama's native:

```text
think
```

and converts streamed reasoning back into the OpenAI-style shape OpenCode expects.

> [!WARNING]
> Reasoning support is provider/model-specific. A configured level does not guarantee the upstream model supports it.

---

# 🛠️ Tool calling

## OpenAI-compatible providers

PromptRelay forwards tool definitions and tool-call payloads upstream.

## Ollama native

PromptRelay translates:

```text
OpenAI tools        → Ollama tools
Ollama tool calls   → OpenAI tool_calls
OpenAI tool results → Ollama role:tool history
```

This keeps OpenCode's normal tool loop working while the model is served through native Ollama `/api/chat`.

If tool behavior becomes weaker after switching to `replace`, either:

```text
1. use prepend mode
or
2. add explicit tool-use rules to your custom system prompt
```

---

# 🦙 Why Ollama native mode exists

PromptRelay includes a dedicated `ollama-native` adapter instead of forcing Ollama through the OpenAI-compatible chat endpoint.

It handles:

- `/api/chat`
- native `think` reasoning
- streamed thinking
- tool definitions
- tool calls/results
- image data URLs
- usage conversion
- Ollama NDJSON → OpenAI SSE

For Ollama Cloud or Ollama Local, this is the recommended transport.

---

# 🔥 Hot reload

| Setting | Restart required? |
|---|---:|
| system prompt | No |
| provider | No |
| model | No |
| prompt mode | No |
| reasoning defaults | No |
| authentication/header config | No |
| server host/port | **Yes** |

That means this workflow works:

```text
edit prompt/provider config
        ↓
save
        ↓
send next OpenCode request
        ↓
new config is active
```

---

# ⚙️ Advanced config

Most users should use:

```bash
promptrelay setup
```

Advanced users can open:

```bash
promptrelay config
```

Default config location:

```text
~/.promptrelay/promptrelay.json
```

### Custom OpenAI-compatible example

```json
{
  "provider": {
    "name": "My Provider",
    "transport": "openai-compatible",
    "baseURL": "https://api.example.com/v1",
    "model": "my-model",
    "forceModel": true,
    "apiKeyEnv": "PROVIDER_API_KEY",
    "auth": {
      "type": "bearer"
    },
    "headers": {}
  }
}
```

### Custom header auth

```json
{
  "auth": {
    "type": "header",
    "headerName": "x-api-key"
  }
}
```

### No auth

```json
{
  "auth": {
    "type": "none"
  }
}
```

### Dynamic model routing

With:

```json
"forceModel": true
```

PromptRelay always uses the model configured in `promptrelay.json`.

With:

```json
"forceModel": false
```

PromptRelay allows the model ID sent by the client to pass through.

---

# 🔐 Security model

PromptRelay is designed as a **local gateway**, not a public internet-facing proxy.

### Local secrets

Wizard-entered keys are stored in:

```text
~/.promptrelay/.env
```

Real environment variables take priority over values from the local `.env` file.

### Recommended deployment

Keep the server bound to:

```text
127.0.0.1
```

unless you intentionally add proper authentication and TLS for remote access.

### Data flow

When you use PromptRelay, the configured upstream provider may receive:

```text
conversation content
code context
system instructions
tool definitions
tool results
image inputs
```

Review the provider's privacy and retention policy before sending sensitive code or data.

### Never commit

```text
.env
API keys
provider secrets
screenshots containing keys
```

See [SECURITY.md](SECURITY.md).

---

# 🩺 Troubleshooting

Start with:

```bash
promptrelay doctor
```

## Missing API key

```bash
promptrelay provider
```

Re-enter the provider key.

## Wrong provider or model

```bash
promptrelay provider
```

No manual JSON editing is required.

## Prompt not configured

```bash
promptrelay prompt
```

Save your instruction and retry.

## Port 4141 is unreachable

Run PromptRelay in the foreground:

```bash
promptrelay
```

The terminal should show the actual startup or provider error.

## OpenCode already has a config

Run:

```bash
promptrelay opencode
```

PromptRelay keeps the existing file and generates:

```text
~/.config/opencode/opencode.promptrelay.jsonc
```

## Ollama OpenAI-compatible path is slow

Run:

```bash
promptrelay provider
```

Then choose **Ollama Cloud** or **Ollama Local** so PromptRelay uses the native adapter.

## Tools work worse in replace mode

Try:

```text
prepend
```

or add explicit tool rules to your custom prompt.

---

# 📁 Files and directories

User configuration:

```text
~/.promptrelay/
├── promptrelay.json
├── system_prompt.txt
├── .env
└── opencode.jsonc.example
```

Repository internals:

```text
promptrelay/
├── bin/
│   └── promptrelay.js
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
├── scripts/
├── test/
├── promptrelay.json
├── system_prompt.txt
├── opencode.jsonc.example
└── README.md
```

---

# 🧪 Development

```bash
git clone https://github.com/Monem08/promptrelay.git
cd promptrelay
npm install
npm run check
npm test
```

GitHub Actions is configured for Node.js 18, 20, and 22.

---

# 🗺️ Roadmap

- [x] OpenRouter default
- [x] interactive setup wizard
- [x] custom OpenAI-compatible providers
- [x] Ollama native adapter
- [x] replace / prepend / append / passthrough
- [x] prompt/provider/model hot reload
- [x] reasoning normalization
- [x] streaming
- [x] tool calling
- [x] OpenCode config generator
- [x] doctor command
- [ ] named provider profiles
- [ ] `promptrelay test` provider connectivity check
- [ ] per-model reasoning presets
- [ ] local web dashboard
- [ ] Docker image
- [ ] optional local authentication token
- [ ] latency/token metrics
- [ ] prompt presets and version history

---

# 🤝 Contributing

Issues and pull requests are welcome.

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# 📄 License

MIT — see [LICENSE](LICENSE).

---

<div align="center">

## PromptRelay ⚡

**Your agent. Your provider. Your prompt.**

</div>

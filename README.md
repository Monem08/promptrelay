<div align="center">

# ⚡ PromptRelay

### Your agent. Your provider. Your system prompt.

**OpenCode → PromptRelay → OpenRouter / Ollama / any OpenAI-compatible API**

[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Default Provider: OpenRouter](https://img.shields.io/badge/default-OpenRouter-7B61FF)](https://openrouter.ai/)
[![CLI](https://img.shields.io/badge/CLI-promptrelay-black)](#-cli)

**Install. Run setup. Start.**

</div>

---

PromptRelay is a local gateway for coding agents such as **OpenCode**. It lets you use your own system instruction, switch model providers, and keep streaming, reasoning, and tool calling behind one local OpenAI-compatible endpoint.

The normal setup does **not** require editing JSON.

> [!IMPORTANT]
> `replace` mode removes incoming `system` and `developer` messages before injecting your prompt. That can remove useful OpenCode tool instructions too. Use `prepend` or `append` if you want to preserve the original agent harness.

---

# 🚀 3-step setup

## 1. Install

From GitHub right now:

```bash
npm i -g github:Monem08/promptrelay
```

After the npm package is published:

```bash
npm i -g @monem08/promptrelay
```

Requires **Node.js 18+**.

## 2. Run the setup wizard

```bash
promptrelay setup
```

PromptRelay asks you for everything it needs:

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

Then it asks for the model, API key/auth if needed, prompt mode, and system instruction. It can also generate the OpenCode config automatically.

Secrets entered during setup are stored locally in:

```text
~/.promptrelay/.env
```

The file is not meant to be committed to Git.

## 3. Start

```bash
promptrelay
```

Done. ⚡

Check the setup anytime:

```bash
promptrelay doctor
```

---

# 🔌 Custom provider setup

You do **not** need to edit `server.js`.

Run:

```bash
promptrelay provider
```

Choose:

```text
4. Custom OpenAI-compatible provider
```

PromptRelay will ask for:

```text
Provider name
Base URL
Model ID
Authentication type
API key (when needed)
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

For an API that uses `x-api-key`, choose **Custom header** and enter:

```text
x-api-key
```

For a local service with no authentication, choose **No authentication**.

Provider and model config are hot-reloaded, so changing provider settings does not normally require restarting PromptRelay.

---

# ☁️ Built-in provider choices

| Provider | Transport | Default setup |
|---|---|---|
| OpenRouter | OpenAI-compatible | `https://openrouter.ai/api/v1` |
| Ollama Cloud | Ollama native | `https://ollama.com/api/chat` |
| Ollama Local | Ollama native | `http://127.0.0.1:11434` |
| Custom OpenAI-compatible | OpenAI-compatible | You enter Base URL + model |
| Custom Ollama-native | Ollama native | You enter Base URL + model |

OpenRouter is the default/easiest option.

---

# 🧠 Prompt modes

The setup wizard lets you choose one:

| Mode | Behavior |
|---|---|
| `replace` | Remove incoming `system` + `developer`, then use your prompt |
| `prepend` | Add your prompt before OpenCode's original instructions |
| `append` | Keep OpenCode instructions, then add your prompt |
| `passthrough` | Do not modify prompts; use PromptRelay only as a provider gateway |

For most users who want **full custom instructions**, choose `replace`.

For better compatibility with OpenCode's built-in tool behavior, try `prepend`.

---

# ✍️ Change your system prompt

Open it with:

```bash
promptrelay prompt
```

On Windows this opens the file in Notepad. You can also edit it directly:

```text
~/.promptrelay/system_prompt.txt
```

The prompt is hot-reloaded. Save the file and the **next request** uses the new instruction—no restart needed.

The prompt is plain text, so Markdown, quotes, backticks, code blocks, and long instructions are safe.

---

# 🛠️ OpenCode setup

During `promptrelay setup`, answer **Yes** when it asks:

```text
Generate OpenCode config automatically? (Y/n)
```

If OpenCode has no config yet, PromptRelay writes:

```text
~/.config/opencode/opencode.jsonc
```

If a config already exists, PromptRelay does **not** overwrite it. Instead it writes a safe example next to it:

```text
~/.config/opencode/opencode.promptrelay.jsonc
```

You can also generate it later:

```bash
promptrelay opencode
```

The OpenCode-facing endpoint is:

```text
http://127.0.0.1:4141/v1
```

---

# ⚡ CLI

```text
promptrelay setup        Full interactive setup
promptrelay              Start PromptRelay
promptrelay provider     Change provider/model interactively
promptrelay prompt       Open system_prompt.txt
promptrelay config       Open promptrelay.json
promptrelay opencode     Generate/install OpenCode config
promptrelay doctor       Validate provider, key, model and prompt
promptrelay init         Create config files only
promptrelay path         Show PromptRelay home directory
promptrelay --version    Show version
promptrelay --help       Show help
```

First run is friendly too: if no user config exists and you simply run `promptrelay` in an interactive terminal, PromptRelay launches the setup wizard.

---

# 🧠 Reasoning

PromptRelay recognizes these reasoning levels where the upstream model supports them:

```text
none
low
medium
high
max
```

For OpenAI-compatible providers it can map reasoning to `reasoning_effort`.

For Ollama native transport it maps reasoning to native `think` values and converts streamed thinking back into the OpenAI-style response expected by OpenCode.

Actual reasoning support depends on the provider/model.

---

# 🛠️ Tool calling

For OpenAI-compatible providers, PromptRelay forwards tool definitions and tool-call payloads.

For Ollama native providers, it translates:

```text
OpenAI tools        → Ollama tools
Ollama tool calls   → OpenAI tool_calls
OpenAI tool results → Ollama role:tool history
```

This allows OpenCode's tool loop to continue through Ollama native `/api/chat`.

If tools become weaker in `replace` mode, use `prepend` or include explicit tool rules in your custom system prompt.

---

# ⚡ Why Ollama native mode exists

PromptRelay has a dedicated `ollama-native` adapter instead of forcing Ollama through the OpenAI-compatible chat path.

It handles:

- native `/api/chat`
- native `think` reasoning
- streaming reasoning
- tool calls/results
- image data URLs
- OpenAI SSE conversion for OpenCode

Use it for Ollama Cloud or local Ollama when you want the native transport.

---

# 🔥 Hot reload

| Setting | Restart required? |
|---|---:|
| System prompt | No |
| Provider | No |
| Model | No |
| Prompt mode | No |
| Reasoning defaults | No |
| Auth/header config | No |
| Server host/port | **Yes** |

---

# ⚙️ Advanced manual config

Most users should use:

```bash
promptrelay setup
```

But advanced users can edit:

```text
~/.promptrelay/promptrelay.json
```

or simply run:

```bash
promptrelay config
```

Example custom OpenAI-compatible provider:

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

Example custom header auth:

```json
"auth": {
  "type": "header",
  "headerName": "x-api-key"
}
```

No auth:

```json
"auth": {
  "type": "none"
}
```

---

# 🩺 Troubleshooting

Run this first:

```bash
promptrelay doctor
```

### Missing API key

Run:

```bash
promptrelay provider
```

and enter the key again.

### Wrong model or provider

```bash
promptrelay provider
```

No manual JSON editing is required.

### Prompt not configured

```bash
promptrelay prompt
```

Save your instruction, then try again.

### Port 4141 not responding

Start PromptRelay in the foreground:

```bash
promptrelay
```

The terminal will show the real startup/provider error.

### OpenAI-compatible Ollama path is slow

Re-run:

```bash
promptrelay provider
```

and choose **Ollama Cloud** or **Ollama Local** so PromptRelay uses the native adapter.

---

# 🔐 Security

- API keys are not stored in `promptrelay.json`.
- The setup wizard stores them in local `~/.promptrelay/.env` when you enter them there.
- Real environment variables override values from the local `.env` file.
- Never commit `.env`, API keys, or screenshots containing secrets.
- Keep the proxy on `127.0.0.1` unless you intentionally add proper remote authentication/TLS.
- PromptRelay forwards conversation/code/tool context to the upstream provider you configure.
- `replace` mode can remove client-provided instructions; use it deliberately.

See [SECURITY.md](SECURITY.md).

---

# 📁 Main files

```text
~/.promptrelay/
├── promptrelay.json
├── system_prompt.txt
├── .env
└── opencode.jsonc.example
```

Repository internals:

```text
src/
├── server.js
├── config.js
├── prompt.js
├── reasoning.js
├── http.js
└── adapters/
    ├── openai-compatible.js
    └── ollama-native.js
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

GitHub Actions tests Node.js 18, 20, and 22.

---

# 📄 License

MIT — see [LICENSE](LICENSE).

<div align="center">

### PromptRelay ⚡

**Your agent. Your provider. Your prompt.**

</div>

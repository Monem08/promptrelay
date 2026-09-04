# Contributing to PromptRelay

Thanks for helping improve PromptRelay.

## Development setup

```bash
npm install
npm run check
npm test
npm start
```

## Before opening a PR

- Keep API keys and private prompts out of commits.
- Run `npm run check` and `npm test`.
- Keep the local API compatible with `/v1/models` and `/v1/chat/completions` unless the change explicitly introduces a new version.
- Add tests for prompt-policy or reasoning behavior changes.
- Provider-specific behavior should live in an adapter rather than the core server when practical.

## Pull requests

Please include:

1. What changed.
2. Why it changed.
3. How it was tested.
4. Any provider/model-specific limitations.

## Provider adapters

Adapters live in `src/adapters/`. A provider adapter should expose:

```js
{
  models(req, res, config),
  chat(req, res, config)
}
```

Do not log secrets.

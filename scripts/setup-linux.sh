#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (18+)."
  exit 1
fi

MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$MAJOR" -lt 18 ]; then
  echo "PromptRelay requires Node.js 18+. Current: $(node -v)"
  exit 1
fi

npm install
npm run check
npm test

echo "PromptRelay is ready."
echo "Edit system_prompt.txt, set PROVIDER_API_KEY, then run: npm start"

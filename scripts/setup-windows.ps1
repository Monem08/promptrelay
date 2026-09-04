$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Write-Host "⚡ PromptRelay Windows setup" -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js is not installed or is not in PATH. Install Node.js 18+ first."
}

$nodeMajor = [int]((node -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 18) {
  throw "PromptRelay requires Node.js 18+. Current: $(node -v)"
}

npm install
npm run check
npm test

Write-Host ""
Write-Host "✅ PromptRelay is ready." -ForegroundColor Green
Write-Host "1. Edit system_prompt.txt"
Write-Host "2. Set PROVIDER_API_KEY"
Write-Host "3. Run: npm start"

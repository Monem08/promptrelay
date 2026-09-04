$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source
$Server = Join-Path $Root "src\server.js"
$TaskName = "PromptRelay"

$action = New-ScheduledTaskAction `
  -Execute $Node `
  -Argument ('"' + $Server + '"') `
  -WorkingDirectory $Root

$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -StartWhenAvailable

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -RunLevel Highest `
  -User "SYSTEM" `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 2

Write-Host "✅ PromptRelay auto-start task installed." -ForegroundColor Green
Write-Host "Task: $TaskName"
Write-Host "Health: http://127.0.0.1:4141/health"

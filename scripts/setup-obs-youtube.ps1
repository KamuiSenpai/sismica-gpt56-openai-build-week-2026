#Requires -Version 5

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$obsExe = "C:\Program Files\obs-studio\bin\64bit\obs64.exe"
$obsConfigRoot = Join-Path $env:APPDATA "obs-studio"
$webSocketConfig = Join-Path $obsConfigRoot "plugin_config\obs-websocket\config.json"
$userConfig = Join-Path $obsConfigRoot "user.ini"
$sentinel = Join-Path $obsConfigRoot ".sentinel"

if (-not (Test-Path $obsExe)) {
  throw "OBS Studio no esta instalado en $obsExe"
}
if (-not (Test-Path $webSocketConfig)) {
  throw "OBS debe iniciarse al menos una vez antes de ejecutar este configurador"
}

$backupRoot = Join-Path $root ("output\obs-config-backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

$running = Get-Process obs64 -ErrorAction SilentlyContinue
if ($running) {
  foreach ($process in $running) {
    [void]$process.CloseMainWindow()
  }
  Start-Sleep -Seconds 3
  Get-Process obs64 -ErrorAction SilentlyContinue | Stop-Process -Force
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
Copy-Item -LiteralPath $obsConfigRoot -Destination $backupRoot -Recurse -Force

# A forced shutdown can leave this marker behind and make OBS start in safe mode.
if (Test-Path $sentinel) {
  Move-Item -LiteralPath $sentinel -Destination (Join-Path $backupRoot ".sentinel-runtime") -Force
}

if (Test-Path $userConfig) {
  $userSettings = Get-Content $userConfig -Raw
  $userSettings = $userSettings -replace '(?m)^FirstRun=.*$', 'FirstRun=false'
  $userSettings = $userSettings -replace '(?m)^ConfirmOnExit=.*$', 'ConfirmOnExit=false'
  Set-Content -LiteralPath $userConfig -Value $userSettings -Encoding UTF8
}

$webSocket = Get-Content $webSocketConfig -Raw | ConvertFrom-Json
$webSocket.server_enabled = $true
$webSocket.auth_required = $true
$webSocket.alerts_enabled = $false
$webSocket | ConvertTo-Json -Depth 8 | Set-Content $webSocketConfig -Encoding UTF8

Start-Process -FilePath $obsExe -WorkingDirectory (Split-Path $obsExe) `
  -ArgumentList @("--minimize-to-tray", "--disable-shutdown-check") -WindowStyle Hidden

$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $connection = New-Object System.Net.Sockets.TcpClient
    $connection.Connect("127.0.0.1", 4455)
    $connection.Close()
    $ready = $true
    break
  } catch {
    Start-Sleep -Milliseconds 500
  }
}
if (-not $ready) {
  throw "OBS WebSocket no respondio en el puerto 4455"
}

Push-Location $root
try {
  node scripts\configure-obs-youtube.mjs
  if ($LASTEXITCODE -ne 0) { throw "El configurador WebSocket de OBS fallo" }
} finally {
  Pop-Location
}

Write-Host "OBS configurado. Respaldo: $backupRoot" -ForegroundColor Green

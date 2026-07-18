#Requires -Version 5
<#
  Lanzador de la plataforma sismica.
  Levanta todo en orden: shared -> Postgres -> API -> Worker -> Chatterbox -> Web,
  cada servicio en su propia ventana. Chatterbox usa la GPU y XTTS-v2 queda deshabilitado.

  Uso:  boton derecho > "Ejecutar con PowerShell", o via el acceso directo.
        (o)  powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
        (o)  powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1 -VoiceEngine chatterbox
#>

param(
  [ValidateSet("chatterbox", "none")]
  [string]$VoiceEngine = "chatterbox"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "== Plataforma sismica :: arranque ==" -ForegroundColor Cyan
Write-Host "Raiz del proyecto: $root`n"

function Test-Port {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $Port)
    $client.Close()
    return $true
  } catch {
    return $false
  }
}

function Test-ProcessCommand {
  param([string]$Pattern)
  if (-not $Pattern) { return $false }
  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "node|powershell" -and $_.CommandLine -match $Pattern }
  return $processes.Count -gt 0
}

function Ensure-ServiceWindow {
  param(
    [string]$Title,
    [string]$WorkDir,
    [string]$Command,
    [Nullable[int]]$Port = $null,
    [string]$CommandMatch = "",
    [string]$Description
  )
  if ($Port -and (Test-Port -Port $Port)) {
    Write-Host ("  -> {0} ya responde en :{1}; no se abre otra ventana" -f $Description, $Port) -ForegroundColor DarkYellow
    return
  }
  if ($CommandMatch -and (Test-ProcessCommand -Pattern $CommandMatch)) {
    Write-Host ("  -> {0} ya tiene un proceso activo; no se abre otra ventana" -f $Description) -ForegroundColor DarkYellow
    return
  }
  Start-ServiceWindow -Title $Title -WorkDir $WorkDir -Command $Command
}

function Start-ServiceWindow {
  param([string]$Title, [string]$WorkDir, [string]$Command)
  $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $inner
  ) | Out-Null
  Write-Host ("  -> ventana '{0}' abierta" -f $Title) -ForegroundColor Green
}

function Resolve-VoiceEngineSelection {
  param([string]$Requested)
  if ($Requested -eq "none") { return "none" }
  return "chatterbox"
}

function Get-ProcessTreeIds {
  param([int[]]$RootIds)

  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  $queue = [System.Collections.Generic.Queue[int]]::new()
  $visited = [System.Collections.Generic.HashSet[int]]::new()

  foreach ($rootId in $RootIds) {
    if ($rootId -gt 0 -and $visited.Add($rootId)) {
      $queue.Enqueue($rootId)
    }
  }

  while ($queue.Count -gt 0) {
    $currentId = $queue.Dequeue()
    foreach ($child in $all | Where-Object ParentProcessId -eq $currentId) {
      $childId = [int]$child.ProcessId
      if ($visited.Add($childId)) {
        $queue.Enqueue($childId)
      }
    }
  }

  $result = @()
  foreach ($procId in $visited) {
    $result += [int]$procId
  }
  return [int[]]$result
}

function Stop-ServiceProcesses {
  param(
    [string]$Description,
    [string[]]$CommandPatterns,
    [int[]]$Ports = @()
  )

  $processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  $rootIds = @()

  foreach ($pattern in $CommandPatterns) {
    $rootIds += $processes |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pattern } |
      Select-Object -ExpandProperty ProcessId
  }

  foreach ($port in $Ports) {
    try {
      $rootIds += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess
    } catch {
      # Best-effort: si Get-NetTCPConnection no existe o falla, usa solo el patron.
    }
  }

  $rootIds = $rootIds | Where-Object { $_ -and $_ -ne $PID } | Select-Object -Unique
  if (-not $rootIds) { return }

  $allIds = Get-ProcessTreeIds -RootIds $rootIds | Sort-Object -Descending
  foreach ($procId in $allIds) {
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }

  Write-Host ("  -> {0} detenido para mantener GPU exclusiva" -f $Description) -ForegroundColor DarkYellow
}

$selectedVoiceEngine = Resolve-VoiceEngineSelection -Requested $VoiceEngine
$selectedVoiceLabel = switch ($selectedVoiceEngine) {
  "chatterbox" { "Chatterbox" }
  default { "Ninguno" }
}

Write-Host "Motor neural seleccionado: $selectedVoiceLabel`n" -ForegroundColor Cyan

# 0) Paquete compartido (los dev servers importan @sismica/shared desde dist/).
Write-Host "[0/5] Construyendo @sismica/shared..." -ForegroundColor Yellow
npm run build -w packages/shared

# 1) PostgreSQL (el script espera a que acepte conexiones y retorna).
Write-Host "`n[1/5] Iniciando PostgreSQL..." -ForegroundColor Yellow
npm run db:start

Write-Host "[1.5/5] Aplicando migraciones..." -ForegroundColor Yellow
npm run db:migrate

$chatterboxDir = Join-Path $root "services\tts-chatterbox"

# 2..5) Servicios de larga duracion, cada uno en su ventana.
Write-Host "`n[2/5] API (:3000)" -ForegroundColor Yellow
Ensure-ServiceWindow -Title "SISMICA API" -WorkDir $root -Command "npm run dev:api" -Port 3000 -Description "API"

Write-Host "  Esperando a la API (:3000)..." -ForegroundColor DarkYellow
for ($i = 0; $i -lt 30; $i++) {
  if (Test-Port -Port 3000) { break }
  Start-Sleep -Seconds 1
}

Write-Host "[3/5] Worker (ingesta de sismos)" -ForegroundColor Yellow
Ensure-ServiceWindow -Title "SISMICA WORKER" -WorkDir $root -Command "npm run dev:worker" -CommandMatch "apps/worker|run dev:worker" -Description "Worker"

Write-Host "[4/5] Motor neural Chatterbox (XTTS-v2 deshabilitado)" -ForegroundColor Yellow
Stop-ServiceProcesses -Description "XTTS-v2" -CommandPatterns @("services\\tts-xtts\\app\.py") -Ports @(8090)
if (Test-Path (Join-Path $chatterboxDir ".venv\Scripts\python.exe")) {
  $chatterboxCommand = "`$env:CHATTERBOX_DEVICE='cuda'; `$env:CHATTERBOX_PRECISION='bf16'; `$env:CHATTERBOX_CACHE_CONDITIONING='true'; `$env:CHATTERBOX_CONDITIONING_CACHE_LIMIT='6'; `$env:CHATTERBOX_PROFILE_WARMUP='all'; `$env:CHATTERBOX_COMPILE_MODE='off'; `$env:CHATTERBOX_EAGER_LOAD='false'; & '.\.venv\Scripts\python.exe' app.py"
  Ensure-ServiceWindow -Title "SISMICA CHATTERBOX" -WorkDir $chatterboxDir -Command $chatterboxCommand -Port 8091 -Description "Chatterbox"
} else {
  Write-Host "  (omitido: falta services\tts-chatterbox\.venv)" -ForegroundColor DarkYellow
}

Write-Host "  Esperando Chatterbox..." -ForegroundColor DarkYellow
for ($i = 0; $i -lt 30; $i++) {
  if (Test-Port -Port 8091) { break }
  Start-Sleep -Seconds 1
}

$runtimeVoiceEngine = if ($selectedVoiceEngine -eq "none") { "browser" } else { $selectedVoiceEngine }
try {
  $activationBody = @{ engine = $runtimeVoiceEngine } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "http://127.0.0.1:3000/api/tts/engine" -Method Post `
    -ContentType "application/json" -Body $activationBody -TimeoutSec 300 | Out-Null
  Write-Host ("  -> {0} listo; el otro modelo queda descargado" -f $selectedVoiceLabel) -ForegroundColor Green
} catch {
  Write-Host ("  -> no se pudo precargar {0}: {1}" -f $selectedVoiceLabel, $_.Exception.Message) -ForegroundColor DarkYellow
}

Write-Host "[5/5] Web (:5173)" -ForegroundColor Yellow
Ensure-ServiceWindow -Title "SISMICA WEB" -WorkDir $root -Command "npm run dev:web" -Port 5173 -Description "Web"

# Espera a que la web responda y abre el navegador.
Write-Host "`nEsperando a la web (:5173)..." -ForegroundColor Yellow
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Port -Port 5173) { break }
  Start-Sleep -Seconds 1
}
Start-Process "http://localhost:5173/"

Write-Host "`nListo. Cada servicio corre en su propia ventana." -ForegroundColor Cyan
Write-Host "Motor neural activo: $selectedVoiceLabel" -ForegroundColor Cyan
Write-Host "La primera carga en frio puede tardar varios minutos; los cambios posteriores son mas rapidos." -ForegroundColor Cyan
Write-Host "Para detener todo: cierra esas ventanas (o Ctrl+C en cada una)." -ForegroundColor Cyan

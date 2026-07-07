#Requires -Version 5
<#
  Watchdog de la plataforma sismica (mejora P1.1/P1.2 de docs/architecture-review.md).

  Complementa a start-all.ps1: NO reemplaza el arranque, solo VIGILA y REINICIA lo que caiga.
  Resuelve el hueco real: si un servicio muere (p. ej. el worker cuando la DB no estaba, o una
  ventana que crashea), aqui se detecta por health real (HTTP) y se relanza con su mismo comando.

  Uso:
    # Solo estado (lectura, no reinicia nada) — seguro para probar:
    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1 -Status

    # Vigilancia continua (reinicia lo que caiga). Ctrl+C para salir:
    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1

    # Con limpieza previa de puertos zombie (5173-5176):
    powershell -ExecutionPolicy Bypass -File scripts\watchdog.ps1 -CleanPorts

  Conservador por diseno: solo reinicia tras -FailThreshold chequeos fallidos seguidos (evita
  flapping durante cargas lentas de modelo). La DB embebida se re-arranca con `npm run db:start`
  (idempotente); nunca se mata Postgres a la fuerza.
#>

param(
  [switch]$Status,
  [switch]$CleanPorts,
  [int]$IntervalSeconds = 15,
  [int]$FailThreshold = 2
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$chatterboxDir = Join-Path $root "services\tts-chatterbox"

# --- Registro de servicios (orden = dependencias). ------------------------------------------
# Cada servicio: Name, Kind(http|tcp|process), Target (url|puerto|patron), Port (para limpiar),
# Start (scriptblock que lo relanza), Critical (si su caida bloquea a los siguientes).
$services = @(
  @{
    Name = "DB (Postgres)"; Kind = "tcp"; Target = 5433; Port = $null; Critical = $true
    Start = { npm run db:start | Out-Null }
  },
  @{
    Name = "API"; Kind = "http"; Target = "http://127.0.0.1:3000/api/health"; Port = 3000; Critical = $true
    Start = { Start-ServiceWindow -Title "SISMICA API" -WorkDir $root -Command "npm run dev:api" }
  },
  @{
    Name = "Worker"; Kind = "process"; Target = "run dev:worker|apps[\\/]worker"; Port = $null; Critical = $false
    Start = { Start-ServiceWindow -Title "SISMICA WORKER" -WorkDir $root -Command "npm run dev:worker" }
  },
  @{
    Name = "Chatterbox"; Kind = "http"; Target = "http://127.0.0.1:8091/health"; Port = 8091; Critical = $false
    Start = {
      if (Test-Path (Join-Path $chatterboxDir ".venv\Scripts\python.exe")) {
        Start-ServiceWindow -Title "SISMICA CHATTERBOX" -WorkDir $chatterboxDir `
          -Command "`$env:CHATTERBOX_DEVICE='cuda'; `$env:CHATTERBOX_PRECISION='bf16'; `$env:CHATTERBOX_CACHE_CONDITIONING='true'; `$env:CHATTERBOX_CONDITIONING_CACHE_LIMIT='6'; `$env:CHATTERBOX_PROFILE_WARMUP='all'; `$env:CHATTERBOX_COMPILE_MODE='off'; `$env:CHATTERBOX_EAGER_LOAD='true'; & '.\.venv\Scripts\python.exe' app.py"
      }
    }
  },
  @{
    Name = "Web"; Kind = "http"; Target = "http://localhost:5173/"; Port = 5173; Critical = $false
    Start = { Start-ServiceWindow -Title "SISMICA WEB" -WorkDir $root -Command "npm run dev:web" }
  }
)

# --- Utilidades. ----------------------------------------------------------------------------

function Start-ServiceWindow {
  param([string]$Title, [string]$WorkDir, [string]$Command)
  $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $inner
  ) | Out-Null
}

function Test-HttpHealth {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
    return $r.StatusCode -ge 200 -and $r.StatusCode -lt 500
  } catch { return $false }
}

function Test-TcpHealth {
  param([int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $client.Connect("127.0.0.1", $Port)
    $client.Close()
    return $true
  } catch { return $false }
}

function Test-ProcessHealth {
  param([string]$Pattern)
  $procs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "node|python" -and $_.CommandLine -match $Pattern }
  return @($procs).Count -gt 0
}

function Test-ServiceHealth {
  param($Service)
  switch ($Service.Kind) {
    "http" { return Test-HttpHealth -Url $Service.Target }
    "tcp" { return Test-TcpHealth -Port $Service.Target }
    "process" { return Test-ProcessHealth -Pattern $Service.Target }
  }
  return $false
}

function Clear-Port {
  param([int]$Port)
  $conns = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  foreach ($cn in $conns) {
    try { Stop-Process -Id $cn.OwningProcess -Force -ErrorAction Stop } catch {}
  }
}

function Write-Stamp {
  param([string]$Message, [string]$Color = "Gray")
  Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message) -ForegroundColor $Color
}

# --- Modo estado (lectura, no reinicia). ----------------------------------------------------

if ($Status) {
  Write-Host "== Estado de servicios ==" -ForegroundColor Cyan
  foreach ($svc in $services) {
    $ok = Test-ServiceHealth -Service $svc
    $mark = if ($ok) { "OK  " } else { "DOWN" }
    $color = if ($ok) { "Green" } else { "Red" }
    Write-Host ("  [{0}] {1}" -f $mark, $svc.Name) -ForegroundColor $color
  }
  return
}

# --- Limpieza opcional de puertos zombie. ---------------------------------------------------

if ($CleanPorts) {
  Write-Stamp "Limpiando puertos zombie (5173-5176)..." "DarkYellow"
  foreach ($p in 5173, 5174, 5175, 5176) { Clear-Port -Port $p }
  Start-Sleep -Seconds 1
}

# --- Bucle de vigilancia. -------------------------------------------------------------------

Write-Host "== Watchdog activo (intervalo ${IntervalSeconds}s, umbral ${FailThreshold} fallos) ==" -ForegroundColor Cyan
Write-Host "Ctrl+C para detener. Solo reinicia lo que caiga." -ForegroundColor DarkCyan

$fails = @{}
foreach ($svc in $services) { $fails[$svc.Name] = 0 }

while ($true) {
  foreach ($svc in $services) {
    $ok = Test-ServiceHealth -Service $svc
    if ($ok) {
      if ($fails[$svc.Name] -gt 0) { Write-Stamp ("{0}: recuperado" -f $svc.Name) "Green" }
      $fails[$svc.Name] = 0
      continue
    }

    $fails[$svc.Name]++
    Write-Stamp ("{0}: sin salud ({1}/{2})" -f $svc.Name, $fails[$svc.Name], $FailThreshold) "DarkYellow"

    if ($fails[$svc.Name] -ge $FailThreshold) {
      Write-Stamp ("{0}: REINICIANDO" -f $svc.Name) "Yellow"
      try {
        if ($svc.Port) { Clear-Port -Port $svc.Port }
        & $svc.Start
        $fails[$svc.Name] = 0
      } catch {
        Write-Stamp ("{0}: fallo al reiniciar: {1}" -f $svc.Name, $_.Exception.Message) "Red"
      }
    }

    # Orden de dependencias: si un servicio critico (DB, API) no esta sano, no evalues ni reinicies
    # a los que dependen de el en este ciclo; dales tiempo a levantar antes.
    if ($svc.Critical) { break }
  }
  Start-Sleep -Seconds $IntervalSeconds
}

#Requires -Version 5
<#
  Lanzador de la plataforma sismica.
  Levanta todo en orden: shared -> Postgres -> API -> Worker -> XTTS-v2 -> Web,
  cada servicio en su propia ventana. Al final abre el navegador.

  Uso:  boton derecho > "Ejecutar con PowerShell", o via el acceso directo.
        (o)  powershell -ExecutionPolicy Bypass -File scripts\start-all.ps1
#>

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

function Start-ServiceWindow {
  param([string]$Title, [string]$WorkDir, [string]$Command)
  $inner = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$WorkDir'; $Command"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoExit", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $inner
  ) | Out-Null
  Write-Host ("  -> ventana '{0}' abierta" -f $Title) -ForegroundColor Green
}

# 0) Paquete compartido (los dev servers importan @sismica/shared desde dist/).
Write-Host "[0/5] Construyendo @sismica/shared..." -ForegroundColor Yellow
npm run build -w packages/shared

# 1) PostgreSQL (el script espera a que acepte conexiones y retorna).
Write-Host "`n[1/5] Iniciando PostgreSQL..." -ForegroundColor Yellow
npm run db:start

$xttsDir = Join-Path $root "services\tts-xtts"

# 2..5) Servicios de larga duracion, cada uno en su ventana.
Write-Host "`n[2/5] API (:3000)" -ForegroundColor Yellow
Start-ServiceWindow -Title "SISMICA API" -WorkDir $root -Command "npm run dev:api"

Write-Host "[3/5] Worker (ingesta de sismos)" -ForegroundColor Yellow
Start-ServiceWindow -Title "SISMICA WORKER" -WorkDir $root -Command "npm run dev:worker"

Write-Host "[4/5] XTTS-v2 (:8090)" -ForegroundColor Yellow
if (Test-Path (Join-Path $xttsDir ".venv\Scripts\python.exe")) {
  Start-ServiceWindow -Title "SISMICA XTTS" -WorkDir $xttsDir -Command "& '.\.venv\Scripts\python.exe' app.py"
} else {
  Write-Host "  (omitido: falta services\tts-xtts\.venv; la voz caera a Piper/navegador)" -ForegroundColor DarkYellow
}

Write-Host "[5/5] Web (:5173)" -ForegroundColor Yellow
Start-ServiceWindow -Title "SISMICA WEB" -WorkDir $root -Command "npm run dev:web"

# Espera a que la web responda y abre el navegador.
Write-Host "`nEsperando a la web (:5173)..." -ForegroundColor Yellow
for ($i = 0; $i -lt 60; $i++) {
  if (Test-Port -Port 5173) { break }
  Start-Sleep -Seconds 1
}
Start-Process "http://localhost:5173"

Write-Host "`nListo. Cada servicio corre en su propia ventana." -ForegroundColor Cyan
Write-Host "XTTS tarda ~30-60 s en cargar el modelo la primera vez." -ForegroundColor Cyan
Write-Host "Para detener todo: cierra esas ventanas (o Ctrl+C en cada una)." -ForegroundColor Cyan

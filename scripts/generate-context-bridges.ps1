#Requires -Version 5
param(
  [string]$CatalogPath = "E:\Proyecto\Grabaciones\catalogo_contextos_sismicos.json",
  [string]$OutputRoot = "E:\Proyecto\Grabaciones\contexto-pregabado",
  [string]$ServiceDir = "E:\Proyecto\services\tts-chatterbox",
  [string]$ServiceUrl = "http://127.0.0.1:8091",
  [ValidateSet("cuda", "cpu")]
  [string]$Device = "cuda",
  [ValidateSet("current", "expansion", "all")]
  [string]$Status = "current",
  [string[]]$Voices,
  [int]$TimeoutSec = 300,
  [switch]$Force,
  [switch]$KeepService
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Test-Health {
  param([string]$Url)
  try {
    $payload = Invoke-RestMethod -Uri "$Url/health" -TimeoutSec 5
    return [pscustomobject]@{
      Ok = $true
      Payload = $payload
    }
  } catch {
    return [pscustomobject]@{
      Ok = $false
      Payload = $null
    }
  }
}

function Wait-Health {
  param([string]$Url, [int]$MaxSeconds = 120)
  $deadline = (Get-Date).AddSeconds($MaxSeconds)
  while ((Get-Date) -lt $deadline) {
    $health = Test-Health -Url $Url
    if ($health.Ok) {
      return $health.Payload
    }
    Start-Sleep -Seconds 2
  }
  throw "Chatterbox no respondio en $MaxSeconds s: $Url/health"
}

function Start-ChatterboxService {
  param([string]$Dir, [string]$DeviceMode)
  $python = Join-Path $Dir ".venv\Scripts\python.exe"
  if (-not (Test-Path $python)) {
    throw "No existe el entorno de Chatterbox: $python"
  }

  $logDir = "E:\Proyecto\.runtime-logs"
  if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir | Out-Null
  }
  $stdout = Join-Path $logDir "chatterbox-batch-$DeviceMode.out.log"
  $stderr = Join-Path $logDir "chatterbox-batch-$DeviceMode.err.log"

  $env:CHATTERBOX_DEVICE = $DeviceMode
  $env:CHATTERBOX_EAGER_LOAD = "true"
  $env:CHATTERBOX_PROFILE_WARMUP = "all"
  $env:CHATTERBOX_COMPILE_MODE = "off"

  return Start-Process -FilePath $python `
    -ArgumentList "app.py" `
    -WorkingDirectory $Dir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
}

function Ensure-Loaded {
  param([string]$Url, [int]$Timeout)
  try {
    Invoke-RestMethod -Uri "$Url/load" -Method Post -TimeoutSec $Timeout | Out-Null
  } catch {
    throw "No se pudo cargar Chatterbox: $($_.Exception.Message)"
  }
}

function Save-Manifest {
  param(
    [string]$Path,
    [object]$Payload
  )
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

$catalog = Get-Content -Raw $CatalogPath | ConvertFrom-Json
if (-not $Voices -or $Voices.Count -eq 0) {
  $Voices = @($catalog.phase1Voices)
}

$groups = @($catalog.groups)
switch ($Status) {
  "current" { $groups = @($groups | Where-Object { $_.status -eq "current" }) }
  "expansion" { $groups = @($groups | Where-Object { $_.status -eq "expansion" }) }
  default { $groups = @($groups) }
}

if ($groups.Count -eq 0) {
  throw "No hay grupos para el filtro Status=$Status"
}

$serviceStartedHere = $false
$serviceProcess = $null
$health = Test-Health -Url $ServiceUrl
if (-not $health.Ok) {
  $serviceProcess = Start-ChatterboxService -Dir $ServiceDir -DeviceMode $Device
  $serviceStartedHere = $true
  Wait-Health -Url $ServiceUrl -MaxSeconds 180 | Out-Null
}

$healthPayload = Wait-Health -Url $ServiceUrl -MaxSeconds 30
Ensure-Loaded -Url $ServiceUrl -Timeout $TimeoutSec
$healthPayload = Wait-Health -Url $ServiceUrl -MaxSeconds 30

$availableProfiles = @($healthPayload.profiles)
foreach ($voice in $Voices) {
  if ($availableProfiles -notcontains $voice) {
    throw "La voz '$voice' no esta disponible en Chatterbox. Perfiles: $($availableProfiles -join ', ')"
  }
}

if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

$runStartedUtc = [DateTime]::UtcNow
$items = New-Object System.Collections.Generic.List[object]

foreach ($voice in $Voices) {
  $voiceDir = Join-Path $OutputRoot $voice
  if (-not (Test-Path $voiceDir)) {
    New-Item -ItemType Directory -Path $voiceDir | Out-Null
  }

  foreach ($group in $groups) {
    $phrases = @($group.phrases)
    for ($i = 0; $i -lt $phrases.Count; $i++) {
      $variant = "{0:d2}" -f ($i + 1)
      $fileName = "bridge_{0}_{1}_{2}.wav" -f $voice, $group.id, $variant
      $targetPath = Join-Path $voiceDir $fileName
      $text = [string]$phrases[$i]

      if ((-not $Force) -and (Test-Path $targetPath)) {
        $file = Get-Item $targetPath
        $items.Add([pscustomobject]@{
            voice = $voice
            groupId = $group.id
            variant = $variant
            text = $text
            outputPath = $targetPath
            bytes = $file.Length
            skipped = $true
            generatedAtUtc = $file.LastWriteTimeUtc.ToString("o")
          })
        continue
      }

      $body = @{
        text = $text
        speaker = $voice
      } | ConvertTo-Json -Compress

      $startedAt = Get-Date
      Invoke-WebRequest -Uri "$ServiceUrl/synthesize" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec $TimeoutSec `
        -OutFile $targetPath
      $elapsedMs = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 1)
      $file = Get-Item $targetPath

      $items.Add([pscustomobject]@{
          voice = $voice
          groupId = $group.id
          variant = $variant
          text = $text
          outputPath = $targetPath
          bytes = $file.Length
          elapsedMs = $elapsedMs
          skipped = $false
          generatedAtUtc = [DateTime]::UtcNow.ToString("o")
        })
    }
  }
}

$manifest = [pscustomobject]@{
  version = [string]$catalog.version
  generatedAtUtc = [DateTime]::UtcNow.ToString("o")
  runStartedUtc = $runStartedUtc.ToString("o")
  statusFilter = $Status
  requestedVoices = $Voices
  service = [pscustomobject]@{
    url = $ServiceUrl
    device = [string]$healthPayload.device
    precision = [string]$healthPayload.precision
    compileMode = [string]$healthPayload.compileMode
    startedHere = $serviceStartedHere
  }
  groups = @($groups | ForEach-Object {
      [pscustomobject]@{
        id = $_.id
        status = $_.status
        variants = @($_.phrases).Count
      }
    })
  items = $items
}

$manifestPath = Join-Path $OutputRoot "manifest-$Status.json"
Save-Manifest -Path $manifestPath -Payload $manifest

if ($serviceStartedHere -and -not $KeepService -and $serviceProcess) {
  try {
    Stop-Process -Id $serviceProcess.Id -Force -ErrorAction Stop
  } catch {
    Write-Warning "No se pudo detener el proceso de Chatterbox lanzado para el batch"
  }
}

Write-Host ("Grabacion completada. Manifest: {0}" -f $manifestPath) -ForegroundColor Green

#Requires -Version 5
param(
  [string]$CatalogPath = "E:\Proyecto\Grabaciones\catalogo_pautas_educativas.json",
  [string]$OutputRoot = "E:\Proyecto\Grabaciones\pautas-educativas",
  [string]$ServiceUrl = "http://127.0.0.1:8091",
  [string[]]$Voices = @(),
  [int]$TimeoutSec = 300,
  [switch]$Force,
  [ValidateSet("pending", "approved")]
  [string]$ApprovalStatus = "pending",
  [double]$TrimThresholdDb = -34,
  [double]$TrimMinSilenceSec = 0.15,
  [double]$TrimKeepTailSec = 0.04
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "tts-audio-utils.ps1")

function Save-Manifest {
  param([string]$Path, [object]$Payload)
  $Payload | ConvertTo-Json -Depth 8 | Set-Content -Path $Path -Encoding UTF8
}

$catalog = Get-Content -Raw $CatalogPath | ConvertFrom-Json
$items = @($catalog.items)
if ($items.Count -lt 1) { throw "El catalogo no tiene items" }

# Voces: parametro > catalogo. Tolerar "a,b" en un solo elemento (invocacion -File).
$Voices = @($Voices | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if ($Voices.Count -eq 0) { $Voices = @($catalog.voices) }
if ($Voices.Count -eq 0) { throw "No hay voces definidas" }

$health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 10
if (-not $health.loaded) {
  Invoke-RestMethod -Uri "$ServiceUrl/load" -Method Post -TimeoutSec $TimeoutSec | Out-Null
  $health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 10
}
$availableProfiles = @($health.profiles)
foreach ($voice in $Voices) {
  if ($availableProfiles -notcontains $voice) {
    throw "La voz '$voice' no esta disponible. Perfiles: $($availableProfiles -join ', ')"
  }
}

if (-not (Test-Path $OutputRoot)) { New-Item -ItemType Directory -Path $OutputRoot | Out-Null }
$manifestPath = Join-Path $OutputRoot "manifest-current.json"

# Cargar manifiesto previo para acumular (permite generar por voces en tandas)
$manifestItems = New-Object System.Collections.Generic.List[object]
if ((Test-Path $manifestPath) -and (-not $Force)) {
  try {
    $prev = Get-Content -Raw $manifestPath | ConvertFrom-Json
    foreach ($it in @($prev.items)) { $manifestItems.Add($it) }
  } catch {}
}

function Write-CurrentManifest {
  param([System.Collections.Generic.List[object]]$AllItems)
  $voicesSeen = @($AllItems | ForEach-Object { [string]$_.voice } | Sort-Object -Unique)
  $manifest = [pscustomobject]@{
    version        = [string]$catalog.version
    catalogVersion = [string]$catalog.version
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    voices         = $voicesSeen
    service        = [pscustomobject]@{ url = $ServiceUrl; device = [string]$health.device; precision = [string]$health.precision }
    groups         = @([pscustomobject]@{ id = "station_identity"; kind = "station_identity"; status = "current"; variants = $AllItems.Count })
    items          = $AllItems
  }
  Save-Manifest -Path $manifestPath -Payload $manifest
}

$total = $Voices.Count * $items.Count
$done = 0
foreach ($voice in $Voices) {
  $voiceDir = Join-Path $OutputRoot $voice
  if (-not (Test-Path $voiceDir)) { New-Item -ItemType Directory -Path $voiceDir | Out-Null }

  foreach ($item in $items) {
    $done++
    $variant = "{0:d2}" -f [int]$item.id
    $fileName = "educativa_{0}_{1}.wav" -f $voice, $variant
    $targetPath = Join-Path $voiceDir $fileName
    $text = ([string]$item.text).Trim()

    # Quitar entradas previas de este mismo (voice,variant) para no duplicar
    $toRemove = @($manifestItems | Where-Object { $_.voice -eq $voice -and $_.variant -eq $variant })
    foreach ($r in $toRemove) { [void]$manifestItems.Remove($r) }

    if ((-not $Force) -and (Test-Path $targetPath)) {
      Write-Host ("[{0}/{1}] skip {2}" -f $done, $total, $fileName) -ForegroundColor DarkGray
    } else {
      $startedAt = Get-Date
      $rawPath = New-TempWavPath
      $body = @{ text = $text; speaker = $voice } | ConvertTo-Json -Compress
      try {
        Invoke-WebRequest -Uri "$ServiceUrl/synthesize" -Method Post -ContentType "application/json" -Body $body -TimeoutSec $TimeoutSec -OutFile $rawPath | Out-Null
        Invoke-TrimTrailingTail -InputPath $rawPath -OutputPath $targetPath -ThresholdDb $TrimThresholdDb -MinSilenceSec $TrimMinSilenceSec -KeepTailSec $TrimKeepTailSec
      } finally {
        if (Test-Path -LiteralPath $rawPath) { Remove-Item -LiteralPath $rawPath -Force }
      }
      $ms = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 0)
      Write-Host ("[{0}/{1}] {2}  ({3} ms)" -f $done, $total, $fileName, $ms) -ForegroundColor Green
    }

    $file = Get-Item $targetPath
    $durationMs = [math]::Round((Get-AudioDurationSeconds -Path $targetPath) * 1000, 0)
    $manifestItems.Add([pscustomobject]@{
        voice        = $voice
        groupId      = "station_identity"
        variant      = $variant
        text         = $text
        keywords     = @($item.keywords)
        source       = [string]$item.source
        outputPath   = $targetPath
        bytes        = $file.Length
        durationMs   = $durationMs
        approvalStatus = $ApprovalStatus
        generatedAtUtc = $file.LastWriteTimeUtc.ToString("o")
      })
  }
  # Manifiesto tras cada voz => usable en tandas
  Write-CurrentManifest -AllItems $manifestItems
  Write-Host ("== Voz '{0}' completada. Manifiesto actualizado ({1} items) ==" -f $voice, $manifestItems.Count) -ForegroundColor Cyan
}

Write-Host ("Educativas completadas: {0} audios en {1} voces. Manifest: {2}" -f $manifestItems.Count, $Voices.Count, $manifestPath) -ForegroundColor Green

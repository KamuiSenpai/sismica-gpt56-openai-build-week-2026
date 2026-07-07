#Requires -Version 5
param(
  [string]$CatalogPath = "E:\Proyecto\Grabaciones\catalogo_pautas_informativas.json",
  [string]$OutputRoot = "E:\Proyecto\Grabaciones\pautas-informativas",
  [string]$ServiceUrl = "http://127.0.0.1:8091",
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
if ($items.Count -lt 1) {
  throw "El catalogo debe contener al menos una pauta activa"
}

$requiredVoices = @(
  "mx_carolina",
  "mx_liam",
  "mx_valentina",
  "mx_martin",
  "mx_sofia",
  "mx_ninoska"
)
$catalogVoices = @($items | ForEach-Object { [string]$_.voice } | Sort-Object -Unique)
foreach ($requiredVoice in $requiredVoices) {
  if ($catalogVoices -notcontains $requiredVoice) {
    throw "El catalogo no incluye la voz obligatoria '$requiredVoice'"
  }
}

$health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 10
if (-not $health.loaded) {
  Invoke-RestMethod -Uri "$ServiceUrl/load" -Method Post -TimeoutSec $TimeoutSec | Out-Null
  $health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 10
}

$availableProfiles = @($health.profiles)
$voices = $catalogVoices
foreach ($voice in $voices) {
  if ($availableProfiles -notcontains $voice) {
    throw "La voz '$voice' no esta disponible. Perfiles: $($availableProfiles -join ', ')"
  }
}

if (-not (Test-Path $OutputRoot)) {
  New-Item -ItemType Directory -Path $OutputRoot | Out-Null
}

$manifestItems = New-Object System.Collections.Generic.List[object]
$runStartedUtc = [DateTime]::UtcNow
$partsRoot = Join-Path $OutputRoot ".parts"
if (-not (Test-Path $partsRoot)) {
  New-Item -ItemType Directory -Path $partsRoot | Out-Null
}

foreach ($item in $items) {
  $paragraphs = @($item.paragraphs)
  if ($paragraphs.Count -ne 3) {
    throw "La pauta $($item.id) debe contener exactamente tres parrafos"
  }

  $voice = [string]$item.voice
  $voiceDir = Join-Path $OutputRoot $voice
  if (-not (Test-Path $voiceDir)) {
    New-Item -ItemType Directory -Path $voiceDir | Out-Null
  }

  $variant = "{0:d2}" -f [int]$item.id
  $fileName = "pauta_{0}_{1}.wav" -f $voice, $variant
  $targetPath = Join-Path $voiceDir $fileName
  $text = ($paragraphs | ForEach-Object { ([string]$_).Trim() }) -join "`n`n"

  $elapsedMs = $null
  $skipped = $false
  $trimmedTailSec = $null
  $trailingAuditSec = $null
  if ((-not $Force) -and (Test-Path $targetPath)) {
    $skipped = $true
  } else {
    $startedAt = Get-Date
    $partPaths = New-Object System.Collections.Generic.List[string]
    $totalTrimmedTailSec = 0.0
    for ($paragraphIndex = 0; $paragraphIndex -lt $paragraphs.Count; $paragraphIndex++) {
      $partPath = Join-Path $partsRoot ("{0}_{1}_p{2}.wav" -f $voice, $variant, ($paragraphIndex + 1))
      $partRawPath = New-TempWavPath
      $body = @{
        text = ([string]$paragraphs[$paragraphIndex]).Trim()
        speaker = $voice
      } | ConvertTo-Json -Compress

      try {
        Invoke-WebRequest -Uri "$ServiceUrl/synthesize" `
          -Method Post `
          -ContentType "application/json" `
          -Body $body `
          -TimeoutSec $TimeoutSec `
          -OutFile $partRawPath
        $rawPartDurationSec = Get-AudioDurationSeconds -Path $partRawPath
        Invoke-TrimTrailingTail `
          -InputPath $partRawPath `
          -OutputPath $partPath `
          -ThresholdDb $TrimThresholdDb `
          -MinSilenceSec $TrimMinSilenceSec `
          -KeepTailSec $TrimKeepTailSec
        $cleanPartDurationSec = Get-AudioDurationSeconds -Path $partPath
        $totalTrimmedTailSec += [math]::Max(0, ($rawPartDurationSec - $cleanPartDurationSec))
      } finally {
        if (Test-Path -LiteralPath $partRawPath) {
          Remove-Item -LiteralPath $partRawPath -Force
        }
      }
      $partPaths.Add($partPath)
    }

    $targetRawPath = New-TempWavPath
    $ffmpegArgs = @("-y", "-loglevel", "error")
    foreach ($partPath in $partPaths) {
      $ffmpegArgs += @("-i", $partPath)
    }
    $ffmpegArgs += @(
      "-filter_complex",
      "[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]",
      "-map",
      "[out]",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "24000",
      "-ac",
      "1",
      $targetRawPath
    )
    & ffmpeg @ffmpegArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $targetRawPath)) {
      throw "FFmpeg no pudo consolidar la pauta $($item.id)"
    }
    $rawGuideDurationSec = Get-AudioDurationSeconds -Path $targetRawPath
    Invoke-TrimTrailingTail `
      -InputPath $targetRawPath `
      -OutputPath $targetPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec
    $cleanGuideDurationSec = Get-AudioDurationSeconds -Path $targetPath
    $trimmedTailSec = [math]::Round(
      $totalTrimmedTailSec + [math]::Max(0, ($rawGuideDurationSec - $cleanGuideDurationSec)),
      2
    )
    $trailingAuditSec = (Get-AudioTrimAudit `
      -Path $targetPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec).trailingSec
    foreach ($partPath in $partPaths) {
      Remove-Item -LiteralPath $partPath -Force
    }
    if (Test-Path -LiteralPath $targetRawPath) {
      Remove-Item -LiteralPath $targetRawPath -Force
    }
    $elapsedMs = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 1)
  }

  $file = Get-Item $targetPath
  $durationMs = [math]::Round((Get-AudioDurationSeconds -Path $targetPath) * 1000, 0)
  $manifestItems.Add([pscustomobject]@{
      voice = $voice
      groupId = "station_identity"
      variant = $variant
      text = $text
      paragraphs = $paragraphs
      keywords = @($item.keywords | Where-Object { $_ -is [string] -and $_.Trim().Length -gt 0 } | ForEach-Object { ([string]$_).Trim() })
      outputPath = $targetPath
      bytes = $file.Length
      durationMs = $durationMs
      approvalStatus = $ApprovalStatus
      elapsedMs = $elapsedMs
      trimmedTailSec = $trimmedTailSec
      trailingAuditSec = $trailingAuditSec
      skipped = $skipped
      generatedAtUtc = $file.LastWriteTimeUtc.ToString("o")
    })
}

$manifest = [pscustomobject]@{
  version = [string]$catalog.version
  catalogVersion = [string]$catalog.version
  generatedAtUtc = [DateTime]::UtcNow.ToString("o")
  runStartedUtc = $runStartedUtc.ToString("o")
  voices = $voices
  service = [pscustomobject]@{
    url = $ServiceUrl
    device = [string]$health.device
    precision = [string]$health.precision
    compileMode = [string]$health.compileMode
  }
  groups = @(
    [pscustomobject]@{
      id = "station_identity"
      kind = "station_identity"
      status = "current"
      variants = $manifestItems.Count
    }
  )
  items = $manifestItems
}

$manifestPath = Join-Path $OutputRoot "manifest-current.json"
Save-Manifest -Path $manifestPath -Payload $manifest
Write-Host ("Pautas completadas: {0} audios. Manifest: {1}" -f $manifestItems.Count, $manifestPath) -ForegroundColor Green

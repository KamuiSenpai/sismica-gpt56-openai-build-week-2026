#Requires -Version 5
param(
  [string]$ServiceUrl = "http://127.0.0.1:8091",
  [int]$TimeoutSec = 300,
  [int]$MaxAttempts = 3,
  [double]$AcceptedTrailingSec = 0.08,
  [double]$TrimThresholdDb = -34,
  [double]$TrimMinSilenceSec = 0.15,
  [double]$TrimKeepTailSec = 0.04
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot "tts-audio-utils.ps1")

$repoRoot = Split-Path -Parent $PSScriptRoot
$libraryRoots = @{
  short = Join-Path $repoRoot "Grabaciones\contexto-pregabado"
  extended = Join-Path $repoRoot "Grabaciones\contexto-extendido"
  station = Join-Path $repoRoot "Grabaciones\pautas-informativas"
}
$backupRoot = Join-Path $repoRoot ("Grabaciones\_repair-backups\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$reportPath = Join-Path $repoRoot "Grabaciones\audit-remediation-targeted.json"

function Save-JsonFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][object]$Payload
  )

  $Payload | ConvertTo-Json -Depth 10 | Set-Content -Path $Path -Encoding UTF8
}

function Get-ManifestObject {
  param([Parameter(Mandatory = $true)][string]$Library)
  $manifestPath = Join-Path $libraryRoots[$Library] "manifest-current.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw ("Manifest no encontrado para la biblioteca {0}: {1}" -f $Library, $manifestPath)
  }
  return @{
    Path = $manifestPath
    Json = Get-Content -Raw $manifestPath | ConvertFrom-Json
  }
}

function Get-ManifestItemByFile {
  param(
    [Parameter(Mandatory = $true)][object]$ManifestJson,
    [Parameter(Mandatory = $true)][string]$Voice,
    [Parameter(Mandatory = $true)][string]$FileName
  )

  return @($ManifestJson.items | Where-Object {
      $_.voice -eq $Voice -and (Split-Path -Leaf ([string]$_.outputPath)) -eq $FileName
    })[0]
}

function Backup-OriginalFile {
  param(
    [Parameter(Mandatory = $true)][string]$Library,
    [Parameter(Mandatory = $true)][string]$SourcePath
  )

  $relative = $SourcePath.Substring($libraryRoots[$Library].Length).TrimStart("\")
  $backupPath = Join-Path $backupRoot (Join-Path $Library $relative)
  $backupDir = Split-Path -Parent $backupPath
  if (-not (Test-Path -LiteralPath $backupDir)) {
    New-Item -ItemType Directory -Path $backupDir | Out-Null
  }
  Copy-Item -LiteralPath $SourcePath -Destination $backupPath -Force
  return $backupPath
}

function Update-ManifestEntry {
  param(
    [Parameter(Mandatory = $true)][string]$ManifestPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [Parameter(Mandatory = $true)][double]$ElapsedMs,
    [Parameter(Mandatory = $true)][double]$TrimmedTailSec,
    [Parameter(Mandatory = $true)][double]$TrailingAuditSec
  )

  $manifest = Get-Content -Raw $ManifestPath | ConvertFrom-Json
  $item = @($manifest.items | Where-Object { ([string]$_.outputPath) -eq $OutputPath })[0]
  if (-not $item) {
    throw "No se encontro la entrada del manifest para $OutputPath"
  }

  $file = Get-Item -LiteralPath $OutputPath
  $item.bytes = $file.Length
  $item.elapsedMs = [math]::Round($ElapsedMs, 1)
  $item.generatedAtUtc = $file.LastWriteTimeUtc.ToString("o")
  if ($item.PSObject.Properties.Name -contains "skipped") {
    $item.skipped = $false
  }
  if ($item.PSObject.Properties.Name -contains "trimmedTailSec") {
    $item.trimmedTailSec = $TrimmedTailSec
  } else {
    $item | Add-Member -NotePropertyName trimmedTailSec -NotePropertyValue $TrimmedTailSec
  }
  if ($item.PSObject.Properties.Name -contains "trailingAuditSec") {
    $item.trailingAuditSec = $TrailingAuditSec
  } else {
    $item | Add-Member -NotePropertyName trailingAuditSec -NotePropertyValue $TrailingAuditSec
  }
  $manifest.generatedAtUtc = [DateTime]::UtcNow.ToString("o")
  Save-JsonFile -Path $ManifestPath -Payload $manifest
}

function Synthesize-BridgeCandidate {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [Parameter(Mandatory = $true)][string]$Voice,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $rawPath = New-TempWavPath
  try {
    $body = @{
      text = $Text
      speaker = $Voice
    } | ConvertTo-Json -Compress
    Invoke-WebRequest -Uri "$ServiceUrl/synthesize" `
      -Method Post `
      -ContentType "application/json" `
      -Body $body `
      -TimeoutSec $TimeoutSec `
      -OutFile $rawPath

    $rawDuration = Get-AudioDurationSeconds -Path $rawPath
    Invoke-TrimTrailingTail `
      -InputPath $rawPath `
      -OutputPath $OutputPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec
    $cleanDuration = Get-AudioDurationSeconds -Path $OutputPath
    $audit = Get-AudioTrimAudit `
      -Path $OutputPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec

    return [pscustomobject]@{
      trimmedTailSec = [math]::Round([math]::Max(0, $rawDuration - $cleanDuration), 2)
      trailingAuditSec = $audit.trailingSec
      durationSec = $audit.durationSec
    }
  } finally {
    if (Test-Path -LiteralPath $rawPath) {
      Remove-Item -LiteralPath $rawPath -Force
    }
  }
}

function Synthesize-StationCandidate {
  param(
    [Parameter(Mandatory = $true)][string[]]$Paragraphs,
    [Parameter(Mandatory = $true)][string]$Voice,
    [Parameter(Mandatory = $true)][string]$OutputPath
  )

  $partRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("tts-parts-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $partRoot | Out-Null
  $partPaths = New-Object System.Collections.Generic.List[string]
  $totalTrimmedTailSec = 0.0
  $rawMergedPath = New-TempWavPath

  try {
    for ($index = 0; $index -lt $Paragraphs.Count; $index++) {
      $rawPartPath = New-TempWavPath
      $cleanPartPath = Join-Path $partRoot ("part-{0:d2}.wav" -f ($index + 1))
      $body = @{
        text = ([string]$Paragraphs[$index]).Trim()
        speaker = $Voice
      } | ConvertTo-Json -Compress

      try {
        Invoke-WebRequest -Uri "$ServiceUrl/synthesize" `
          -Method Post `
          -ContentType "application/json" `
          -Body $body `
          -TimeoutSec $TimeoutSec `
          -OutFile $rawPartPath
        $rawPartDuration = Get-AudioDurationSeconds -Path $rawPartPath
        Invoke-TrimTrailingTail `
          -InputPath $rawPartPath `
          -OutputPath $cleanPartPath `
          -ThresholdDb $TrimThresholdDb `
          -MinSilenceSec $TrimMinSilenceSec `
          -KeepTailSec $TrimKeepTailSec
        $cleanPartDuration = Get-AudioDurationSeconds -Path $cleanPartPath
        $totalTrimmedTailSec += [math]::Max(0, ($rawPartDuration - $cleanPartDuration))
      } finally {
        if (Test-Path -LiteralPath $rawPartPath) {
          Remove-Item -LiteralPath $rawPartPath -Force
        }
      }
      $partPaths.Add($cleanPartPath)
    }

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
      $rawMergedPath
    )
    & ffmpeg @ffmpegArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $rawMergedPath)) {
      throw "No se pudo consolidar la pauta en partes"
    }

    $rawMergedDuration = Get-AudioDurationSeconds -Path $rawMergedPath
    Invoke-TrimTrailingTail `
      -InputPath $rawMergedPath `
      -OutputPath $OutputPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec
    $cleanDuration = Get-AudioDurationSeconds -Path $OutputPath
    $audit = Get-AudioTrimAudit `
      -Path $OutputPath `
      -ThresholdDb $TrimThresholdDb `
      -MinSilenceSec $TrimMinSilenceSec `
      -KeepTailSec $TrimKeepTailSec

    return [pscustomobject]@{
      trimmedTailSec = [math]::Round($totalTrimmedTailSec + [math]::Max(0, ($rawMergedDuration - $cleanDuration)), 2)
      trailingAuditSec = $audit.trailingSec
      durationSec = $audit.durationSec
    }
  } finally {
    if (Test-Path -LiteralPath $rawMergedPath) {
      Remove-Item -LiteralPath $rawMergedPath -Force
    }
    if (Test-Path -LiteralPath $partRoot) {
      Remove-Item -LiteralPath $partRoot -Recurse -Force
    }
  }
}

$health = Invoke-RestMethod -Uri "$ServiceUrl/health" -TimeoutSec 10
if (-not $health.loaded) {
  Invoke-RestMethod -Uri "$ServiceUrl/load" -Method Post -TimeoutSec $TimeoutSec | Out-Null
}

$manifestShort = Get-ManifestObject -Library short
$manifestExtended = Get-ManifestObject -Library extended
$manifestStation = Get-ManifestObject -Library station

$targets = @(
  [pscustomobject]@{ library = "extended"; voice = "mx_carolina"; fileName = "bridge_mx_carolina_foco_intermedio_generico_01.wav"; kind = "bridge"; manifest = $manifestExtended },
  [pscustomobject]@{ library = "short"; voice = "mx_carolina"; fileName = "bridge_mx_carolina_marino_superficial_02.wav"; kind = "bridge"; manifest = $manifestShort },
  [pscustomobject]@{ library = "short"; voice = "mx_liam"; fileName = "bridge_mx_liam_subduccion_pacifico_intermedio_04.wav"; kind = "bridge"; manifest = $manifestShort },
  [pscustomobject]@{ library = "short"; voice = "mx_liam"; fileName = "bridge_mx_liam_continuidad_neutra_04.wav"; kind = "bridge"; manifest = $manifestShort },
  [pscustomobject]@{ library = "station"; voice = "mx_martin"; fileName = "pauta_mx_martin_02.wav"; kind = "station"; manifest = $manifestStation },
  [pscustomobject]@{ library = "station"; voice = "mx_liam"; fileName = "pauta_mx_liam_26.wav"; kind = "station"; manifest = $manifestStation }
)

$results = New-Object System.Collections.Generic.List[object]

foreach ($target in $targets) {
  $manifestItem = Get-ManifestItemByFile -ManifestJson $target.manifest.Json -Voice $target.voice -FileName $target.fileName
  if (-not $manifestItem) {
    throw "No se encontro el clip $($target.fileName) en el manifest de $($target.library)"
  }

  $targetPath = [string]$manifestItem.outputPath
  $beforeAudit = Get-AudioTrimAudit `
    -Path $targetPath `
    -ThresholdDb $TrimThresholdDb `
    -MinSilenceSec $TrimMinSilenceSec `
    -KeepTailSec $TrimKeepTailSec
  $backupPath = Backup-OriginalFile -Library $target.library -SourcePath $targetPath

  $bestCandidatePath = $null
  $bestMetrics = $null
  $elapsedMs = 0.0

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    $candidatePath = New-TempWavPath
    $startedAt = Get-Date
    try {
      $metrics =
        if ($target.kind -eq "bridge") {
          Synthesize-BridgeCandidate -Text ([string]$manifestItem.text) -Voice $target.voice -OutputPath $candidatePath
        } else {
          $paragraphs = @($manifestItem.paragraphs | ForEach-Object { ([string]$_).Trim() })
          Synthesize-StationCandidate -Paragraphs $paragraphs -Voice $target.voice -OutputPath $candidatePath
        }
      $candidateElapsedMs = [math]::Round(((Get-Date) - $startedAt).TotalMilliseconds, 1)

      if (-not $bestMetrics -or $metrics.trailingAuditSec -lt $bestMetrics.trailingAuditSec) {
        if ($bestCandidatePath -and (Test-Path -LiteralPath $bestCandidatePath)) {
          Remove-Item -LiteralPath $bestCandidatePath -Force
        }
        $bestCandidatePath = $candidatePath
        $bestMetrics = [pscustomobject]@{
          attempt = $attempt
          trailingAuditSec = [double]$metrics.trailingAuditSec
          trimmedTailSec = [double]$metrics.trimmedTailSec
          durationSec = [double]$metrics.durationSec
          elapsedMs = $candidateElapsedMs
        }
        $elapsedMs = $candidateElapsedMs
        $candidatePath = $null
      }

      if ($metrics.trailingAuditSec -le $AcceptedTrailingSec) {
        break
      }
    } finally {
      if ($candidatePath -and (Test-Path -LiteralPath $candidatePath)) {
        Remove-Item -LiteralPath $candidatePath -Force
      }
    }
  }

  if (-not $bestCandidatePath -or -not $bestMetrics) {
    throw "No se pudo generar un reemplazo para $($target.fileName)"
  }

  Move-Item -LiteralPath $bestCandidatePath -Destination $targetPath -Force
  $afterAudit = Get-AudioTrimAudit `
    -Path $targetPath `
    -ThresholdDb $TrimThresholdDb `
    -MinSilenceSec $TrimMinSilenceSec `
    -KeepTailSec $TrimKeepTailSec

  Update-ManifestEntry `
    -ManifestPath $target.manifest.Path `
    -OutputPath $targetPath `
    -ElapsedMs $elapsedMs `
    -TrimmedTailSec $bestMetrics.trimmedTailSec `
    -TrailingAuditSec $afterAudit.trailingSec

  $results.Add([pscustomobject]@{
      library = $target.library
      voice = $target.voice
      fileName = $target.fileName
      backupPath = $backupPath
      sourceText = if ($target.kind -eq "bridge") { [string]$manifestItem.text } else { ([string[]]$manifestItem.paragraphs) -join "`n`n" }
      before = $beforeAudit
      after = $afterAudit
      chosenAttempt = $bestMetrics.attempt
      generationElapsedMs = $bestMetrics.elapsedMs
      trimmedTailSec = $bestMetrics.trimmedTailSec
      outputPath = $targetPath
    })
}

$report = [pscustomobject]@{
  generatedAtUtc = [DateTime]::UtcNow.ToString("o")
  serviceUrl = $ServiceUrl
  device = $health.device
  precision = $health.precision
  compileMode = $health.compileMode
  acceptedTrailingSec = $AcceptedTrailingSec
  trim = [pscustomobject]@{
    thresholdDb = $TrimThresholdDb
    minSilenceSec = $TrimMinSilenceSec
    keepTailSec = $TrimKeepTailSec
  }
  items = $results
}

Save-JsonFile -Path $reportPath -Payload $report
Write-Host ("Remediacion completada. Reporte: {0}" -f $reportPath) -ForegroundColor Green

#Requires -Version 5
Set-StrictMode -Version Latest

function New-TempWavPath {
  return Join-Path ([System.IO.Path]::GetTempPath()) ("tts-clean-" + [Guid]::NewGuid().ToString("N") + ".wav")
}

function Format-InvariantNumber {
  param([double]$Value)
  return $Value.ToString("0.###", [System.Globalization.CultureInfo]::InvariantCulture)
}

function Get-AudioDurationSeconds {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) {
    throw "Audio no encontrado: $Path"
  }

  $output = & ffprobe `
    -v error `
    -show_entries format=duration `
    -of default=noprint_wrappers=1:nokey=1 `
    $Path
  if ($LASTEXITCODE -ne 0) {
    throw "ffprobe no pudo leer la duracion de $Path"
  }

  $parsed = 0.0
  if (-not [double]::TryParse(($output | Out-String).Trim(), [System.Globalization.NumberStyles]::Float, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
    throw ("Duracion invalida reportada por ffprobe para {0}: {1}" -f $Path, $output)
  }
  return $parsed
}

function Get-TrailingTrimFilter {
  param(
    [double]$ThresholdDb = -34,
    [double]$MinSilenceSec = 0.15,
    [double]$KeepTailSec = 0.04
  )

  $thresholdText = "{0}dB" -f (Format-InvariantNumber -Value $ThresholdDb)
  $durationText = Format-InvariantNumber -Value $MinSilenceSec
  $keepText = Format-InvariantNumber -Value $KeepTailSec

  return "areverse,silenceremove=start_periods=1:start_duration=${durationText}:start_threshold=${thresholdText}:start_silence=${keepText},areverse"
}

function Invoke-TrimTrailingTail {
  param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [double]$ThresholdDb = -34,
    [double]$MinSilenceSec = 0.15,
    [double]$KeepTailSec = 0.04
  )

  if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Audio de entrada no encontrado: $InputPath"
  }

  $filter = Get-TrailingTrimFilter `
    -ThresholdDb $ThresholdDb `
    -MinSilenceSec $MinSilenceSec `
    -KeepTailSec $KeepTailSec

  & ffmpeg `
    -y `
    -loglevel error `
    -i $InputPath `
    -af $filter `
    -c:a pcm_s16le `
    -ar 24000 `
    -ac 1 `
    $OutputPath

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
    throw "ffmpeg no pudo recortar cola en $InputPath"
  }
}

function Invoke-AppendSilenceTail {
  param(
    [Parameter(Mandatory = $true)][string]$InputPath,
    [Parameter(Mandatory = $true)][string]$OutputPath,
    [double]$TailSec = 1.0
  )

  if (-not (Test-Path -LiteralPath $InputPath)) {
    throw "Audio de entrada no encontrado: $InputPath"
  }

  if ($TailSec -le 0) {
    Copy-Item -LiteralPath $InputPath -Destination $OutputPath -Force
    return
  }

  $tailText = Format-InvariantNumber -Value $TailSec
  & ffmpeg `
    -y `
    -loglevel error `
    -i $InputPath `
    -af "apad=pad_dur=${tailText}" `
    -c:a pcm_s16le `
    -ar 24000 `
    -ac 1 `
    $OutputPath

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $OutputPath)) {
    throw "ffmpeg no pudo agregar cola limpia en $InputPath"
  }
}

function Get-SpokenWordCount {
  param([Parameter(Mandatory = $true)][string]$Text)

  return [regex]::Matches($Text, "[\p{L}\p{Nd}]+").Count
}

function Get-MinExpectedGeneratedDurationSeconds {
  param(
    [Parameter(Mandatory = $true)][string]$Text,
    [double]$TailSec = 1.0
  )

  $wordCount = Get-SpokenWordCount -Text $Text
  $speechFloorSec = [math]::Max(0.8, $wordCount * 0.2)
  return [math]::Round($speechFloorSec + [math]::Max(0, $TailSec) - 0.12, 2)
}
function Get-AudioTrimAudit {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [double]$ThresholdDb = -34,
    [double]$MinSilenceSec = 0.15,
    [double]$KeepTailSec = 0.04
  )

  $originalDuration = Get-AudioDurationSeconds -Path $Path
  $trimmedPath = New-TempWavPath

  try {
    Invoke-TrimTrailingTail `
      -InputPath $Path `
      -OutputPath $trimmedPath `
      -ThresholdDb $ThresholdDb `
      -MinSilenceSec $MinSilenceSec `
      -KeepTailSec $KeepTailSec

    $trimmedDuration = Get-AudioDurationSeconds -Path $trimmedPath
    $trailing = [math]::Max(0, [math]::Round($originalDuration - $trimmedDuration, 2))

    return [pscustomobject]@{
      durationSec = [math]::Round($originalDuration, 2)
      trimmedDurationSec = [math]::Round($trimmedDuration, 2)
      trailingSec = $trailing
    }
  } finally {
    if (Test-Path -LiteralPath $trimmedPath) {
      Remove-Item -LiteralPath $trimmedPath -Force
    }
  }
}

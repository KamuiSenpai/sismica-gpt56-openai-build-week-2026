#Requires -Version 5
param(
  [int]$TargetEvents = 10,
  [int]$PollSeconds = 2,
  [int]$HealthPollSeconds = 3,
  [int]$MaxWaitMinutes = 90,
  [string]$ApiBaseUrl = "http://127.0.0.1:3000",
  [string[]]$WebUrls = @(
    "http://127.0.0.1:5173/",
    "http://127.0.0.1:5174/",
    "http://127.0.0.1:5175/",
    "http://127.0.0.1:5176/"
  ),
  [string]$ChatterboxHealthUrl = "http://127.0.0.1:8091/health"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root "output"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$prefix = "monitor10-live-$stamp"
$rawPath = Join-Path $outputDir "$prefix.telemetry.json"
$analysisPath = Join-Path $outputDir "$prefix.analysis.json"
$logPath = Join-Path $outputDir "$prefix.log"
$latestRawPath = Join-Path $outputDir "monitor10-live-latest.telemetry.json"
$latestAnalysisPath = Join-Path $outputDir "monitor10-live-latest.analysis.json"
$latestLogPath = Join-Path $outputDir "monitor10-live-latest.log"

function Write-Log {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  $line | Tee-Object -FilePath $logPath -Append
}

function Test-Http {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Find-WebUrl {
  foreach ($url in $WebUrls) {
    if (Test-Http -Url $url) {
      return $url
    }
  }
  return $null
}

function Wait-ForServices {
  $deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
  while ((Get-Date) -lt $deadline) {
    $apiOk = Test-Http -Url "$ApiBaseUrl/api/health"
    $ttsOk = Test-Http -Url $ChatterboxHealthUrl
    $webUrl = Find-WebUrl
    $webOk = $null -ne $webUrl
    if ($apiOk -and $ttsOk) {
      if ($webOk) {
        Write-Log "Servicios listos: API y Chatterbox sanos. Web detectada en $webUrl."
      } else {
        Write-Log "Servicios base listos: API y Chatterbox sanos. Web aun no responde; la captura queda armada."
      }
      return
    }
    Write-Log ("Esperando servicios. API={0} WEB={1} CHATTERBOX={2}" -f $apiOk, $webOk, $ttsOk)
    Start-Sleep -Seconds $HealthPollSeconds
  }
  throw "Tiempo de espera agotado sin salud base completa de API/Chatterbox."
}

function Invoke-TelemetryGet {
  param([int]$Since)
  return Invoke-RestMethod -Uri "$ApiBaseUrl/api/tts/telemetry?since=$Since" -TimeoutSec 10
}

function Clear-Telemetry {
  Invoke-RestMethod -Uri "$ApiBaseUrl/api/tts/telemetry" -Method Delete -TimeoutSec 10 | Out-Null
  Write-Log "Telemetria limpiada. Inicia captura nueva."
}

function Save-Json {
  param(
    [Parameter(Mandatory = $true)]$Data,
    [Parameter(Mandatory = $true)][string]$Path
  )
  $Data | ConvertTo-Json -Depth 10 | Set-Content -Path $Path -Encoding UTF8
}

function Group-ItemsByEvent {
  param([object[]]$Items)
  $map = @{}
  foreach ($item in $Items) {
    if (-not $item.eventId) { continue }
    if (-not $map.ContainsKey($item.eventId)) {
      $map[$item.eventId] = New-Object System.Collections.ArrayList
    }
    [void]$map[$item.eventId].Add($item)
  }
  return $map
}

function Measure-Event {
  param(
    [string]$EventId,
    [object[]]$Items
  )

  $ordered = @($Items | Sort-Object sequence)
  $narrationRequested = $ordered | Where-Object { $_.kind -eq "narration_requested" } | Select-Object -First 1
  $narrationResolved = $ordered | Where-Object { $_.kind -eq "narration_resolved" } | Select-Object -First 1
  $narrationFinished = $ordered | Where-Object { $_.kind -eq "narration_finished" } | Select-Object -Last 1
  $blobReady = $ordered | Where-Object { $_.kind -eq "neural_blob_ready" } | Select-Object -Last 1
  $bridgeStarted = @($ordered | Where-Object { $_.kind -eq "bridge_started" })
  $bridgeEnded = @($ordered | Where-Object { $_.kind -eq "bridge_ended" })
  $bridgeSkippedReady = @($ordered | Where-Object { $_.kind -eq "bridge_skipped_ready" })
  $bridgeSkippedPriority = @($ordered | Where-Object { $_.kind -eq "bridge_skipped_priority" })
  $bridgeBudgetReached = @($ordered | Where-Object { $_.kind -eq "bridge_budget_reached" })
  $neuralStarted = $ordered | Where-Object { $_.kind -eq "neural_started" } | Select-Object -First 1
  $neuralEnded = $ordered | Where-Object { $_.kind -eq "neural_ended" } | Select-Object -Last 1
  $hostId = @($ordered | Where-Object { $_.hostId } | Select-Object -ExpandProperty hostId -First 1)
  $libraries = @($bridgeStarted | ForEach-Object { $_.library } | Where-Object { $_ } )
  $selectedGroups = @($bridgeStarted | ForEach-Object { $_.selectedGroupId } | Where-Object { $_ } )
  $variants = @($bridgeStarted | ForEach-Object { $_.variant } | Where-Object { $_ } )
  $bridgeReasons = @($bridgeEnded | ForEach-Object { $_.reason } | Where-Object { $_ } )
  $promotionalDetected = ($selectedGroups -contains "promotional_channel") -or ($libraries -contains "official-promotional")

  $bridgeLeadMs = $null
  if ($narrationRequested -and $bridgeStarted.Count -gt 0) {
    $bridgeLeadMs =
      [int][math]::Round(
        (([datetime]$bridgeStarted[0].receivedAtUtc) - ([datetime]$narrationRequested.receivedAtUtc)).TotalMilliseconds
      )
  }

  return [pscustomobject]@{
    eventId = $EventId
    hostId = if ($hostId) { $hostId[0] } else { $null }
    outcome = $narrationFinished.outcome
    narrationTotalMs = $narrationFinished.durationMs
    narrationResolveMs = if ($narrationResolved) { $narrationResolved.durationMs } else { $null }
    neuralBlobReadyMs = if ($blobReady) { $blobReady.durationMs } else { $null }
    speechMs = if ($neuralEnded) { $neuralEnded.durationMs } else { $null }
    bridgeLeadMs = $bridgeLeadMs
    bridgeStartedCount = $bridgeStarted.Count
    bridgeEndedCount = $bridgeEnded.Count
    bridgeSkippedReadyCount = $bridgeSkippedReady.Count
    bridgeSkippedPriorityCount = $bridgeSkippedPriority.Count
    bridgeBudgetReachedCount = $bridgeBudgetReached.Count
    promotionalDetected = $promotionalDetected
    selectedGroups = $selectedGroups
    libraries = $libraries
    variants = $variants
    bridgeReasons = $bridgeReasons
  }
}

Write-Log "Monitor armado para $TargetEvents eventos."
Wait-ForServices
Clear-Telemetry

$sequence = 0
$captured = New-Object System.Collections.ArrayList
$finishedIds = New-Object System.Collections.ArrayList
$seenSequences = New-Object 'System.Collections.Generic.HashSet[int]'

while ($finishedIds.Count -lt $TargetEvents) {
  $payload = Invoke-TelemetryGet -Since $sequence
  if ($payload.latestSequence -gt $sequence) {
    $sequence = [int]$payload.latestSequence
  }

  foreach ($item in @($payload.items)) {
    $itemSequence = [int]$item.sequence
    if ($seenSequences.Contains($itemSequence)) { continue }
    $seenSequences.Add($itemSequence) | Out-Null
    [void]$captured.Add($item)

    if ($item.kind -eq "narration_finished" -and $item.eventId) {
      if (-not ($finishedIds -contains $item.eventId)) {
        [void]$finishedIds.Add($item.eventId)
        Write-Log ("Evento {0}/{1}: {2} host={3} total={4}ms" -f $finishedIds.Count, $TargetEvents, $item.eventId, $item.hostId, $item.durationMs)
      }
    }
  }

  Start-Sleep -Seconds $PollSeconds
}

Write-Log "Objetivo alcanzado. Esperando cola final de telemetria."
Start-Sleep -Seconds 3

$tail = Invoke-TelemetryGet -Since $sequence
foreach ($item in @($tail.items)) {
  $itemSequence = [int]$item.sequence
  if ($seenSequences.Contains($itemSequence)) { continue }
  $seenSequences.Add($itemSequence) | Out-Null
  [void]$captured.Add($item)
}

$allItems = @($captured | Sort-Object sequence)
$eventMap = Group-ItemsByEvent -Items $allItems
$eventSummaries = @()
foreach ($eventId in @($finishedIds)) {
  if (-not $eventMap.ContainsKey($eventId)) { continue }
  $eventSummaries += Measure-Event -EventId $eventId -Items @($eventMap[$eventId])
}

$avgNarrationMs = $null
if ($eventSummaries.Count -gt 0) {
  $avgNarrationMs = [int][math]::Round((($eventSummaries | Measure-Object -Property narrationTotalMs -Average).Average))
}

$avgBlobReadyMs = $null
$blobSamples = @($eventSummaries | Where-Object { $_.neuralBlobReadyMs -ne $null } | Select-Object -ExpandProperty neuralBlobReadyMs)
if ($blobSamples.Count -gt 0) {
  $avgBlobReadyMs = [int][math]::Round((($blobSamples | Measure-Object -Average).Average))
}

$avgBridgeCount = $null
if ($eventSummaries.Count -gt 0) {
  $avgBridgeCount = [math]::Round((($eventSummaries | Measure-Object -Property bridgeStartedCount -Average).Average), 2)
}

$libraryUsage = @{}
$selectedGroupUsage = @{}
$hostUsage = @{}
foreach ($event in $eventSummaries) {
  foreach ($library in @($event.libraries)) {
    if (-not $libraryUsage.ContainsKey($library)) { $libraryUsage[$library] = 0 }
    $libraryUsage[$library] += 1
  }
  foreach ($group in @($event.selectedGroups)) {
    if (-not $selectedGroupUsage.ContainsKey($group)) { $selectedGroupUsage[$group] = 0 }
    $selectedGroupUsage[$group] += 1
  }
  if ($event.hostId) {
    if (-not $hostUsage.ContainsKey($event.hostId)) { $hostUsage[$event.hostId] = 0 }
    $hostUsage[$event.hostId] += 1
  }
}

$analysis = [pscustomobject]@{
  capturedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  targetEvents = $TargetEvents
  capturedEvents = $eventSummaries.Count
  telemetryItems = $allItems.Count
  narrationFinishedCount = @($allItems | Where-Object { $_.kind -eq "narration_finished" }).Count
  promotionalDetectedCount = @($eventSummaries | Where-Object { $_.promotionalDetected }).Count
  bridgeSkippedPriorityEvents = @($eventSummaries | Where-Object { $_.bridgeSkippedPriorityCount -gt 0 }).Count
  bridgeBudgetReachedEvents = @($eventSummaries | Where-Object { $_.bridgeBudgetReachedCount -gt 0 }).Count
  avgNarrationMs = $avgNarrationMs
  avgBlobReadyMs = $avgBlobReadyMs
  avgBridgeStartedPerEvent = $avgBridgeCount
  libraryUsage = $libraryUsage
  selectedGroupUsage = $selectedGroupUsage
  hostUsage = $hostUsage
  events = $eventSummaries
}

Save-Json -Data ([pscustomobject]@{
  latestSequence = $sequence
  items = $allItems
}) -Path $rawPath
Save-Json -Data $analysis -Path $analysisPath

Copy-Item -LiteralPath $rawPath -Destination $latestRawPath -Force
Copy-Item -LiteralPath $analysisPath -Destination $latestAnalysisPath -Force
Copy-Item -LiteralPath $logPath -Destination $latestLogPath -Force

Write-Log "Captura finalizada."
Write-Log "Telemetria: $rawPath"
Write-Log "Analisis:   $analysisPath"

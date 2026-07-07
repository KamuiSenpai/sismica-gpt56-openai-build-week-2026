#Requires -Version 5
param(
  [int]$DurationMinutes = 60,
  [int]$PollSeconds = 5,
  [int]$HealthPollSeconds = 30,
  [string]$ApiBaseUrl = "http://127.0.0.1:3000",
  [string]$ChatterboxHealthUrl = "http://127.0.0.1:8091/health",
  [string[]]$WebUrls = @(
    "http://127.0.0.1:5173/",
    "http://127.0.0.1:5174/",
    "http://127.0.0.1:5175/",
    "http://127.0.0.1:5176/"
  ),
  [string]$Stamp = (Get-Date -Format "yyyyMMdd-HHmmss")
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$outputDir = Join-Path $root "output"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$prefix = "monitor1h-live-$Stamp"
$rawPath = Join-Path $outputDir "$prefix.telemetry.json"
$analysisPath = Join-Path $outputDir "$prefix.analysis.json"
$progressPath = Join-Path $outputDir "$prefix.progress.json"
$logPath = Join-Path $outputDir "$prefix.log"
$latestRawPath = Join-Path $outputDir "monitor1h-live-latest.telemetry.json"
$latestAnalysisPath = Join-Path $outputDir "monitor1h-live-latest.analysis.json"
$latestProgressPath = Join-Path $outputDir "monitor1h-live-latest.progress.json"
$latestLogPath = Join-Path $outputDir "monitor1h-live-latest.log"
$pidPath = Join-Path $outputDir "monitor1h-live.pid"

$PID | Set-Content -Path $pidPath -Encoding UTF8

function Write-LogLine {
  param([string]$Message)

  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Copy-Item -Path $logPath -Destination $latestLogPath -Force -ErrorAction SilentlyContinue
}

function Save-Json {
  param(
    [Parameter(Mandatory = $true)]$Data,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $Data | ConvertTo-Json -Depth 24 | Set-Content -Path $Path -Encoding UTF8
}

function Test-HttpStatus {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
    return [pscustomobject]@{
      ok = $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
      status = [int]$response.StatusCode
      error = $null
    }
  } catch {
    return [pscustomobject]@{
      ok = $false
      status = $null
      error = $_.Exception.Message
    }
  }
}

function Get-WebHealth {
  foreach ($url in $WebUrls) {
    $status = Test-HttpStatus -Url $url
    if ($status.ok) {
      return [pscustomobject]@{
        ok = $true
        url = $url
        status = $status.status
        error = $null
      }
    }
  }

  return [pscustomobject]@{
    ok = $false
    url = $null
    status = $null
    error = "No web URL responded"
  }
}

function Get-TelemetrySince {
  param([int]$Since)
  return Invoke-RestMethod -Uri "$ApiBaseUrl/api/tts/telemetry?since=$Since" -TimeoutSec 10
}

function Get-EventKey {
  param($Item)

  if (-not $Item.eventId) { return $null }
  $clientId = if ($Item.clientId) { $Item.clientId } else { "no-client" }
  return "$clientId|$($Item.eventId)"
}

function Get-Percentile {
  param(
    [double[]]$Values,
    [double]$Percentile
  )

  $valid = @($Values | Where-Object { $_ -ne $null } | Sort-Object)
  if ($valid.Count -eq 0) { return $null }
  if ($valid.Count -eq 1) { return [double]$valid[0] }

  $rank = ($valid.Count - 1) * $Percentile
  $low = [math]::Floor($rank)
  $high = [math]::Ceiling($rank)
  if ($low -eq $high) { return [double]$valid[$low] }

  $weight = $rank - $low
  return [double]($valid[$low] + (($valid[$high] - $valid[$low]) * $weight))
}

function Measure-BridgeCoverage {
  param(
    [object[]]$EventItems,
    [datetime]$RequestTime,
    [datetime]$NeuralStartTime
  )

  $coverageMs = 0
  $openBridge = $null

  foreach ($item in $EventItems) {
    if ($item.kind -eq "bridge_started") {
      $openBridge = $item
      continue
    }

    if ($item.kind -eq "bridge_ended" -and $openBridge) {
      $bridgeStart = [datetime]$openBridge.receivedAtUtc
      $bridgeEnd = [datetime]$item.receivedAtUtc
      $overlapStart = if ($bridgeStart -gt $RequestTime) { $bridgeStart } else { $RequestTime }
      $overlapEnd = if ($bridgeEnd -lt $NeuralStartTime) { $bridgeEnd } else { $NeuralStartTime }

      if ($overlapEnd -gt $overlapStart) {
        $coverageMs += [int][math]::Round(($overlapEnd - $overlapStart).TotalMilliseconds)
      }

      $openBridge = $null
    }
  }

  if ($openBridge) {
    $bridgeStart = [datetime]$openBridge.receivedAtUtc
    $overlapStart = if ($bridgeStart -gt $RequestTime) { $bridgeStart } else { $RequestTime }
    if ($NeuralStartTime -gt $overlapStart) {
      $coverageMs += [int][math]::Round(($NeuralStartTime - $overlapStart).TotalMilliseconds)
    }
  }

  return $coverageMs
}

function Measure-Event {
  param(
    [string]$Key,
    [object[]]$Items
  )

  $ordered = @($Items | Sort-Object sequence)
  $requested = $ordered | Where-Object { $_.kind -eq "narration_requested" } | Select-Object -First 1
  if (-not $requested) { return $null }

  $resolved = $ordered | Where-Object { $_.kind -eq "narration_resolved" } | Select-Object -First 1
  $ready = $ordered | Where-Object { $_.kind -eq "neural_blob_ready" } | Select-Object -Last 1
  $neuralStarted = $ordered | Where-Object { $_.kind -eq "neural_started" } | Select-Object -First 1
  $neuralEnded = $ordered | Where-Object { $_.kind -eq "neural_ended" } | Select-Object -Last 1
  $finished = $ordered | Where-Object { $_.kind -eq "narration_finished" } | Select-Object -Last 1
  $bridgeStarted = @($ordered | Where-Object { $_.kind -eq "bridge_started" })
  $bridgeEnded = @($ordered | Where-Object { $_.kind -eq "bridge_ended" })

  $waitMs = $null
  $bridgeCoverageMs = $null
  $silenceMs = $null
  $silencePct = $null

  if ($neuralStarted) {
    $requestTime = [datetime]$requested.receivedAtUtc
    $neuralStartTime = [datetime]$neuralStarted.receivedAtUtc
    $waitMs = [int][math]::Round(($neuralStartTime - $requestTime).TotalMilliseconds)
    $bridgeCoverageMs = Measure-BridgeCoverage -EventItems $ordered -RequestTime $requestTime -NeuralStartTime $neuralStartTime
    $silenceMs = [math]::Max(0, $waitMs - $bridgeCoverageMs)
    if ($waitMs -gt 0) {
      $silencePct = [math]::Round(($silenceMs * 100.0 / $waitMs), 1)
    }
  }

  $selectedGroups = @($bridgeStarted | ForEach-Object { $_.selectedGroupId } | Where-Object { $_ })
  $voices = @($bridgeStarted | ForEach-Object { $_.voice } | Where-Object { $_ })
  $libraries = @($bridgeStarted | ForEach-Object { $_.library } | Where-Object { $_ })

  return [pscustomobject]@{
    eventKey = $Key
    eventId = $requested.eventId
    clientId = $requested.clientId
    hostId = $requested.hostId
    firstSequence = $requested.sequence
    completed = [bool]$finished
    outcome = if ($finished) { $finished.outcome } else { $null }
    narrationTotalMs = if ($finished) { $finished.durationMs } else { $null }
    resolveMs = if ($resolved) { $resolved.durationMs } else { $null }
    neuralBlobReadyMs = if ($ready) { $ready.durationMs } else { $null }
    speechMs = if ($neuralEnded) { $neuralEnded.durationMs } else { $null }
    waitUntilNeuralStartedMs = $waitMs
    bridgeCoverageMs = $bridgeCoverageMs
    silenceMs = $silenceMs
    silencePct = $silencePct
    bridgeStartedCount = $bridgeStarted.Count
    bridgeEndedCount = $bridgeEnded.Count
    promotionalCount = @($bridgeStarted | Where-Object { $_.selectedGroupId -eq "promotional_channel" -or $_.library -eq "official-promotional" }).Count
    selectedGroups = $selectedGroups
    voices = $voices
    libraries = $libraries
    skippedPriority = @($ordered | Where-Object { $_.kind -eq "bridge_skipped_priority" }).Count
    skippedIneligible = @($ordered | Where-Object { $_.kind -eq "bridge_skipped_ineligible" }).Count
    skippedReady = @($ordered | Where-Object { $_.kind -eq "bridge_skipped_ready" }).Count
    budgetReached = @($ordered | Where-Object { $_.kind -eq "bridge_budget_reached" }).Count
  }
}

function New-Analysis {
  param(
    [object[]]$Items,
    [object[]]$HealthSamples,
    [datetime]$StartedAtUtc,
    [datetime]$EndedAtUtc,
    [int]$BaselineSequence,
    [int]$LatestSequence
  )

  $orderedItems = @($Items | Sort-Object sequence)
  $eventMap = @{}

  foreach ($item in $orderedItems) {
    $key = Get-EventKey -Item $item
    if (-not $key) { continue }
    if (-not $eventMap.ContainsKey($key)) {
      $eventMap[$key] = New-Object System.Collections.ArrayList
    }
    [void]$eventMap[$key].Add($item)
  }

  $events = @()
  foreach ($key in $eventMap.Keys) {
    $summary = Measure-Event -Key $key -Items @($eventMap[$key])
    if ($summary) { $events += $summary }
  }

  $events = @($events | Sort-Object firstSequence)
  $complete = @($events | Where-Object { $_.completed -and $_.waitUntilNeuralStartedMs -ne $null })
  $withReady = @($events | Where-Object { $_.neuralBlobReadyMs -ne $null })

  $totalWaitMs = [double](($complete | Measure-Object -Property waitUntilNeuralStartedMs -Sum).Sum)
  $totalBridgeMs = [double](($complete | Measure-Object -Property bridgeCoverageMs -Sum).Sum)
  $totalSilenceMs = [double](($complete | Measure-Object -Property silenceMs -Sum).Sum)

  $silenceMsValues = [double[]]@($complete | ForEach-Object { [double]$_.silenceMs })
  $silencePctValues = [double[]]@($complete | ForEach-Object { [double]$_.silencePct })
  $readyValues = [double[]]@($withReady | ForEach-Object { [double]$_.neuralBlobReadyMs })

  $groupUsage = @{}
  $voiceUsage = @{}
  $libraryUsage = @{}

  foreach ($event in $events) {
    foreach ($group in @($event.selectedGroups)) {
      if (-not $groupUsage.ContainsKey($group)) { $groupUsage[$group] = 0 }
      $groupUsage[$group] += 1
    }

    foreach ($voice in @($event.voices)) {
      if (-not $voiceUsage.ContainsKey($voice)) { $voiceUsage[$voice] = 0 }
      $voiceUsage[$voice] += 1
    }

    foreach ($library in @($event.libraries)) {
      if (-not $libraryUsage.ContainsKey($library)) { $libraryUsage[$library] = 0 }
      $libraryUsage[$library] += 1
    }
  }

  return [pscustomobject]@{
    startedAtUtc = $StartedAtUtc.ToString("o")
    endedAtUtc = $EndedAtUtc.ToString("o")
    durationSeconds = [int][math]::Round(($EndedAtUtc - $StartedAtUtc).TotalSeconds)
    baselineSequence = $BaselineSequence
    latestSequence = $LatestSequence
    capturedItems = $orderedItems.Count
    narrationRequests = @($orderedItems | Where-Object { $_.kind -eq "narration_requested" }).Count
    completedEvents = $complete.Count
    incompleteEvents = @($events | Where-Object { -not $_.completed }).Count
    totalWaitMs = [int]$totalWaitMs
    totalBridgeCoverageMs = [int]$totalBridgeMs
    totalSilenceMs = [int]$totalSilenceMs
    totalSilencePct = if ($totalWaitMs -gt 0) { [math]::Round(($totalSilenceMs * 100.0 / $totalWaitMs), 1) } else { $null }
    averageSilenceMs = if ($complete.Count -gt 0) { [int][math]::Round((($complete | Measure-Object -Property silenceMs -Average).Average)) } else { $null }
    averageSilencePct = if ($complete.Count -gt 0) { [math]::Round((($complete | Measure-Object -Property silencePct -Average).Average), 1) } else { $null }
    p50SilenceMs = if ($complete.Count -gt 0) { [int][math]::Round((Get-Percentile -Values $silenceMsValues -Percentile 0.50)) } else { $null }
    p90SilenceMs = if ($complete.Count -gt 0) { [int][math]::Round((Get-Percentile -Values $silenceMsValues -Percentile 0.90)) } else { $null }
    p95SilenceMs = if ($complete.Count -gt 0) { [int][math]::Round((Get-Percentile -Values $silenceMsValues -Percentile 0.95)) } else { $null }
    p50SilencePct = if ($complete.Count -gt 0) { [math]::Round((Get-Percentile -Values $silencePctValues -Percentile 0.50), 1) } else { $null }
    p90SilencePct = if ($complete.Count -gt 0) { [math]::Round((Get-Percentile -Values $silencePctValues -Percentile 0.90), 1) } else { $null }
    p95SilencePct = if ($complete.Count -gt 0) { [math]::Round((Get-Percentile -Values $silencePctValues -Percentile 0.95), 1) } else { $null }
    averageNeuralBlobReadyMs = if ($withReady.Count -gt 0) { [int][math]::Round((($withReady | Measure-Object -Property neuralBlobReadyMs -Average).Average)) } else { $null }
    p95NeuralBlobReadyMs = if ($withReady.Count -gt 0) { [int][math]::Round((Get-Percentile -Values $readyValues -Percentile 0.95)) } else { $null }
    bridgeStartedCount = @($orderedItems | Where-Object { $_.kind -eq "bridge_started" }).Count
    promotionalGuideCount = @($orderedItems | Where-Object { $_.kind -eq "bridge_started" -and ($_.selectedGroupId -eq "promotional_channel" -or $_.library -eq "official-promotional") }).Count
    skippedPriority = @($orderedItems | Where-Object { $_.kind -eq "bridge_skipped_priority" }).Count
    skippedIneligible = @($orderedItems | Where-Object { $_.kind -eq "bridge_skipped_ineligible" }).Count
    skippedReady = @($orderedItems | Where-Object { $_.kind -eq "bridge_skipped_ready" }).Count
    budgetReached = @($orderedItems | Where-Object { $_.kind -eq "bridge_budget_reached" }).Count
    groupUsage = $groupUsage
    voiceUsage = $voiceUsage
    libraryUsage = $libraryUsage
    health = [pscustomobject]@{
      samples = $HealthSamples.Count
      apiFailures = @($HealthSamples | Where-Object { -not $_.apiOk }).Count
      chatterboxFailures = @($HealthSamples | Where-Object { -not $_.chatterboxOk }).Count
      webFailures = @($HealthSamples | Where-Object { -not $_.webOk }).Count
      last = if ($HealthSamples.Count -gt 0) { $HealthSamples[-1] } else { $null }
    }
    outliers = @($complete | Sort-Object silencePct -Descending | Select-Object -First 10 eventId, firstSequence, waitUntilNeuralStartedMs, bridgeCoverageMs, silenceMs, silencePct, bridgeStartedCount, promotionalCount, selectedGroups, voices, skippedPriority, skippedIneligible, skippedReady)
    events = $events
  }
}

function Save-Progress {
  param(
    [string]$Status,
    [datetime]$StartedAt,
    [datetime]$Deadline,
    [int]$BaselineSequence,
    [int]$LatestSequence,
    [object[]]$Items,
    [object[]]$HealthSamples
  )

  $now = Get-Date
  $progress = [pscustomobject]@{
    status = $Status
    stamp = $Stamp
    pid = $PID
    startedAtUtc = $StartedAt.ToUniversalTime().ToString("o")
    nowUtc = $now.ToUniversalTime().ToString("o")
    elapsedSeconds = [int][math]::Round(($now - $StartedAt).TotalSeconds)
    remainingSeconds = [int][math]::Max(0, [math]::Round(($Deadline - $now).TotalSeconds))
    baselineSequence = $BaselineSequence
    latestSequence = $LatestSequence
    capturedItems = $Items.Count
    narrationRequests = @($Items | Where-Object { $_.kind -eq "narration_requested" }).Count
    completedNarrations = @($Items | Where-Object { $_.kind -eq "narration_finished" }).Count
    bridgeStarted = @($Items | Where-Object { $_.kind -eq "bridge_started" }).Count
    promotionalGuides = @($Items | Where-Object { $_.kind -eq "bridge_started" -and ($_.selectedGroupId -eq "promotional_channel" -or $_.library -eq "official-promotional") }).Count
    skippedPriority = @($Items | Where-Object { $_.kind -eq "bridge_skipped_priority" }).Count
    skippedIneligible = @($Items | Where-Object { $_.kind -eq "bridge_skipped_ineligible" }).Count
    skippedReady = @($Items | Where-Object { $_.kind -eq "bridge_skipped_ready" }).Count
    healthSamples = $HealthSamples.Count
    rawPath = $rawPath
    analysisPath = $analysisPath
  }

  Save-Json -Data $progress -Path $progressPath
  Copy-Item -Path $progressPath -Destination $latestProgressPath -Force -ErrorAction SilentlyContinue
}

try {
  Write-LogLine "Monitor 1h started. PID=$PID stamp=$Stamp"

  $initialTelemetry = Invoke-RestMethod -Uri "$ApiBaseUrl/api/tts/telemetry" -TimeoutSec 10
  $baselineSequence = [int]$initialTelemetry.latestSequence
  $latestSequence = $baselineSequence
  $captured = New-Object System.Collections.ArrayList
  $seenSequences = New-Object 'System.Collections.Generic.HashSet[int]'
  $healthSamples = New-Object System.Collections.ArrayList
  $startedAt = Get-Date
  $deadline = $startedAt.AddMinutes($DurationMinutes)
  $nextHealthAt = Get-Date

  Write-LogLine "Baseline sequence=$baselineSequence durationMinutes=$DurationMinutes"

  while ((Get-Date) -lt $deadline) {
    try {
      $payload = Get-TelemetrySince -Since $latestSequence
      if ([int]$payload.latestSequence -gt $latestSequence) {
        $latestSequence = [int]$payload.latestSequence
      }

      foreach ($item in @($payload.items)) {
        $sequence = [int]$item.sequence
        if ($sequence -le $baselineSequence) { continue }
        if ($seenSequences.Contains($sequence)) { continue }

        [void]$seenSequences.Add($sequence)
        [void]$captured.Add($item)
      }
    } catch {
      Write-LogLine "Telemetry error: $($_.Exception.Message)"
    }

    if ((Get-Date) -ge $nextHealthAt) {
      $apiHealth = Test-HttpStatus -Url "$ApiBaseUrl/api/health"
      $ttsHealth = Test-HttpStatus -Url $ChatterboxHealthUrl
      $webHealth = Get-WebHealth

      [void]$healthSamples.Add([pscustomobject]@{
        atUtc = (Get-Date).ToUniversalTime().ToString("o")
        apiOk = [bool]$apiHealth.ok
        apiStatus = $apiHealth.status
        chatterboxOk = [bool]$ttsHealth.ok
        chatterboxStatus = $ttsHealth.status
        webOk = [bool]$webHealth.ok
        webUrl = $webHealth.url
        webStatus = $webHealth.status
      })

      $nextHealthAt = (Get-Date).AddSeconds($HealthPollSeconds)
    }

    Save-Progress `
      -Status "running" `
      -StartedAt $startedAt `
      -Deadline $deadline `
      -BaselineSequence $baselineSequence `
      -LatestSequence $latestSequence `
      -Items @($captured | Sort-Object sequence) `
      -HealthSamples @($healthSamples)

    Start-Sleep -Seconds $PollSeconds
  }

  Start-Sleep -Seconds 2

  try {
    $tail = Get-TelemetrySince -Since $latestSequence
    if ([int]$tail.latestSequence -gt $latestSequence) {
      $latestSequence = [int]$tail.latestSequence
    }

    foreach ($item in @($tail.items)) {
      $sequence = [int]$item.sequence
      if ($sequence -le $baselineSequence) { continue }
      if ($seenSequences.Contains($sequence)) { continue }

      [void]$seenSequences.Add($sequence)
      [void]$captured.Add($item)
    }
  } catch {
    Write-LogLine "Final tail error: $($_.Exception.Message)"
  }

  $endedAt = Get-Date
  $allItems = @($captured | Sort-Object sequence)
  Save-Json -Data $allItems -Path $rawPath
  Copy-Item -Path $rawPath -Destination $latestRawPath -Force -ErrorAction SilentlyContinue

  $analysis = New-Analysis `
    -Items $allItems `
    -HealthSamples @($healthSamples) `
    -StartedAtUtc $startedAt.ToUniversalTime() `
    -EndedAtUtc $endedAt.ToUniversalTime() `
    -BaselineSequence $baselineSequence `
    -LatestSequence $latestSequence

  Save-Json -Data $analysis -Path $analysisPath
  Copy-Item -Path $analysisPath -Destination $latestAnalysisPath -Force -ErrorAction SilentlyContinue

  Save-Progress `
    -Status "complete" `
    -StartedAt $startedAt `
    -Deadline $deadline `
    -BaselineSequence $baselineSequence `
    -LatestSequence $latestSequence `
    -Items $allItems `
    -HealthSamples @($healthSamples)

  Write-LogLine "Monitor complete. completedEvents=$($analysis.completedEvents) totalSilencePct=$($analysis.totalSilencePct)"
} catch {
  $errorState = [pscustomobject]@{
    status = "error"
    stamp = $Stamp
    pid = $PID
    atUtc = (Get-Date).ToUniversalTime().ToString("o")
    message = $_.Exception.Message
    stack = $_.ScriptStackTrace
  }

  Save-Json -Data $errorState -Path $progressPath
  Copy-Item -Path $progressPath -Destination $latestProgressPath -Force -ErrorAction SilentlyContinue
  Write-LogLine "ERROR: $($_.Exception.Message)"
  exit 1
}

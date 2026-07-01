param(
  [string]$DataDir,
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$EnvPath = Join-Path $Root ".env"

function Get-DotEnvValue {
  param([string]$Name)

  if (-not (Test-Path $EnvPath)) {
    return $null
  }

  $line = Get-Content $EnvPath | Where-Object {
    $_ -match "^\s*$Name\s*="
  } | Select-Object -First 1

  if (-not $line) {
    return $null
  }

  return ($line -replace "^\s*$Name\s*=", "").Trim().Trim('"').Trim("'")
}

function Resolve-ProjectPath {
  param([string]$PathValue)

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $Root $PathValue))
}

if (-not $DataDir) {
  $DataDir = $env:SISMICA_PGDATA
}
if (-not $DataDir) {
  $DataDir = Get-DotEnvValue "SISMICA_PGDATA"
}
if (-not $DataDir) {
  $DataDir = ".runtime\pgsql-data-mvp"
}

if ($Port -eq 0 -and $env:SISMICA_PGPORT) {
  $Port = [int]$env:SISMICA_PGPORT
}
if ($Port -eq 0) {
  $envPort = Get-DotEnvValue "SISMICA_PGPORT"
  if ($envPort) {
    $Port = [int]$envPort
  }
}
if ($Port -eq 0) {
  $Port = 5433
}

$DataDir = Resolve-ProjectPath $DataDir
$PgBin = Join-Path $Root ".runtime\pgsql16\bin"
$PgCtl = Join-Path $PgBin "pg_ctl.exe"
$Psql = Join-Path $PgBin "psql.exe"
$LogDir = Join-Path $Root ".runtime\logs"
$LogPath = Join-Path $LogDir "postgres-historical-$Port.log"

if (-not (Test-Path $PgCtl)) {
  throw "No se encontro pg_ctl.exe en $PgCtl"
}
if (-not (Test-Path $Psql)) {
  throw "No se encontro psql.exe en $Psql"
}
if (-not (Test-Path (Join-Path $DataDir "PG_VERSION"))) {
  throw "La ruta $DataDir no parece ser un directorio de datos PostgreSQL valido."
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$env:PGPASSWORD = "postgres"
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  $actualDataDir = (& $Psql -h localhost -p $Port -U postgres -d sismica -Atc "SHOW data_directory;" 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $actualDataDir) {
    throw "El puerto $Port esta ocupado, pero no se pudo validar su data_directory."
  }

  $actualDataDir = [System.IO.Path]::GetFullPath($actualDataDir.Trim())
  if ($actualDataDir -ne $DataDir) {
    throw "El puerto $Port esta usando $actualDataDir, no $DataDir. Deten esa instancia antes de iniciar el runtime historico."
  }

  $summary = (& $Psql -h localhost -p $Port -U postgres -d sismica -Atc "SELECT COUNT(*), MIN(event_time_utc), MAX(event_time_utc) FROM seismic_events;")
  Write-Host "PostgreSQL historico ya esta activo en localhost:$Port"
  Write-Host "data_directory=$DataDir"
  Write-Host "seismic_events=$summary"
  exit 0
}

& $PgCtl -D $DataDir -o "-p $Port -h localhost" -l $LogPath start

for ($attempt = 1; $attempt -le 20; $attempt++) {
  Start-Sleep -Milliseconds 500
  $summary = (& $Psql -h localhost -p $Port -U postgres -d sismica -Atc "SELECT COUNT(*), MIN(event_time_utc), MAX(event_time_utc) FROM seismic_events;" 2>$null)
  if ($LASTEXITCODE -eq 0 -and $summary) {
    Write-Host "PostgreSQL historico iniciado en localhost:$Port"
    Write-Host "data_directory=$DataDir"
    Write-Host "seismic_events=$summary"
    exit 0
  }
}

throw "PostgreSQL no respondio en localhost:$Port. Revisa $LogPath"

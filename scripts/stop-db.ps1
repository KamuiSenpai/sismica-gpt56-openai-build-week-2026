param(
  [string]$DataDir
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

$DataDir = Resolve-ProjectPath $DataDir
$PgCtl = Join-Path $Root ".runtime\pgsql16\bin\pg_ctl.exe"

if (-not (Test-Path $PgCtl)) {
  throw "No se encontro pg_ctl.exe en $PgCtl"
}
if (-not (Test-Path (Join-Path $DataDir "PG_VERSION"))) {
  throw "La ruta $DataDir no parece ser un directorio de datos PostgreSQL valido."
}

$status = (& $PgCtl -D $DataDir status 2>$null)
if ($LASTEXITCODE -ne 0) {
  Write-Host "PostgreSQL historico no esta activo para $DataDir"
  exit 0
}

Write-Host $status
& $PgCtl -D $DataDir stop -m fast

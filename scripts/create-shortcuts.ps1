#Requires -Version 5
<#
  Crea accesos directos (.lnk) que lanzan scripts\start-all.ps1:
    - en el Escritorio ("Sismica.lnk")
    - en la raiz del proyecto ("Iniciar Sismica.lnk")
  Vuelve a ejecutarlo si mueves el proyecto de carpeta.
#>

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$script = Join-Path $root "scripts\start-all.ps1"
$arguments = "-NoExit -ExecutionPolicy Bypass -File `"$script`""
$icon = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"

$shell = New-Object -ComObject WScript.Shell
$targets = @(
  (Join-Path ([Environment]::GetFolderPath("Desktop")) "Sismica.lnk"),
  (Join-Path $root "Iniciar Sismica.lnk")
)

foreach ($lnkPath in $targets) {
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = "powershell.exe"
  $lnk.Arguments = $arguments
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $icon
  $lnk.Description = "Levanta la plataforma sismica (DB, API, worker, XTTS, web)"
  $lnk.Save()
  Write-Host "Acceso directo creado: $lnkPath" -ForegroundColor Green
}

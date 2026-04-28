# Customrflow Print Agent — Uninstaller (Windows)
#
# Verwendung:
#   iex (irm https://app.customrflow.com/agent/uninstall.ps1)
#
# Entfernt: Binary, Scheduled Task, Desktop-Verknüpfung.
# Erhalten: Pairing-Daten unter %APPDATA%\xflow-print-agent\.

$ErrorActionPreference = 'Stop'

$TaskName   = 'Customrflow Print Agent'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Customrflow'

function Write-Ok($msg)  { Write-Host "✓ $msg" -ForegroundColor Green }

Stop-ScheduledTask    -TaskName $TaskName -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

Remove-Item -Force -Recurse $InstallDir -ErrorAction SilentlyContinue

$desktop = [Environment]::GetFolderPath('Desktop')
Remove-Item -Force (Join-Path $desktop 'Drucker-Agent öffnen.url') -ErrorAction SilentlyContinue

Write-Ok 'Drucker-Agent deinstalliert.'
Write-Host '  Pairing-Daten bleiben unter $env:APPDATA\xflow-print-agent\ erhalten.'
Write-Host '  Komplett entfernen: Remove-Item -Recurse $env:APPDATA\xflow-print-agent'

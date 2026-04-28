# Customrflow Print Agent — installer for Windows.
#
#   Install:    iex (irm https://customrflow.com/agent/install.ps1)
#   Uninstall:  & ([scriptblock]::Create((irm https://customrflow.com/agent/install.ps1))) uninstall
#   Restart:    & ([scriptblock]::Create((irm https://customrflow.com/agent/install.ps1))) restart
#   Update:     just re-run install — idempotent.
#
# Behavior:
#   - Binary:      $env:LOCALAPPDATA\Customrflow\xflow-print-agent.exe
#   - Auto-start:  Task Scheduler "Customrflow Print Agent" (At log on, current user)
#   - Auto-restart on failure: Task Scheduler retries every 1 min, max 999 times
#   - Shortcut:    Desktop\Drucker-Agent öffnen.url

param(
  [Parameter(Position=0)] [string]$Action = 'install'
)

$ErrorActionPreference = 'Stop'

$BinName    = 'xflow-print-agent.exe'
$TaskName   = 'Customrflow Print Agent'
$UiUrl      = 'http://localhost:38702/'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Customrflow'
$BinPath    = Join-Path $InstallDir $BinName
# Default download mirror (deine eigene Domain). Override via env:
#   $env:CUSTOMRFLOW_AGENT_BASE_URL='https://my-server.local/agent'
$BaseUrl    = if ($env:CUSTOMRFLOW_AGENT_BASE_URL) { $env:CUSTOMRFLOW_AGENT_BASE_URL } else { 'https://customrflow.com/agent' }

function Write-Info($msg)  { Write-Host "→ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "✗ $msg" -ForegroundColor Red }

function Detect-Arch {
  $arch = (Get-CimInstance Win32_Processor | Select-Object -First 1).Architecture
  if ($arch -eq 9) { return 'x64' }   # AMD/Intel x64
  if ($arch -eq 12) { return 'arm64' } # ARM64
  return 'x64' # safe default for older boxes
}

function Cmd-Install {
  $arch = Detect-Arch
  Write-Info "Customrflow Print Agent — Installation für windows/$arch"

  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $asset = "xflow-print-agent-win-$arch.exe"
  $url   = "$BaseUrl/bin/$asset"

  Write-Info "Lade Binary von $url"
  try {
    Invoke-WebRequest -Uri $url -OutFile "$BinPath.new" -UseBasicParsing
  } catch {
    Write-Err "Download fehlgeschlagen: $url"
    Write-Err '  Bitte prüfen ob die Datei auf dem Server existiert.'
    exit 1
  }
  Move-Item -Force "$BinPath.new" $BinPath
  Write-Ok "Binary installiert: $BinPath"

  # Register Scheduled Task (auto-start at logon + restart on failure)
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  $action  = New-ScheduledTaskAction -Execute $BinPath
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Customrflow Print Agent — verbindet lokale Drucker mit dem Cloud-Backend.' `
    -Force | Out-Null

  Start-ScheduledTask -TaskName $TaskName
  Write-Ok 'Scheduled Task registriert + gestartet — läuft automatisch bei jedem Login'

  # Desktop shortcut (.url is just text — never blocked)
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (Test-Path $desktop) {
    $shortcut = Join-Path $desktop 'Drucker-Agent öffnen.url'
    @"
[InternetShortcut]
URL=$UiUrl
"@ | Set-Content -Path $shortcut -Encoding ASCII
    Write-Ok 'Desktop-Verknüpfung angelegt: "Drucker-Agent öffnen"'
  }

  Start-Process $UiUrl
  Write-Host ''
  Write-Ok 'Installation abgeschlossen'
  Write-Host ''
  Write-Host "Agent neu starten:  iex (irm https://customrflow.com/agent/install.ps1) restart"
  Write-Host "Deinstallieren:     iex (irm https://customrflow.com/agent/install.ps1) uninstall"
  Write-Host "Browser-Verknüpfung auf dem Desktop öffnet jederzeit $UiUrl"
}

function Cmd-Restart {
  Restart-ScheduledTask -TaskName $TaskName
  Write-Ok 'Agent neu gestartet'
}

function Cmd-Uninstall {
  Stop-ScheduledTask    -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Force -Recurse $InstallDir -ErrorAction SilentlyContinue
  $desktop = [Environment]::GetFolderPath('Desktop')
  Remove-Item -Force (Join-Path $desktop 'Drucker-Agent öffnen.url') -ErrorAction SilentlyContinue
  Write-Ok 'Agent deinstalliert. Konfiguration bleibt unter ~/.config/xflow-print-agent/ erhalten.'
}

switch ($Action.ToLower()) {
  'install'   { Cmd-Install }
  ''          { Cmd-Install }
  'restart'   { Cmd-Restart }
  'uninstall' { Cmd-Uninstall }
  default     { Write-Err "Unbekannter Befehl: $Action"; Write-Host 'Verwendung: install | restart | uninstall'; exit 1 }
}

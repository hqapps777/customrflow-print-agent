#!/usr/bin/env bash
# Customrflow Print Agent — installer for macOS + Linux.
#
#   Install:    curl -sSL https://app.customrflow.com/agent/install.sh | bash
#   Uninstall:  curl -sSL https://app.customrflow.com/agent/install.sh | bash -s uninstall
#   Restart:    curl -sSL https://app.customrflow.com/agent/install.sh | bash -s restart
#   Update:     just re-run install — the script is idempotent.
#
# Behavior:
#   - macOS:  ~/.local/bin/xflow-print-agent + ~/Library/LaunchAgents/...plist
#             + ~/Desktop/Drucker-Agent öffnen.webloc
#   - Linux:  ~/.local/bin/xflow-print-agent + ~/.config/systemd/user/...service
#             + ~/Desktop/customrflow-print-agent.desktop (if Desktop exists)
#
# Auto-start at login + auto-restart on crash. No sudo required.

set -euo pipefail

BIN_NAME="xflow-print-agent"
LABEL="app.customrflow.print-agent"
UI_URL="http://localhost:38701/"
INSTALL_DIR="$HOME/.local/bin"
BIN_PATH="$INSTALL_DIR/$BIN_NAME"
# Default download mirror (deine eigene Domain). Override via env:
#   CUSTOMRFLOW_AGENT_BASE_URL=https://my-server.local/agent ./install.sh
BASE_URL="${CUSTOMRFLOW_AGENT_BASE_URL:-https://app.customrflow.com/agent}"

red()    { printf "\033[31m%s\033[0m\n" "$*"; }
green()  { printf "\033[32m%s\033[0m\n" "$*"; }
blue()   { printf "\033[34m%s\033[0m\n" "$*"; }
yellow() { printf "\033[33m%s\033[0m\n" "$*"; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *) red "Unsupported OS: $(uname -s)"; exit 1 ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64)  echo "x64"   ;;
    *) red "Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
}

OS="$(detect_os)"
ARCH="$(detect_arch)"
ASSET="${BIN_NAME}-${OS}-${ARCH}"
DOWNLOAD_URL="${BASE_URL}/bin/${ASSET}"

cmd_install() {
  blue "→ Customrflow Print Agent — Installation für ${OS}/${ARCH}"
  mkdir -p "$INSTALL_DIR"

  blue "→ Lade Binary (~60 MB) von ${DOWNLOAD_URL}"
  # --progress-bar shows a single-line progress indicator so the customer
  # sees movement during the multi-second download instead of thinking the
  # script froze.
  if ! curl -fL --progress-bar --retry 3 -o "${BIN_PATH}.new" "$DOWNLOAD_URL"; then
    red "Download fehlgeschlagen: $DOWNLOAD_URL"
    red "  Bitte prüfen ob die Datei auf dem Server existiert."
    exit 1
  fi
  chmod +x "${BIN_PATH}.new"
  mv "${BIN_PATH}.new" "$BIN_PATH"
  green "✓ Binary installiert: $BIN_PATH"

  if [ "$OS" = "macos" ]; then
    install_macos_launchagent
    install_macos_shortcut
  else
    install_linux_systemd_unit
    install_linux_shortcut
  fi

  blue "→ Öffne Pairing-UI im Browser…"
  if [ "$OS" = "macos" ]; then
    open "$UI_URL" >/dev/null 2>&1 || true
  else
    xdg-open "$UI_URL" >/dev/null 2>&1 || true
  fi

  cat <<EOF

$(green "✓ Installation abgeschlossen")

Status prüfen:    $BIN_PATH --version
Agent neu laden:  curl -sSL https://app.customrflow.com/agent/install.sh | bash -s restart
Deinstallieren:   curl -sSL https://app.customrflow.com/agent/install.sh | bash -s uninstall

Desktop-Verknüpfung "Drucker-Agent öffnen" → öffnet jederzeit ${UI_URL}
EOF
}

install_macos_launchagent() {
  local plist="$HOME/Library/LaunchAgents/${LABEL}.plist"
  mkdir -p "$HOME/Library/LaunchAgents"

  cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_PATH}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>/tmp/customrflow-print-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/customrflow-print-agent.err.log</string>
</dict>
</plist>
EOF

  # Reload (bootout if existed)
  launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
  green "✓ LaunchAgent geladen — Agent startet bei jedem Login automatisch"
}

install_macos_shortcut() {
  local desktop="$HOME/Desktop"
  [ -d "$desktop" ] || return 0
  local shortcut="$desktop/Drucker-Agent öffnen.webloc"
  cat > "$shortcut" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>URL</key>
  <string>${UI_URL}</string>
</dict>
</plist>
EOF
  green "✓ Desktop-Verknüpfung angelegt: \"Drucker-Agent öffnen\""
}

install_linux_systemd_unit() {
  local unit_dir="$HOME/.config/systemd/user"
  local unit="$unit_dir/${LABEL}.service"
  mkdir -p "$unit_dir"
  cat > "$unit" <<EOF
[Unit]
Description=Customrflow Print Agent
After=network-online.target

[Service]
ExecStart=${BIN_PATH}
Restart=always
RestartSec=2
StandardOutput=append:/tmp/customrflow-print-agent.log
StandardError=append:/tmp/customrflow-print-agent.err.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now "${LABEL}.service"
  green "✓ systemd User-Unit geladen — Agent startet bei jedem Login automatisch"
}

install_linux_shortcut() {
  local desktop="$HOME/Desktop"
  [ -d "$desktop" ] || return 0
  local shortcut="$desktop/customrflow-print-agent.desktop"
  cat > "$shortcut" <<EOF
[Desktop Entry]
Version=1.0
Type=Link
Name=Drucker-Agent öffnen
URL=${UI_URL}
EOF
  chmod +x "$shortcut"
  green "✓ Desktop-Verknüpfung angelegt"
}

cmd_restart() {
  if [ "$OS" = "macos" ]; then
    launchctl kickstart -k "gui/$(id -u)/${LABEL}" && green "✓ Agent neu gestartet"
  else
    systemctl --user restart "${LABEL}.service" && green "✓ Agent neu gestartet"
  fi
}

cmd_uninstall() {
  if [ "$OS" = "macos" ]; then
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
    rm -f "$HOME/Desktop/Drucker-Agent öffnen.webloc"
  else
    systemctl --user disable --now "${LABEL}.service" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/${LABEL}.service"
    systemctl --user daemon-reload || true
    rm -f "$HOME/Desktop/customrflow-print-agent.desktop"
  fi
  rm -f "$BIN_PATH"
  green "✓ Agent deinstalliert. Konfiguration bleibt unter ~/.config/xflow-print-agent/ erhalten."
}

case "${1:-install}" in
  install|"")  cmd_install ;;
  restart)     cmd_restart ;;
  uninstall)   cmd_uninstall ;;
  *) red "Unbekannter Befehl: $1"; echo "Verwendung: $0 [install|restart|uninstall]"; exit 1 ;;
esac

#!/usr/bin/env bash
# Customrflow Print Agent — Uninstaller (macOS + Linux)
#
# Verwendung:
#   curl -sSL https://app.customrflow.com/agent/uninstall.sh | bash
#
# Entfernt: Binary, LaunchAgent/systemd-Unit, Desktop-Verknüpfung.
# Erhalten: Pairing-Daten unter ~/.config/xflow-print-agent/ (manuell löschen
# falls gewünscht: rm -rf ~/.config/xflow-print-agent).

set -euo pipefail

LABEL="app.customrflow.print-agent"
BIN_PATH="$HOME/.local/bin/xflow-print-agent"

green() { printf "\033[32m%s\033[0m\n" "$*"; }
red()   { printf "\033[31m%s\033[0m\n" "$*"; }

case "$(uname -s)" in
  Darwin)
    launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/${LABEL}.plist"
    rm -f "$HOME/Desktop/Drucker-Agent öffnen.webloc"
    ;;
  Linux)
    systemctl --user disable --now "${LABEL}.service" 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/${LABEL}.service"
    systemctl --user daemon-reload || true
    rm -f "$HOME/Desktop/customrflow-print-agent.desktop"
    ;;
  *)
    red "Nicht unterstütztes Betriebssystem: $(uname -s)"
    exit 1
    ;;
esac

rm -f "$BIN_PATH"

green "✓ Drucker-Agent deinstalliert."
echo  "  Pairing-Daten bleiben unter ~/.config/xflow-print-agent/ erhalten."
echo  "  Komplett entfernen: rm -rf ~/.config/xflow-print-agent"

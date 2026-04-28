#!/usr/bin/env bash
# Baut alle 5 Agent-Binaries lokal (kein CI, keine Signaturen) und legt sie
# in dist-binaries/ ab — fertig zum Hochladen auf deinen Server unter
# https://app.customrflow.com/agent/bin/xflow-print-agent-{os}-{arch}[.exe].
#
# Einmalig nötig:  npm install
# Build:           ./scripts/build-binaries.sh

set -euo pipefail

cd "$(dirname "$0")/.."

OUT="dist-binaries"
rm -rf "$OUT"
mkdir -p "$OUT"

echo "→ tsc"
npm run build

echo "→ pkg (alle 5 Targets)"
BUILD_TYPE=prod npx pkg . \
  --targets node18-macos-arm64,node18-macos-x64,node18-linux-x64,node18-linux-arm64,node18-win-x64 \
  --out-path "$OUT"

# pkg legt Dateien als <packagename>-<os>-<arch> ab. Umbenennen auf das
# vom Install-Script erwartete Schema:
cd "$OUT"
for f in *; do
  case "$f" in
    *-macos-arm64)  mv "$f" "xflow-print-agent-macos-arm64" ;;
    *-macos-x64)    mv "$f" "xflow-print-agent-macos-x64" ;;
    *-linux-x64)    mv "$f" "xflow-print-agent-linux-x64" ;;
    *-linux-arm64)  mv "$f" "xflow-print-agent-linux-arm64" ;;
    *-win-x64.exe)  mv "$f" "xflow-print-agent-win-x64.exe" ;;
    *-win-x64)      mv "$f" "xflow-print-agent-win-x64.exe" ;;
  esac
done

echo
echo "✓ Binaries fertig in $(pwd):"
ls -lh

cat <<'EOF'

→ Auf den Server hochladen (Beispiel-Pfad anpassen):

   scp dist-binaries/* user@deinserver:/var/www/customrflow/agent/bin/

→ Auch die 4 Scripts hochladen:

   scp scripts/install.sh scripts/install.ps1 \
       scripts/uninstall.sh scripts/uninstall.ps1 \
       user@deinserver:/var/www/customrflow/agent/

→ Caddy-Block für Caching + CORS-freie Auslieferung:

   customrflow.com {
     handle_path /agent/* {
       root * /var/www/customrflow/agent
       file_server
       header Cache-Control "public, max-age=300"
     }
   }
EOF

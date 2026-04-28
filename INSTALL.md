# Customrflow Print Agent — Installation

Ein Befehl. Kein Doppelklick-Installer, kein Code-Signing-Theater, keine
Browser-Warnungen. Funktioniert auf macOS, Linux und Windows.

---

## macOS / Linux

```bash
curl -sSL https://app.customrflow.com/agent/install.sh | bash
```

## Windows (PowerShell)

```powershell
iex (irm https://app.customrflow.com/agent/install.ps1)
```

---

Nach der Installation:

- Browser öffnet sich automatisch mit der lokalen Agent-UI
  (`http://localhost:38702/`)
- Auf dem Desktop liegt eine Verknüpfung **„Drucker-Agent öffnen"**
- Im Customrflow-Dashboard unter **Settings → Drucker → Agents** den
  Pairing-Code generieren und in der Agent-UI eingeben

Der Agent startet bei jedem Login automatisch und wird bei einem Crash
innerhalb weniger Sekunden neu gestartet (LaunchAgent / systemd / Task
Scheduler — je nach OS).

---

## Pflege

| Befehl | macOS / Linux | Windows |
|---|---|---|
| **Aktualisieren** | nochmal Install-Befehl ausführen | nochmal Install-Befehl ausführen |
| **Neu starten** | `curl -sSL https://app.customrflow.com/agent/install.sh \| bash -s restart` | `iex (irm https://app.customrflow.com/agent/install.ps1) restart` |
| **Deinstallieren** | `curl -sSL https://app.customrflow.com/agent/uninstall.sh \| bash` | `iex (irm https://app.customrflow.com/agent/uninstall.ps1)` |

---

## Für Entwickler / Hosting

Binaries lokal bauen:

```bash
npm install
./scripts/build-binaries.sh
```

Dann `dist-binaries/*` und `scripts/{install,uninstall}.{sh,ps1}` auf den
eigenen Server unter `/agent/` und `/agent/bin/` hochladen — fertig.

Die Install-Scripts ziehen das Binary von
`https://app.customrflow.com/agent/bin/xflow-print-agent-{os}-{arch}[.exe]`.

Eigene Domain für Tests:

```bash
CUSTOMRFLOW_AGENT_BASE_URL=https://my-server.local/agent \
  bash <(curl -sSL https://my-server.local/agent/install.sh)
```

# @customrflow/print-agent

Cross-platform daemon that connects to the Customrflow SaaS and drives ESC/POS
thermal printers, Star-Line printers, and CUPS-attached printers on a
restaurant's local network.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/docker-ghcr.io-blue)](https://github.com/hqapps777/customrflow-print-agent/pkgs/container/customrflow-print-agent)

---

## For end users — three ways to install

### 1. Docker (recommended for technical customers / IT-Dienstleister)

```bash
docker run -d --name customrflow-print-agent \
  --restart unless-stopped \
  --network host \
  -v customrflow-agent:/data \
  ghcr.io/hqapps777/customrflow-print-agent:latest
```

Then open `http://<host-ip>:38701`, enter the pairing code from the Customrflow
dashboard, scan or add printers, done.

`--network host` is required on Linux for mDNS discovery + LAN printer access.
On Docker Desktop (macOS/Windows) discovery is limited — add printers manually
by IP.

### 2. Native installer (macOS .pkg, Windows .exe)

Download from the GitHub Releases page or directly via the Customrflow dashboard
under **Settings → Drucker & Bons → Agents → Download Agent**.

- **macOS** `.pkg` — signed with Apple Developer ID + notarized; double-click
  to install, no Gatekeeper warning. The agent runs as a LaunchAgent and
  auto-starts on login.
- **Windows** `.exe` — signed via SignPath.io OSS; double-click to install,
  registers as a Windows Service.

### 3. Raspberry Pi pre-flashed image (planned: Customrflow Print Box)

A small turn-key device (Raspberry Pi Zero 2 W or 4) with the agent
pre-installed and configured — for restaurants without an existing PC.

See the in-app setup guides under **Drucker & Bons → Setup-Hilfe** for
step-by-step screenshots per platform.

---

## Architecture

- **Outbound Socket.IO connection** to the Customrflow backend (no inbound
  ports, NAT/firewall friendly). Namespace `/print-agent`, authenticated with
  a per-agent device JWT issued during pairing.
- **Job flow:** Backend emits `job:new`; agent renders the bon-intermediate
  payload to ESC/POS bytes (Epson, Bixolon, …) or Star-Line bytes (Star TSP)
  or CUPS plain-text, sends it to the physical printer, and emits an
  HMAC-signed `job:ack`.
- **Heartbeat** every 30 s with per-printer status (paper low, cover open,
  …) plus the agent's local UI port + hostname, so the dashboard can render
  a clickable link to each agent's UI.
- **Idempotency** cache of the last 100 job IDs prevents double-printing on
  ack-loss + redelivery.
- **Local Web UI** at `http://localhost:38701` (auto-fallback to next free
  port up to +9 if the default is in use) for first-time pairing, printer
  management, mDNS discovery, and on-device test prints.

## Supported printer protocols

- `ESCPOS_TCP` — Epson TM, Bixolon SRP, Citizen CT-S, HPRT, etc.; raw ESC/POS
  bytes over TCP:9100.
- `STAR_LINE_TCP` — Star TSP, mC, BSC series in their native Star-Line mode
  (no need to switch the printer's emulation in DIP switches).
- `CUPS_IPP` — any printer exposed through CUPS (USB thermals, A4 lasers,
  label printers). Requires `lp` available in `$PATH`.

---

## For developers

### Run from source

```bash
cd print-agent
npm install
XFLOW_BACKEND_URL=http://localhost:3001 npm run dev
```

The agent honors `XFLOW_BACKEND_URL` and the `~/.config/xflow-print-agent/config.yaml`
file **only in dev builds** (`BUILD_TYPE` unset or = `dev`). Prod builds lock
the URL to `https://api.customrflow.app`.

### Tests

```bash
npm test
```

Unit tests cover the idempotency cache and CUPS plain-text rendering. Network-
bound tests (TCP, mDNS, Fastify) live under the backend's e2e suite.

### Build a prod release locally

```bash
BUILD_TYPE=prod npm run build
BUILD_TYPE=prod npm run package   # → bin/xflow-print-agent-<platform>
```

The CI release pipeline (`.github/workflows/release.yml`) runs
this automatically when a `print-agent-vX.Y.Z` tag is pushed and additionally
signs/notarizes the macOS `.pkg`, signs the Windows `.exe` via SignPath.io,
and builds + pushes a multi-arch Docker image to GHCR.

### Signing prerequisites

- **macOS:** see [APPLE-SIGNING.md](./APPLE-SIGNING.md) — needs Apple Developer ID
  certificates + an app-specific password as GitHub Secrets.
- **Windows:** see [SIGNPATH.md](./SIGNPATH.md) — free OSS code-signing via
  SignPath.io once the project is approved.

### Persistence

- Config: `$HOME/.config/xflow-print-agent/config.yaml`
- Secrets (device JWT + HMAC secret): OS keychain via `keytar`. If `keytar` is
  not available (some hardened Linux container images), they fall back into
  the YAML file with a warning.

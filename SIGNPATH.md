# SignPath Setup für Customrflow Print Agent

Wir nutzen das **kostenlose OSS-Programm von SignPath.io**, um die Windows-`.exe` mit einem
echten EV-Code-Signing-Zertifikat zu signieren — ohne jährliche Gebühren bei DigiCert/Sectigo.

## Voraussetzungen (einmalig erledigen)

1. **Repository ist Open Source** auf GitHub (MIT-Lizenz, public). ✅ Erledigt durch `LICENSE`.
2. **GitHub-Release-Workflow** liefert ein unsigniertes `.exe` als Artifact. ✅ Erledigt durch
   `.github/workflows/release.yml`.

## Antrag bei SignPath stellen

1. Konto erstellen: https://signpath.io → „Sign up" → mit dem GitHub-Login das `customrflow-print-agent`-Repo verbinden.
2. **OSS-Programm beantragen:** https://signpath.org/documentation/registration-opensource
   - „Project Name": `Customrflow Print Agent`
   - „Repository URL": `https://github.com/hqapps777/customrflow-print-agent`
   - „License": MIT
   - „Description": Cross-platform print agent connecting restaurant printers (ESC/POS,
     Star-Line, CUPS) to the Customrflow SaaS over outbound WebSocket.
3. SignPath prüft das Repo (Lizenz, Build-Reproduzierbarkeit) — Antwort i.d.R. binnen 1–2 Wochen.
4. Nach Freigabe: in SignPath ein **„Project"** anlegen (Slug: `customrflow-print-agent`),
   eine **„Signing Policy"** (Slug: `release-signing`) und eine **„Artifact Configuration"**
   (Slug: `windows-exe`).

## GitHub-Repository-Konfiguration

Sobald SignPath grünes Licht gibt, in den GitHub-Repo-Settings hinterlegen:

**Secrets:**
- `SIGNPATH_API_TOKEN` — wird im SignPath-Profil generiert.

**Variables:**
- `SIGNPATH_ORG_ID` — UUID der SignPath-Organisation, sichtbar im SignPath-Dashboard.

Der Release-Workflow erkennt das Vorhandensein von `SIGNPATH_API_TOKEN` automatisch und
schiebt das Windows-`.exe` durch die SignPath-API. Bevor das Token gesetzt ist, läuft
der Workflow trotzdem durch — die unsignierte `.exe` wird als Fallback-Artefakt
hochgeladen, mit einem deutlichen Hinweis im Release-Body.

## Was Kunden sehen

Vorher (unsigniert): „Windows hat Ihren PC geschützt — Unbekannter Herausgeber" → 2 Klicks.

Nachher (mit SignPath): die `.exe` wird als korrekt signiert akzeptiert. SmartScreen baut
dann ihre Reputation langsam auf (~50 Downloads), bis die Warnung ganz verschwindet.

## Kosten

0 EUR/Monat, dauerhaft, solange das Projekt OSS bleibt.

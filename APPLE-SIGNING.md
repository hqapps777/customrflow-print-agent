# Apple Developer Signing & Notarization für Customrflow Print Agent

Wir nutzen den **bestehenden Apple Developer Account** (für die iOS-App ohnehin notwendig)
um die macOS-`.pkg` zu signieren und durch Apples Notarization-Service zu bringen.

Ergebnis: Kunden öffnen den `.pkg`, Gatekeeper akzeptiert ihn ohne Warnung, Installation
läuft sauber durch.

## Einmalige Vorbereitung im Apple Developer Portal

1. **Zertifikate** unter https://developer.apple.com/account/resources/certificates erstellen:
   - **Developer ID Application** — zum Signieren des Binaries.
   - **Developer ID Installer** — zum Signieren des `.pkg` Installers.
2. Beide Zertifikate als `.p12` exportieren (Passwort vergeben), in **eine** Datei kombinieren
   (Keychain Access → beide markieren → exportieren).
3. **App-Specific Password** für Notarization: https://account.apple.com → Sign-In and Security
   → App-Specific Passwords → „Customrflow Print Agent CI".

## GitHub-Secrets eintragen

In den Repo-Settings (`https://github.com/hqapps777/customrflow-print-agent/settings/secrets/actions`):

| Secret | Wert |
|---|---|
| `APPLE_DEVELOPER_ID_APP` | z.B. `Developer ID Application: Customrflow GmbH (ABC123XYZ4)` |
| `APPLE_DEVELOPER_ID_INST` | z.B. `Developer ID Installer: Customrflow GmbH (ABC123XYZ4)` |
| `APPLE_ID` | Apple-ID-E-Mail (gleiche, mit der die Zertifikate ausgestellt wurden) |
| `APPLE_TEAM_ID` | 10-stellige Team-ID (z.B. `ABC123XYZ4`) |
| `APPLE_APP_PASSWORD` | das App-Specific Password aus Schritt 3 oben |
| `MACOS_CERT_P12_BASE64` | `base64 -i kombiniert.p12` (komplett, eine lange Zeile) |
| `MACOS_CERT_PASSWORD` | das Passwort aus dem `.p12`-Export |

## Wie es im CI läuft

Der Workflow `release.yml` Job `macos-sign`:

1. Lädt die unsignierten `xflow-print-agent-macos-*` aus dem `package`-Job.
2. Importiert die Zertifikate in eine temporäre Keychain auf dem `macos-14`-Runner.
3. `codesign` mit `--options runtime` (Hardened Runtime, Pflicht für Notarization).
4. `pkgbuild` mit `--sign "$APPLE_DEVELOPER_ID_INST"` baut den `.pkg`.
5. `xcrun notarytool submit --wait` schickt den `.pkg` an Apple, wartet auf Approval (~1–2 Min).
6. `xcrun stapler staple` heftet das Notarization-Ticket an den `.pkg`, damit Gatekeeper
   ihn auch offline akzeptiert.

## Lokal manuell testen

```bash
cd print-agent
BUILD_TYPE=prod npm run build && BUILD_TYPE=prod npm run package
codesign --force --options runtime --timestamp \
  --sign "Developer ID Application: Customrflow GmbH (ABC123XYZ4)" \
  bin/xflow-print-agent-macos-arm64
mkdir -p pkgroot/usr/local/bin
cp bin/xflow-print-agent-macos-arm64 pkgroot/usr/local/bin/xflow-print-agent
pkgbuild --root pkgroot --identifier app.customrflow.print-agent --version 0.1.0 \
  --install-location / \
  --sign "Developer ID Installer: Customrflow GmbH (ABC123XYZ4)" \
  CustomrflowPrintAgent-macos-arm64.pkg
xcrun notarytool submit CustomrflowPrintAgent-macos-arm64.pkg \
  --apple-id "you@example.com" --team-id "ABC123XYZ4" --password "abcd-efgh-ijkl-mnop" --wait
xcrun stapler staple CustomrflowPrintAgent-macos-arm64.pkg
```

## Kosten

99 USD/Jahr (Apple Developer Program — fällt sowieso für die iOS-App an).

# Railway: ADMIN_PRIVATE_KEY Setup Anleitung

## Schritt 1: Private Key finden/erstellen

Du benötigst den Private Key der Admin-Adresse, die die Ordinals besitzt.

**WICHTIG:** Die Admin-Adresse muss die Ordinals besitzen, die transferiert werden sollen.

### Option A: Private Key aus Wallet exportieren

1. Öffne dein Bitcoin-Wallet (z.B. Xverse, UniSat, Electrum)
2. Finde die Admin-Adresse (z.B. `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`)
3. Exportiere den Private Key für diese Adresse
   - **WIF-Format** (empfohlen): Beginnt mit `L` oder `K` (Mainnet) oder `c` (Testnet)
   - Beispiel: `L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6`
   - **Hex-Format**: 64 Zeichen Hex-String (z.B. `a1b2c3d4e5f6...`)

### Option B: Private Key aus Mnemonic ableiten

Falls du die Mnemonic-Phrase hast, kannst du den Private Key ableiten (erfordert spezielle Tools).

## Schritt 2: Railway öffnen

1. Gehe zu [railway.app](https://railway.app)
2. Logge dich ein
3. Wähle dein **bitcoin-ordinals-backend** Projekt aus

## Schritt 3: Variables Tab öffnen

1. Klicke auf deinen **Backend Service** (nicht auf das Projekt, sondern auf den Service)
2. Klicke auf den Tab **"Variables"** (oder **"Environment Variables"**)
3. Du siehst jetzt eine Liste aller Environment Variables

## Schritt 4: ADMIN_PRIVATE_KEY hinzufügen

1. Klicke auf **"+ New Variable"** oder **"Add Variable"**
2. **Variable Name:** `ADMIN_PRIVATE_KEY`
3. **Variable Value:** Dein Private Key (WIF oder Hex)
   - Beispiel (WIF): `L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6`
   - Beispiel (Hex): `a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456`
4. Klicke auf **"Add"** oder **"Save"**

**WICHTIG:**
- Der Private Key ist **SEHR SENSIBEL** - teile ihn niemals!
- Stelle sicher, dass du den richtigen Private Key für die Admin-Adresse verwendest
- Für Taproot-Adressen (bc1p...) wird der Private Key normalerweise im WIF-Format benötigt

## Schritt 5: Backend neu deployen

1. Nach dem Hinzufügen der Variable wird Railway automatisch einen neuen Deploy starten
2. Du kannst den Deploy-Status im Tab **"Deployments"** verfolgen
3. Warte, bis der Deploy erfolgreich abgeschlossen ist (grüner Status)

## Schritt 6: Verifizierung

Nach dem Deploy sollte das Backend die `ADMIN_PRIVATE_KEY` erkennen können.

**Prüfe die Logs:**
1. Gehe zum Tab **"Logs"** in Railway
2. Suche nach: `[OrdinalTransfer] Signing PSBT with admin private key...`
3. Wenn du diese Meldung siehst, funktioniert es!

## Troubleshooting

### Fehler: "ADMIN_PRIVATE_KEY not set"
- **Lösung:** Stelle sicher, dass die Variable korrekt benannt ist (`ADMIN_PRIVATE_KEY`)
- Prüfe, ob der Deploy abgeschlossen ist

### Fehler: "Failed to parse admin private key"
- **Lösung:** Prüfe das Format des Private Keys
- WIF-Format sollte 51-52 Zeichen lang sein und mit `L`, `K` oder `c` beginnen
- Hex-Format sollte genau 64 Zeichen lang sein

### Fehler: "Failed to sign input"
- **Lösung:** Der Private Key gehört möglicherweise nicht zur Admin-Adresse
- Prüfe, ob der Private Key zur richtigen Adresse gehört

## Sicherheitshinweise

⚠️ **WICHTIG:**
- Der Private Key gibt **VOLLSTÄNDIGEN ZUGRIFF** auf die Bitcoin-Adresse
- **NIEMALS** den Private Key in Code-Commitments committen
- **NIEMALS** den Private Key in Logs ausgeben
- **NIEMALS** den Private Key teilen
- Verwende Railway's Environment Variables (sicherer als lokale .env-Dateien in Git)

## Alternative: ADMIN_WIF

Falls du `ADMIN_WIF` statt `ADMIN_PRIVATE_KEY` verwenden möchtest:
- Railway erkennt auch `ADMIN_WIF` als Variable
- Beide Variablen funktionieren identisch

## Nächste Schritte

Nach dem Setup:
1. Teste das Minting eines Original-Items
2. Das Backend sollte automatisch die PSBT signieren
3. Der Transfer sollte ohne Frontend-Signing funktionieren

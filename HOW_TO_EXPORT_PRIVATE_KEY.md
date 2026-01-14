# Private Key Export - Anleitung

## WICHTIG: Sicherheitshinweise

⚠️ **Der Private Key gibt VOLLSTÄNDIGEN ZUGRIFF auf deine Bitcoin-Adresse!**
- **NIEMALS** den Private Key teilen
- **NIEMALS** den Private Key in Code-Commitments committen
- **NIEMALS** Screenshots mit Private Key machen
- Nur für die Admin-Adresse verwenden, die die Ordinals besitzt

## Schritt 1: Finde deine Admin-Adresse

Deine Admin-Adresse ist: `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`

Diese Adresse muss die Ordinals besitzen, die transferiert werden sollen.

## Schritt 2: Exportiere Private Key aus deinem Wallet

### Option A: Xverse Wallet

1. **Öffne Xverse Wallet** (Browser Extension oder Mobile App)
2. **Gehe zu Settings** (Einstellungen)
3. **Wähle "Advanced"** oder "Erweitert"
4. **Klicke auf "Export Private Key"** oder "Private Key exportieren"
5. **Wähle die Adresse** `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`
6. **Gib dein Passwort ein** (wenn erforderlich)
7. **Kopiere den Private Key** (beginnt mit `L` oder `K` für Mainnet)

**Format:** WIF (Wallet Import Format) - z.B. `L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6`

### Option B: UniSat Wallet

1. **Öffne UniSat Wallet** (Browser Extension)
2. **Klicke auf das Wallet-Symbol** (oben rechts)
3. **Wähle "Settings"** oder "Einstellungen"
4. **Gehe zu "Advanced"** oder "Erweitert"
5. **Klicke auf "Export Private Key"**
6. **Wähle die Adresse** `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`
7. **Gib dein Passwort ein**
8. **Kopiere den Private Key**

### Option C: Electrum Wallet

1. **Öffne Electrum**
2. **Rechtsklick auf die Adresse** `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`
3. **Wähle "Private Keys" → "Export"**
4. **Gib dein Passwort ein**
5. **Kopiere den Private Key**

### Option D: Hardware Wallet (Ledger, Trezor)

⚠️ **WICHTIG:** Hardware Wallets exportieren KEINE Private Keys direkt!

**Lösung:** Du musst die Private Keys aus dem Seed (Mnemonic) ableiten:
1. Verwende ein Tool wie `bitcoinjs-lib` oder `bip32`
2. Leite den Private Key aus der Mnemonic-Phrase ab
3. **NUR für die spezifische Adresse** `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`

**⚠️ WARNUNG:** Gib deine Mnemonic-Phrase NIEMALS in Online-Tools ein! Verwende nur lokale, vertrauenswürdige Tools.

## Schritt 3: Prüfe das Format

Der Private Key sollte:
- **WIF-Format:** 51-52 Zeichen, beginnt mit `L`, `K` oder `c` (Mainnet)
- **Hex-Format:** 64 Zeichen, nur Hex-Zeichen (0-9, a-f)

**Beispiele:**
- WIF: `L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6`
- Hex: `a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456`

## Schritt 4: Setze in Railway

1. Gehe zu [railway.app](https://railway.app)
2. Wähle dein **bitcoin-ordinals-backend** Projekt
3. Klicke auf den **Backend Service**
4. Gehe zum Tab **"Variables"**
5. Klicke auf **"+ New Variable"**
6. **Name:** `ADMIN_PRIVATE_KEY`
7. **Value:** Dein Private Key (WIF oder Hex)
8. Klicke auf **"Add"**
9. **Redeploy** das Backend

## Schritt 5: Testen

Nach dem Deploy:
1. Versuche, ein Original-Item zu minten
2. Der Transfer sollte **sofort** erfolgen (keine Wartezeit)
3. Prüfe die Logs in Railway - sollte zeigen: `[Collections] ✅ Original ordinal ... transferred ... (INSTANT - auto-signed)`

## Troubleshooting

### "ADMIN_PRIVATE_KEY not set"
- Prüfe, ob die Variable in Railway gesetzt ist
- Prüfe, ob der Deploy abgeschlossen ist
- Prüfe die Logs in Railway

### "Failed to parse admin private key"
- Prüfe das Format (WIF oder Hex)
- WIF sollte 51-52 Zeichen lang sein
- Hex sollte genau 64 Zeichen lang sein

### "Failed to sign input"
- Der Private Key gehört möglicherweise nicht zur Admin-Adresse
- Prüfe, ob der Private Key zur Adresse `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9` gehört

## Alternative: Private Key aus Mnemonic ableiten

Falls du nur die Mnemonic-Phrase hast:

1. Verwende ein lokales Tool (z.B. `bitcoinjs-lib` in Node.js)
2. Leite den Private Key für die spezifische Adresse ab
3. **WICHTIG:** Verwende nur lokale, vertrauenswürdige Tools!

**Beispiel-Code (lokal ausführen, NICHT online):**
```javascript
const bitcoin = require('bitcoinjs-lib');
const bip39 = require('bip39');

// Mnemonic-Phrase
const mnemonic = 'deine mnemonic phrase hier';

// Leite Private Key ab
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bitcoin.bip32.fromSeed(seed);
const keyPair = root.derivePath("m/84'/0'/0'/0/0"); // Standard BIP84 Pfad
const privateKey = keyPair.toWIF();

console.log('Private Key:', privateKey);
```

## Sicherheitstipps

1. **Verwende eine separate Wallet** nur für Admin-Transfers
2. **Halte nur das Minimum** an Bitcoin in dieser Wallet
3. **Überwache die Wallet** regelmäßig
4. **Backup** den Private Key sicher (verschlüsselt)
5. **Roteploy** das Backend nach dem Setzen der Variable

# Private Key aus Mnemonic ableiten - Anleitung

## Wenn dein Wallet keinen "Export Private Key" hat

Viele moderne Wallets (besonders für Taproot) zeigen keine Export-Funktion. Du kannst den Private Key aber aus deiner **Mnemonic-Phrase** ableiten.

## Schritt 1: Finde deine Mnemonic-Phrase

Die Mnemonic-Phrase ist die **12 oder 24 Wörter**, die du beim Erstellen deines Wallets bekommen hast.

**Beispiel:** `word1 word2 word3 ... word12`

⚠️ **WICHTIG:** 
- Die Mnemonic-Phrase gibt Zugriff auf ALLE Adressen in deinem Wallet!
- Gib sie NIEMALS in Online-Tools ein!
- Verwende nur lokale, vertrauenswürdige Tools!

## Schritt 2: Verwende das lokale Tool

Ich habe ein Tool erstellt, das den Private Key aus deiner Mnemonic ableitet.

### Installation (falls noch nicht geschehen):

```bash
cd bitcoin-ordinals-backend
npm install
```

### Verwendung:

```bash
node derive-private-key.js "deine mnemonic phrase hier" "bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9"
```

**Beispiel:**
```bash
node derive-private-key.js "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12" "bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9"
```

### Was das Tool macht:

1. Validiert deine Mnemonic-Phrase
2. Prüft verschiedene Derivation-Pfade (BIP86, BIP84, etc.)
3. Findet die Adresse `bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9`
4. Gibt den Private Key aus (WIF-Format)

### Output:

```
✅ ADRESSE GEFUNDEN!
═══════════════════════════════════════════════════════
📍 Adresse: bc1p8hfflnq8dspvpeqdprqkncdfnk4hl5ne0ydnlslj2sk49fu5jxns2xxmk9
🔑 Private Key (WIF): L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6
🔑 Private Key (Hex): a1b2c3d4e5f6...
📋 Derivation-Pfad: m/86'/0'/0'/0/0
═══════════════════════════════════════════════════════
```

## Schritt 3: Kopiere den Private Key

Kopiere den **Private Key (WIF)** - das ist der, der mit `L` oder `K` beginnt.

## Schritt 4: Setze in Railway

1. Gehe zu [railway.app](https://railway.app)
2. Wähle dein **bitcoin-ordinals-backend** Projekt
3. Klicke auf den **Backend Service**
4. Gehe zum Tab **"Variables"**
5. Klicke auf **"+ New Variable"**
6. **Name:** `ADMIN_PRIVATE_KEY`
7. **Value:** Dein Private Key (WIF-Format, z.B. `L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6`)
8. Klicke auf **"Add"**
9. **Redeploy** das Backend

## Schritt 5: Testen

Nach dem Deploy sollte der Transfer sofort funktionieren!

## Sicherheit

✅ **SICHER:**
- Tool läuft lokal auf deinem Computer
- Mnemonic-Phrase verlässt deinen Computer nicht
- Private Key wird nur in Railway gesetzt (verschlüsselt)

❌ **NICHT SICHER:**
- Mnemonic-Phrase in Online-Tools eingeben
- Private Key in Code committen
- Private Key teilen

## Troubleshooting

### "Ungültige Mnemonic-Phrase"
- Prüfe, ob alle Wörter korrekt sind
- Prüfe, ob es 12 oder 24 Wörter sind
- Prüfe die Rechtschreibung

### "Adresse nicht gefunden"
- Das Tool prüft verschiedene Derivation-Pfade
- Wenn die Adresse nicht gefunden wird, könnte sie einen anderen Pfad verwenden
- Kontaktiere mich, dann erweitere ich das Tool

### "Module not found"
- Führe `npm install` im `bitcoin-ordinals-backend` Verzeichnis aus

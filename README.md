# Bitcoin Ordinals Backend

Backend API für die BLACK & WILD Ordinals Minting-Seite.

## Setup

1. **Dependencies installieren:**
```bash
npm install
```

2. **Environment Variables konfigurieren:**

Kopiere `.env.example` zu `.env` und fülle die Werte aus:

```bash
cp .env.example .env
```

Bearbeite `.env`:
```env
# UniSat OpenAPI Konfiguration
UNISAT_API_KEY=your_unisat_api_key_here
UNISAT_API_URL=https://open-api.unisat.io

# Falls Mock-Modus verwendet werden soll (für Testing ohne API Key)
USE_MOCK_INSCRIPTIONS=false

# Admin Wallet Adressen (komma-separiert)
ADMIN_ADDRESSES=bc1pk04c62dkcev08jvmhlecufxtp4xw4af0s9n3vtm8w3dsn9985dhsvpralc,34VvkvWnRw2GVgEQaQZ6fykKbebBHiT4ft

# Admin Wallet privater Key (für Original-Ordinal Transfers im Point Shop)
# Format: WIF (Wallet Import Format) z.B. "L5EZftvrYaSudiozVRzTqLcHLNDoVn7H5HSfM9BAN6tMJX8oTWz6"
# ODER Hex-Format (64 Zeichen) z.B. "a1b2c3d4e5f6..."
# WICHTIG: Nur für Taproot-Adressen (bc1p...) die Original-Ordinals besitzen!
ADMIN_PRIVATE_KEY=your_admin_wif_or_hex_here
# Alternative: ADMIN_WIF (wird verwendet falls ADMIN_PRIVATE_KEY nicht gesetzt)
# ADMIN_WIF=your_admin_wif_here

# Bitcoin Network (mainnet oder testnet)
BITCOIN_NETWORK=mainnet
```

### UniSat API Key erhalten

1. Gehe zu https://unisat.io/developer
2. Erstelle einen Account
3. Generiere einen API Key
4. Kopiere den API Key in `.env` als `UNISAT_API_KEY`

**Wichtig:** 
- Ohne API Key läuft der Server im Mock-Modus (nur für Testing!)
- Für echte Inskriptionen ist ein gültiger UniSat API Key erforderlich

## Server starten

```bash
# Development (mit Auto-Reload)
npm run dev

# Production
npm start
```

Der Server läuft standardmäßig auf `http://localhost:3002`

## API Endpunkte

### Öffentliche Endpunkte

- `GET /api/health` - Health Check
- `GET /api/packs/availability` - Verfügbarkeit aller Packs
- `GET /api/packs/:packId/availability` - Verfügbarkeit eines spezifischen Packs
- `POST /api/packs/:packId/increment` - Pack-Zähler inkrementieren
- `POST /api/unisat/inscribe` - Inskription erstellen
- `POST /api/minting/log` - Minting-Log speichern
- `GET /api/minting/logs/:walletAddress` - Minting-Logs für eine Wallet
- `GET /api/minting/recent` - Letzte gemintete Karten

### Admin Endpunkte (benötigen Admin-Adresse)

- `GET /api/collection/hashlist` - Komplette Hashliste aller Inskriptionen
- `GET /api/collection/stats` - Collection Statistiken

**Admin-Header:** `X-Admin-Address: <deine-admin-wallet-adresse>`

## Logs

Alle Logs werden in `logs/` gespeichert:
- `minting.log` - Alle Minting-Aktivitäten
- `inscriptions.log` - Alle Inskription-Erstellungen
- `admin-actions.log` - Admin-Zugriffe und Aktionen

## Pack Supply

Die Pack-Verfügbarkeit wird in `packSupply.json` gespeichert und beim Start geladen.

## Troubleshooting

### Port bereits belegt
Falls Port 3002 bereits belegt ist, ändere `PORT` in `server.js` oder beende den anderen Prozess.

### Mock-Modus
Falls der Server im Mock-Modus läuft (siehe Console-Output), prüfe:
1. Ist `UNISAT_API_KEY` in `.env` gesetzt?
2. Ist `USE_MOCK_INSCRIPTIONS=false` in `.env`?

### UniSat API Fehler
Falls Inskriptionen fehlschlagen:
1. Prüfe ob der API Key gültig ist
2. Prüfe ob das API Quota/Limits überschritten wurde
3. Prüfe die Logs in `logs/inscriptions.log`








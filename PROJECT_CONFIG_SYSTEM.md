# 🎯 PROJECT CONFIG SYSTEM - Dokumentation

## Übersicht

Das neue **Project Config System** verhindert Daten-Korruption durch **strikte Validierung** von `originalInscriptionId` gegen Projekt-Konfigurationen.

## 📁 Struktur

```
bitcoin-ordinals-backend/
├── config/
│   └── projects/
│       ├── index.js              # Central Hub mit Validierungs-Helpers
│       ├── black-and-wild.js     # Black & Wild Projekt-Config
│       └── tech-and-games.js     # Tech & Games Projekt-Config
├── services/
│   ├── validationService.js      # Validierungs-Logic
│   └── mintedCardsService.js     # ✅ MIT VALIDIERUNG
├── scripts/
│   ├── add-project-id-to-db.js   # Migration: project_id Spalten hinzufügen
│   └── cleanup-corrupted-data.js # Cleanup: Fehlerhafte Daten entfernen
```

## 🚀 Deployment-Schritte

### 1. Backend Deployment (Railway)

```bash
cd bitcoin-ordinals-backend
git add .
git commit -m "feat: Project Config System + Validation"
git push
```

**Railway deployed automatisch!** ✅

### 2. DB Migration (Automatisch beim Start)

Die Migration läuft **automatisch** beim Server-Start:
- ✅ Fügt `project_id` Spalte zu `minted_cards` hinzu
- ✅ Fügt `project_id` Spalte zu `collections` hinzu

### 3. Daten-Cleanup (MANUELL erforderlich!)

⚠️ **WICHTIG**: Bereinige fehlerhafte Daten VOR dem ersten echten Mint!

```bash
# 1. Analysiere fehlerhafte Daten
node scripts/cleanup-corrupted-data.js analyze

# 2. Zeige alle Karten mit ihren originalInscriptionIds
node scripts/cleanup-corrupted-data.js show-all

# 3. Dry-Run (zeigt was gelöscht würde)
node scripts/cleanup-corrupted-data.js delete-dry-run

# 4. ECHTES LÖSCHEN (⚠️ VORSICHT!)
node scripts/cleanup-corrupted-data.js delete
```

### 4. Frontend Deployment (Vercel)

```bash
cd bitcoin-ordinals-minting
npm run build
git add .
git commit -m "feat: Project-basierter Gallery Filter"
git push
```

**Vercel deployed automatisch!** ✅

## 🔍 Wie es funktioniert

### Beim Minting (Backend)

```javascript
// services/mintedCardsService.js
export async function saveMintedCard(cardData) {
  // 💣 KRITISCHE VALIDIERUNG
  if (cardData.originalInscriptionId && cardData.cardName) {
    const validation = validationService.validateDelegateCard({
      cardName: cardData.cardName,
      originalInscriptionId: cardData.originalInscriptionId,
      projectId: cardData.projectId
    });
    
    if (!validation.valid) {
      throw new Error(`Validation failed: ${validation.error}`);
    }
    
    // Auto-detect projectId
    if (!cardData.projectId && validation.projectId) {
      cardData.projectId = validation.projectId;
    }
  }
  
  // Speichern mit project_id
  // ...
}
```

### Im Frontend (Gallery)

```typescript
// services/gallery.ts
const BLACK_WILD_ORIGINALS = [
  '5e6f59c6e871f5ccf7ccc09e3e8ae73ac2e63c78a64e66a3ca9a5c8f7e5d35b6i0', // Bär
  'e6805a3c68fd1abb1904dfb8193b2a01ef2ccbd96d6b8be2c4b9aba4332c413di0', // Wolf
  // ... alle Black & Wild IDs
];

const cards = delegates.filter(delegate => {
  return delegate.originalInscriptionId && 
         BLACK_WILD_ORIGINALS.includes(delegate.originalInscriptionId);
});
```

## ⚠️ WICHTIGE HINWEISE

### Tech & Games IDs fehlen!

Die `tech-and-games.js` Config enthält **PLACEHOLDER IDs**:

```javascript
{
  id: 'blocktris',
  name: 'BLOCKTRIS',
  inscriptionId: 'PLACEHOLDER_BLOCKTRIS_NEEDS_REAL_ID', // ❌ MUSS ERSETZT WERDEN
}
```

**TODO:**
1. Recherchiere echte Inscription IDs für BLOCKTRIS und TimeBIT
2. Ersetze PLACEHOLDER in `config/projects/tech-and-games.js`
3. Re-deploy Backend

### Fehlerhafte Daten in DB

**Aktuell in DB:**
- BLOCKTRIS mit Wolf-ID (e6805a3c...)
- TimeBIT mit Eule-ID (5be3dfb1...)

**Lösung:**
```bash
node scripts/cleanup-corrupted-data.js delete
```

## 🎯 Neue Projekte hinzufügen

1. **Erstelle neue Config:**
```javascript
// config/projects/my-new-project.js
export const MY_NEW_PROJECT_CONFIG = {
  projectId: 'my-new-project',
  projectName: 'My New Project',
  originals: [
    {
      id: 'card1',
      name: 'Card 1',
      inscriptionId: 'abc123...i0',
      cardType: 'animal',
      rarity: 'rare'
    }
  ]
};
```

2. **Registriere in index.js:**
```javascript
// config/projects/index.js
import { MY_NEW_PROJECT_CONFIG } from './my-new-project.js';

export const PROJECT_CONFIGS = {
  'black-and-wild': BLACK_AND_WILD_CONFIG,
  'tech-and-games': TECH_AND_GAMES_CONFIG,
  'my-new-project': MY_NEW_PROJECT_CONFIG // ✅ NEU
};
```

3. **Update Frontend Filter (optional):**
```typescript
// Wenn Gallery nur bestimmte Projekte zeigen soll
const ALLOWED_PROJECTS = ['black-and-wild', 'my-new-project'];
```

## 📊 Validierungs-Beispiele

### ✅ GÜLTIG
```javascript
{
  cardName: 'Wolf',
  originalInscriptionId: 'e6805a3c68fd1abb1904dfb8193b2a01ef2ccbd96d6b8be2c4b9aba4332c413di0',
  projectId: 'black-and-wild'
}
// ✅ Wolf gehört zu Black & Wild
```

### ❌ UNGÜLTIG
```javascript
{
  cardName: 'BLOCKTRIS',
  originalInscriptionId: 'e6805a3c68fd1abb1904dfb8193b2a01ef2ccbd96d6b8be2c4b9aba4332c413di0',
  projectId: 'tech-and-games'
}
// ❌ Diese ID gehört zu Wolf (Black & Wild), nicht zu BLOCKTRIS!
```

## 🛠️ Troubleshooting

### Problem: Validation Error beim Minting

**Fehler:**
```
Validation failed: originalInscriptionId e6805a3c... belongs to project "Black & Wild", not "Tech & Games"
```

**Lösung:**
1. Prüfe `config/projects/` Configs
2. Stelle sicher, dass `originalInscriptionId` korrekt ist
3. Prüfe ob `cardName` zur `originalInscriptionId` passt

### Problem: Gallery zeigt keine Karten

**Ursache:** Filter zu strikt oder IDs fehlen in Config

**Lösung:**
1. Prüfe Browser Console für Filter-Logs
2. Vergleiche `originalInscriptionId` mit Config
3. Füge fehlende IDs zur Config hinzu

## 📈 Statistiken

```javascript
import projectConfig from './config/projects/index.js';

const stats = projectConfig.getProjectStats();
console.log(stats);

// Output:
// {
//   'black-and-wild': {
//     projectName: 'Black & Wild',
//     totalOriginals: 45,
//     byCategory: { tier: 22, action: 12, status: 8 },
//     byRarity: { legendary: 1, epic: 1, rare: 5, ... },
//     hasMissingIds: false
//   },
//   'tech-and-games': {
//     projectName: 'Tech & Games',
//     totalOriginals: 7,
//     hasMissingIds: true // ⚠️ PLACEHOLDER IDs!
//   }
// }
```

## ✅ Checkliste vor Production

- [ ] Alle PLACEHOLDER IDs in `tech-and-games.js` ersetzt
- [ ] `cleanup-corrupted-data.js` ausgeführt
- [ ] DB Migration erfolgreich (project_id Spalten existieren)
- [ ] Backend deployed und läuft
- [ ] Frontend deployed und läuft
- [ ] Gallery zeigt nur Black & Wild Karten
- [ ] Neues Minting validiert korrekt
- [ ] Keine Validation Errors in Logs

## 🎉 Fertig!

Das System ist jetzt **BOMBENSICHER** 💣 und verhindert Daten-Korruption durch strikte Validierung!

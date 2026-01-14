# 🗄️ Railway PostgreSQL Setup - Schritt für Schritt

## ⚠️ WICHTIG: Ohne DATABASE_URL gehen Collections bei jedem Deploy verloren!

Railway hat ein **ephemerales Filesystem** - das bedeutet, dass alle Dateien im `/data` Verzeichnis bei jedem Deploy gelöscht werden. Daher MUSS PostgreSQL eingerichtet werden!

---

## 📋 Schritt-für-Schritt Anleitung

### Schritt 1: PostgreSQL-Datenbank hinzufügen

1. **Gehe zu deinem Railway-Projekt**: https://railway.app
2. **Klicke auf "+ New"** (oben rechts)
3. **Wähle "Database"** aus dem Dropdown
4. **Klicke auf "Add PostgreSQL"**
5. Railway erstellt automatisch eine PostgreSQL-Datenbank für dich

### Schritt 2: DATABASE_URL Environment Variable prüfen/setzen

**Option A: Automatisch (Railway setzt sie normalerweise automatisch)**

1. Gehe zu deinem **Backend-Service** (nicht die PostgreSQL-Datenbank, sondern dein Node.js Service)
2. Klicke auf den **"Variables"** Tab
3. Prüfe, ob `DATABASE_URL` bereits vorhanden ist
4. Falls JA → Fertig! Railway hat sie automatisch gesetzt
5. Falls NEIN → weiter zu Option B

**Option B: Manuell setzen**

1. Gehe zu deiner **PostgreSQL-Datenbank** (nicht dein Backend-Service)
2. Klicke auf den **"Connect"** Tab
3. Kopiere die **"Postgres Connection URL"** (sieht aus wie: `postgresql://postgres:password@host:port/railway`)
4. Gehe zurück zu deinem **Backend-Service**
5. Klicke auf **"Variables"** Tab
6. Klicke auf **"+ New Variable"**
7. Name: `DATABASE_URL`
8. Value: Füge die kopierte Connection URL ein
9. Klicke auf **"Add"**

### Schritt 3: Service neu deployen

1. Railway erkennt die neue Environment Variable automatisch
2. Oder: Klicke auf **"Deploy"** → **"Redeploy"** in deinem Backend-Service

### Schritt 4: Logs prüfen

Nach dem Deploy solltest du in den Logs sehen:

```
✅ PostgreSQL verbunden: 2025-01-12 14:00:00
✅ Tabellen erstellt/überprüft
[CollectionService] 🔄 Starting collections migration from JSON to PostgreSQL...
[CollectionService] ✅ Migrated X collections to PostgreSQL
💾 Datenbank: ✅ PostgreSQL
```

**NICHT mehr:**
```
⚠️ DATABASE_URL nicht gesetzt - verwende JSON-Fallback
⚠️ Keine Datenbankverbindung - verwende JSON-Fallback
```

---

## 🔍 Verifizierung

### Test 1: Prüfe ob DATABASE_URL gesetzt ist

In den Railway-Logs solltest du sehen:
```
[DB] ✅ PostgreSQL verbunden
💾 Datenbank: ✅ PostgreSQL
```

### Test 2: Erstelle eine Test-Collection

1. Gehe zum Admin Panel
2. Erstelle eine neue Collection
3. Prüfe die Logs - sollte zeigen:
   ```
   [CollectionService] ✅ Collection saved to PostgreSQL: collection-xxx
   [CollectionService] ✅ Collection saved to JSON: collection-xxx
   ```

### Test 3: Redeploy und prüfe

1. Redeploy deinen Service
2. Prüfe ob die Collection noch vorhanden ist
3. Falls JA → ✅ Funktioniert!
4. Falls NEIN → DATABASE_URL ist nicht korrekt gesetzt

---

## 🆘 Troubleshooting

### Problem: "DATABASE_URL nicht gesetzt" in Logs

**Lösung:**
1. Prüfe ob PostgreSQL-Datenbank existiert
2. Prüfe ob `DATABASE_URL` in Variables vorhanden ist
3. Prüfe ob der Wert korrekt ist (sollte mit `postgresql://` beginnen)
4. Redeploy den Service

### Problem: "Connection refused" oder "Connection timeout"

**Lösung:**
1. Prüfe ob PostgreSQL-Datenbank läuft (Status sollte "Active" sein)
2. Prüfe ob `DATABASE_URL` korrekt ist
3. Prüfe ob die Datenbank im gleichen Railway-Projekt ist

### Problem: Collections verschwinden nach Deploy

**Lösung:**
1. Prüfe ob `DATABASE_URL` gesetzt ist
2. Prüfe ob Migration erfolgreich war (siehe Logs)
3. Prüfe ob Collections in PostgreSQL gespeichert wurden (nicht nur JSON)

---

## 📊 Was passiert nach dem Setup?

1. **Automatische Migration**: Bestehende JSON-Collections werden automatisch zu PostgreSQL migriert
2. **Dual-Write**: Neue Collections werden in PostgreSQL UND JSON gespeichert (maximale Sicherheit)
3. **Persistenz**: Collections überleben Deploys, da sie in PostgreSQL gespeichert sind
4. **Fallback**: Falls PostgreSQL ausfällt, wird automatisch JSON verwendet

---

## ✅ Checkliste

- [ ] PostgreSQL-Datenbank auf Railway hinzugefügt
- [ ] `DATABASE_URL` Environment Variable gesetzt (automatisch oder manuell)
- [ ] Service neu deployed
- [ ] Logs zeigen "✅ PostgreSQL" (nicht "⚠️ JSON-Fallback")
- [ ] Test-Collection erstellt
- [ ] Nach Redeploy ist Collection noch vorhanden

---

## 🎯 Ergebnis

Nach erfolgreichem Setup:
- ✅ Collections werden in PostgreSQL gespeichert
- ✅ Collections überleben Deploys
- ✅ Keine Datenverluste mehr
- ✅ Dual-Write für maximale Sicherheit

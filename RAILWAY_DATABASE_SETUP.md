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

**Option B: Manuell setzen (wenn Railway es nicht automatisch gemacht hat)**

**Teil 1: Connection URL von PostgreSQL kopieren**

1. **Gehe zu deiner PostgreSQL-Datenbank**
   - In deinem Railway-Projekt siehst du jetzt zwei Services:
     - Dein Backend-Service (z.B. "bitcoin-ordinals-backend")
     - Die PostgreSQL-Datenbank (z.B. "Postgres" oder "PostgreSQL")
   - **Klicke auf die PostgreSQL-Datenbank** (nicht auf dein Backend-Service!)

2. **Öffne den "Connect" Tab**
   - Oben siehst du mehrere Tabs: "Deployments", "Metrics", "Connect", etc.
   - **Klicke auf "Connect"**

3. **Kopiere die Connection URL**
   - Im "Connect" Tab siehst du mehrere Verbindungsoptionen
   - Suche nach **"Postgres Connection URL"** oder **"Connection String"**
   - Die URL sieht ungefähr so aus:
     ```
     postgresql://postgres:DEIN_PASSWORT@containers-us-west-XXX.railway.app:XXXX/railway
     ```
   - **Klicke auf das Kopier-Symbol** (📋) oder markiere die gesamte URL und kopiere sie (Strg+C)

**Teil 2: DATABASE_URL in deinem Backend-Service setzen**

4. **Gehe zurück zu deinem Backend-Service**
   - Klicke auf dein Backend-Service (z.B. "bitcoin-ordinals-backend")
   - **NICHT** auf die PostgreSQL-Datenbank!

5. **Öffne den "Variables" Tab**
   - Oben siehst du Tabs: "Deployments", "Metrics", "Variables", etc.
   - **Klicke auf "Variables"**

6. **Erstelle neue Environment Variable**
   - Klicke auf den Button **"+ New Variable"** (oben rechts oder in der Liste)
   - Ein Dialog öffnet sich

7. **Fülle die Felder aus:**
   - **Name (Key)**: `DATABASE_URL`
     - WICHTIG: Genau so schreiben, Großbuchstaben beachten!
   - **Value**: Füge die kopierte Connection URL ein
     - Einfach Strg+V drücken oder Rechtsklick → Einfügen
     - Die URL sollte mit `postgresql://` beginnen

8. **Speichern**
   - Klicke auf **"Add"** oder **"Save"**
   - Die Variable erscheint jetzt in der Liste

**Teil 3: Verifizierung**

9. **Prüfe ob DATABASE_URL gesetzt ist**
   - In der Variables-Liste solltest du jetzt `DATABASE_URL` sehen
   - Der Wert sollte mit `postgresql://` beginnen
   - Falls du einen Fehler siehst, prüfe:
     - Ist der Name genau `DATABASE_URL`? (Großbuchstaben!)
     - Beginnt der Value mit `postgresql://`?
     - Ist die URL vollständig kopiert? (sollte nicht abgeschnitten sein)

**WICHTIG: Unterschied zwischen den beiden Services**

- **PostgreSQL-Datenbank**: Hier kopierst du die Connection URL
- **Backend-Service**: Hier fügst du die `DATABASE_URL` Variable ein

**Tipp:** Falls du unsicher bist, welcher Service welcher ist:
- PostgreSQL hat normalerweise ein Datenbank-Icon (🗄️)
- Dein Backend-Service hat normalerweise ein Code/Server-Icon (⚙️)

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

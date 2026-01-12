# PostgreSQL Datenbank Setup für Point Shop

## 🎯 Übersicht

Der Point Shop verwendet jetzt **PostgreSQL** für persistente Speicherung. Dies garantiert:
- ✅ **Keine Datenverluste** bei Neustarts/Deployments
- ✅ **Transaktionen** für Datenintegrität
- ✅ **Automatische Migration** von JSON zu DB
- ✅ **Fallback zu JSON** falls DB nicht verfügbar

## 📋 Railway Setup

### 1. PostgreSQL-Datenbank hinzufügen

1. Gehe zu deinem Railway-Projekt
2. Klicke auf **"+ New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway erstellt automatisch eine PostgreSQL-Datenbank

### 2. DATABASE_URL Environment Variable

Railway setzt automatisch die `DATABASE_URL` Environment Variable. Prüfe:
1. Gehe zu deinem **Service** (nicht die DB, sondern dein Backend-Service)
2. Klicke auf **"Variables"** Tab
3. Stelle sicher, dass `DATABASE_URL` vorhanden ist (Railway setzt sie automatisch)

Falls nicht vorhanden:
- Gehe zur PostgreSQL-Datenbank
- Klicke auf **"Connect"** Tab
- Kopiere die **"Postgres Connection URL"**
- Füge sie als `DATABASE_URL` in deinem Service hinzu

### 3. Deployment

Nach dem Deployment:
- Die Datenbank wird automatisch initialisiert
- Tabellen werden erstellt
- Bestehende JSON-Daten werden automatisch migriert

## 🔍 Verifizierung

Nach dem Start siehst du in den Logs:
```
[DB] ✅ PostgreSQL verbunden: 2025-01-12 14:00:00
[DB] ✅ Tabellen erstellt/überprüft
[PointShop] 🔄 Migration: Migriere X Items von JSON zu DB...
[PointShop] ✅ Migration: X Items erfolgreich migriert
💾 Datenbank: ✅ PostgreSQL
```

## ⚠️ Fallback

Falls `DATABASE_URL` nicht gesetzt ist:
- System verwendet automatisch JSON-Fallback
- Alle Funktionen funktionieren weiterhin
- Logs zeigen: `⚠️ Keine Datenbankverbindung - verwende JSON-Fallback`

## 🔒 Sicherheit

- ✅ Transaktionen für kritische Operationen
- ✅ Prepared Statements (SQL Injection Schutz)
- ✅ Automatische Fehlerbehandlung
- ✅ Rollback bei Fehlern

## 📊 Datenstruktur

Die Tabelle `point_shop_items` speichert:
- Basis-Informationen (id, title, description, pointsCost, active)
- Typ-spezifische Felder (delegate_inscription_id, original_inscription_id)
- Series-Felder (inscription_ids, current_index, total_count)
- Timestamps (created_at, updated_at)

## 🚀 Nächste Schritte

1. **PostgreSQL auf Railway hinzufügen** (siehe oben)
2. **Deployment durchführen** (Railway erkennt Änderungen automatisch)
3. **Logs prüfen** (sollte "✅ PostgreSQL" zeigen)
4. **Testen**: Neue Items im Admin-Panel hinzufügen
5. **Verifizieren**: Nach Neustart sollten Items noch vorhanden sein

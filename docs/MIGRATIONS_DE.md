# Datenbank (Supabase) – Aufbau, Historie und automatische Updates

Diese Anleitung ist für Einsteiger. Sie erklärt, wie die APEX-Datenbank aufgebaut ist, was am 1.11.2026 repariert
wurde und wie Datenbank-Änderungen in Zukunft **automatisch** beim Mergen auf GitHub eingespielt werden.

> **Grundregeln**
> - Datenbank-Änderungen nie mehr von Hand im SQL Editor, sondern nur als Datei in `supabase/migrations/`.
> - Keine Passwörter, Schlüssel oder E-Mail-Adressen in Dateien auf GitHub (das Repository ist **öffentlich**).
> - Nichts zurücksetzen („Reset database“), keine Historie-Einträge löschen ohne geprüften Plan.

---

## 1. Was war kaputt?

| Problem | Folge |
|---|---|
| Die erste Migration `20261101094428_apex_initial_account_allowlist` wurde direkt in Supabase ausgeführt, ihr SQL lag nie auf GitHub (und enthielt E-Mail-Adressen). | Supabase meldete bei jedem Deploy „Remote migration versions not found in local migrations directory“; der Branch `main` stand auf **MIGRATIONS_FAILED**. |
| Die vier APEX-Migrationen aus GitHub wurden deshalb **nie** eingespielt. | In der Live-Datenbank gab es keine Kampagne, keine Profile, keinen Spielstand – nur die alten Tabellen `apex_access`/`apex_invites`. |
| Die alte Lösung hatte einen **Trigger auf `auth.users`**, der bei jeder Anmeldung lief. | Unnötiges Risiko für die Anmeldung; nicht mehr gebraucht. |

---

## 2. Was am 1.11.2026 gemacht wurde (mit deiner Freigabe)

1. **Sicherung** in das nicht öffentliche Schema `apex_backup_20261101`: alte Tabellen, alter Historie-Eintrag inkl.
   Original-SQL, Definitionen von Funktion, Trigger und Policy. Inhalt geprüft (identisch).
2. **Historie repariert** – wie `supabase migration repair 20261101094428 --status reverted`: nur der Eintrag in der
   Historie wurde entfernt.
3. **Neue Basis** `20261101145653_apex_baseline.sql` über die offizielle Supabase-Migrations-Schnittstelle eingespielt.
   Sie entfernt die alten Objekte (Tabellen, Funktion, Trigger auf `auth.users`) und legt das komplette APEX-Schema an.
   Die Datei im Repository ist **identisch** mit dem, was eingespielt wurde.
4. **Daten übernommen** (aus der Sicherung, nicht aus dem Code): GM-Einladung, Profile Hannah und Jean mit ihren
   E-Mail-Adressen verknüpft. Simon und Jerba bleiben inaktiv.
5. **Geprüft**: alle Tabellen mit RLS, Browser haben keine Schreib- und kaum Leserechte, 16 verbotene Zugriffe wurden
   in der echten Datenbank abgewiesen, die 3 bestehenden Konten (`auth.users`) sind unverändert.

**Rückweg** (falls je nötig): Historie-Eintrag und alte Tabellen lassen sich aus `apex_backup_20261101` wiederherstellen.
Die Sicherung kann gelöscht werden, sobald APEX ein paar Wochen stabil läuft (`drop schema apex_backup_20261101 cascade;`).

---

## 3. Aufbau der Datenbank (Schema-Version 1)

| Tabelle | Zweck | Browser-Zugriff |
|---|---|---|
| `apex_schema_info` | Schema-Version (Code und Datenbank müssen zusammenpassen) | keiner |
| `apex_campaigns` | Kampagne „APEX – Arena of the Eternal Will“ | keiner |
| `apex_profiles` | GM, Hannah, Jean, Simon, Jerba – mit verknüpfter E-Mail | keiner |
| `apex_campaign_invites` | Einladungen (z. B. GM) | keiner |
| `apex_campaign_members` | wer Mitglied ist, Rolle, „zuletzt online“ | nur eigene Zeile lesen |
| `apex_character_assignments` | welches Konto welche Figur steuert | keiner |
| `apex_game_states` | **der eine gemeinsame Spielstand** (mit Versionsnummer) | keiner |
| `apex_campaign_heads` | Versionszähler für Live-Updates (Realtime) | nur eigene Kampagne lesen |
| `apex_state_snapshots` | Sicherungen (automatisch bei jedem Tagesanbruch) | keiner |
| `apex_command_log` | Protokoll aller Spielaktionen | keiner |

Alles Lesen und Schreiben läuft über den APEX-Server (`/api/apex`) mit dem geheimen Schlüssel, der nur bei Vercel liegt.

---

## 4. Automatische Updates in Zukunft

```
Pull Request mit neuer Datei in supabase/migrations/
   ├─ Check „Migration files are complete and ordered“ (APEX): Reihenfolge, fehlende Dateien,
   │     gefährliches SQL, Tests, Build
   └─ Check „Supabase Preview“ (Supabase)
Merge nach main
   ├─ Supabase-GitHub-Integration spielt die neue Datei in APEX MAIN ein
   ├─ Vercel veröffentlicht die neue Webseite
   └─ Check „Production database deployed and secure“ (APEX) wartet bis zu 15 Minuten, bis
        https://4pex.online/api/apex?op=health den neuen Stand meldet:
        richtige Code-Version, alle Migrationen, Schema-Version, 5 Profile, Realtime, keine RLS-Probleme.
        Sonst wird er ROT und sagt genau, was fehlt.
```

Zusätzlich gilt: Ist die Datenbank älter als der Code, verweigert der Server Spielaktionen mit einer klaren Meldung
(„The campaign database is being updated…“) – statt mit falschen Daten weiterzulaufen.

**Dafür nötig (einmalig prüfen, ⚠️ deine Freigabe):** Supabase → Projekt **APEX MAIN** → **Project Settings** →
**Integrations** → **GitHub** → **Deploy to production** = an, **Production branch** = `main`,
**Supabase directory** = `.` → **Save**.

Der erste echte Test dieser Automatik ist der Merge dieses Pull Requests: Er enthält die kleine Migration
`20261101151000_apex_deploy_status_security.sql`, die **nur** über die Integration eingespielt wird.

### Eine neue Datenbank-Änderung (für später)
1. Neue Datei `supabase/migrations/<JJJJMMTTHHMMSS>_<name>.sql` mit einem Zeitstempel **nach** allen vorhandenen.
2. Wenn sich die Struktur ändert: `schema_version` in der Datei erhöhen und in `src/server/schema.ts`
   `REQUIRED_SCHEMA_VERSION` und `EXPECTED_MIGRATIONS` anpassen (ein Test erzwingt das).
3. Pull Request → Checks grün → mergen. Fertig.

Gefährliche Befehle (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`) lässt der Check nur durch, wenn in der
Datei die Zeile `-- apex:destructive-reviewed` steht.

---

## 5. Zustand prüfen

- Im Browser: **https://4pex.online/api/apex?op=health** – alles `true`, `"errors": []`.
- In Supabase → **Database** → **Migrations**: genau die Dateien aus `supabase/migrations/`.

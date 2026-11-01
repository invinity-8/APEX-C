# Datenbank-Änderungen (Migrationen) – automatisch und sicher

Diese Anleitung ist für Einsteiger. Sie erklärt, wie Änderungen an der APEX-Datenbank in Zukunft **automatisch**
beim Mergen auf GitHub eingespielt werden, und wie der aktuelle Fehler
„Remote migration versions not found in local migrations directory“ behoben wird.

> **Grundregeln:**
> - Kopiere **nie** Passwörter oder Schlüssel in einen Chat oder in eine Datei auf GitHub.
> - Datenbank-Änderungen nicht mehr von Hand im SQL Editor ausführen, sondern nur noch über Migrationsdateien.
> - Nichts zurücksetzen („Reset database“) und keine Einträge aus der Migrations-Historie löschen.

---

## Wie es funktioniert (Überblick)

```
Pull Request mit Datei in supabase/migrations/
      │
      ├─ GitHub-Check „Migration files are complete and ordered“  ← von APEX
      │     prüft: fehlt eine Datei? falsche Reihenfolge? gefährliches SQL (DROP/DELETE)?
      ├─ GitHub-Check „Supabase Preview“                          ← von Supabase
      │
  Merge nach main
      │
      ├─ Supabase-GitHub-Integration spielt neue Migrationen in APEX MAIN ein
      └─ GitHub-Check „Production database deployed and secure“   ← von APEX
            wartet, bis alle Migrationen eingespielt sind, prüft Tabellen, RLS, Rechte
            und /api/apex?op=health – und wird ROT, wenn etwas fehlt.
```

Jede Migration ist eine Datei `supabase/migrations/<Zeitstempel>_<name>.sql`. Supabase merkt sich in der Tabelle
`supabase_migrations.schema_migrations`, welche schon eingespielt sind, und spielt nur die neuen ein – in der
Reihenfolge der Zeitstempel.

---

## Was war kaputt?

1. **Eine Migrationsdatei fehlt im Repository.** In der Live-Datenbank ist die Migration
   `20261101094428_apex_initial_account_allowlist` eingetragen (sie hat am 1.11. die Tabellen `apex_access`
   und `apex_invites` angelegt). Ihr SQL-Text wurde aber nie auf GitHub gespeichert. Supabase bricht deshalb ab:
   „Remote migration versions not found in local migrations directory“. Den Inhalt darf man nicht erfinden –
   er muss aus der Datenbank geholt werden (Schritt 2).
2. **Zwei APEX-Migrationen hatten zu alte Zeitstempel** (`20261101000100…`, `20261101000200…`). Sie lagen *vor* der
   bereits eingespielten Migration und wären deshalb abgelehnt worden. Sie heißen jetzt
   `20261101100000_apex_online.sql` und `20261101100100_apex_seed_main_campaign.sql`. Der Inhalt ist unverändert.
   Das ist sicher, weil sie in der Live-Datenbank noch nicht als eingespielt eingetragen sind.

---

## Schritt 1 – Bestandsaufnahme (nur lesen, ändert nichts)

1. **https://supabase.com/dashboard** → Projekt **APEX MAIN** → links **SQL Editor** → **New query**.
2. Einfügen und **Run**:

   ```sql
   select version, name from supabase_migrations.schema_migrations order by version;

   select to_regclass('public.apex_access')   as apex_access,
          to_regclass('public.apex_invites')  as apex_invites,
          to_regclass('public.apex_campaigns') as apex_campaigns,
          to_regclass('public.apex_profiles')  as apex_profiles,
          (select count(*) from auth.users)    as anzahl_konten;
   ```

3. Erwartet: In der ersten Tabelle steht **nur** `20261101094428 | apex_initial_account_allowlist`.
   - Stehen dort weitere Einträge, **stopp** – schick mir die Liste (nur Versionen und Namen, keine Daten).
   - Sind `apex_campaigns` / `apex_profiles` schon vorhanden (nicht leer), hast du die APEX-Skripte früher von Hand
     ausgeführt. Das ist in Ordnung: Alle vier APEX-Migrationen sind so geschrieben, dass sie mehrfach laufen dürfen
     und vorhandene Daten nicht anfassen.

---

## Schritt 2 – Die fehlende Migration aus der Datenbank wiederherstellen ⚠️ deine Freigabe nötig

Supabase speichert den Original-SQL-Text jeder eingetragenen Migration. So holst du ihn:

1. Im **SQL Editor**:

   ```sql
   select array_to_string(statements, E';\n\n') || ';' as original_sql
   from supabase_migrations.schema_migrations
   where version = '20261101094428';
   ```

2. **Prüfe das Ergebnis, bevor du es speicherst:**
   - Ist das Feld **leer** (`NULL`)? Dann ist der Original-Text nicht gespeichert. **Stopp** – schreib mir.
     Dann müssen wir gemeinsam entscheiden, wie die Historie dokumentiert wird. Ich lege nichts Erfundenes an.
   - Enthält der Text **E-Mail-Adressen** oder andere private Daten (z. B. `insert into apex_access … 'name@…'`)?
     Wenn dein GitHub-Repository **öffentlich** ist, würden sie damit veröffentlicht. Entscheide dann:
     Repository auf *privat* stellen (GitHub → Settings → General → Danger Zone → *Change visibility*)
     **oder** mir Bescheid geben, damit wir eine Lösung ohne Adressen in der Datei besprechen.
3. Wenn alles in Ordnung ist: Auf GitHub im Repository **APEX-C** oben links den Branch
   **fix/supabase-migration-history** auswählen → Ordner `supabase` → `migrations` öffnen →
   rechts oben **Add file → Create new file**.
4. Dateiname exakt: `20261101094428_apex_initial_account_allowlist.sql`
5. Den kopierten SQL-Text **unverändert** einfügen.
6. Unten **Commit changes…** → „Commit directly to the fix/supabase-migration-history branch“ → **Commit changes**.
7. Nach etwa einer Minute wird der Check **„Migration files are complete and ordered“** grün.

> Fortgeschrittene Alternative mit dem Supabase-Programm auf deinem Computer: `supabase link --project-ref
> xqkyaqxuoaxadpkcdhch` und danach `supabase migration fetch` – das holt dieselben Dateien.

---

## Schritt 3 – Was die vier APEX-Migrationen tun (zum Prüfen)

Sie werden in dieser Reihenfolge eingespielt, **löschen nichts** und dürfen mehrfach laufen
(der automatische Check verbietet DROP/TRUNCATE/DELETE ohne ausdrückliche Prüfmarkierung):

| Datei | Was passiert |
|---|---|
| `20261101100000_apex_online.sql` | legt die APEX-Tabellen an (Kampagne, Mitglieder, Einladungen, Spielstand, Sicherungen, Protokoll), schaltet Row Level Security ein und **entzieht Browsern alle direkten Rechte** auf diese Tabellen (gewollt: nur der APEX-Server darf zugreifen) |
| `20261101100100_apex_seed_main_campaign.sql` | legt die Kampagne „APEX – Arena of the Eternal Will“ und die ersten Einladungen an; übernimmt – falls vorhanden – Einträge aus `apex_access`, **ohne** `apex_access` zu verändern |
| `20261102000100_apex_presence_and_grants.sql` | fügt die Spalte „zuletzt online“ hinzu, gibt dem APEX-Server ausdrücklich Rechte |
| `20261103000100_apex_profiles.sql` | legt die fünf Profile GM, Hannah, Jean, Simon, Jerba an (ohne E-Mail-Adressen) |

`apex_access`, `apex_invites` und alle angemeldeten Konten (`auth.users`) werden **nicht verändert oder gelöscht**.
Der Check nach dem Einspielen prüft ausdrücklich, dass `apex_access` und `apex_invites` noch da sind.

---

## Schritt 4 – Supabase-GitHub-Integration einstellen ⚠️ deine Freigabe nötig

1. Supabase → Projekt **APEX MAIN** → links unten **Project Settings** (Zahnrad) → **Integrations**.
2. Bei **GitHub**: Ist das Repository `invinity-8/APEX-C` verbunden? (Ja – sonst gäbe es den Check „Supabase Preview“ nicht.)
3. Auf **Configure** / die Einstellungen der Verbindung klicken und prüfen:
   - **Supabase directory**: `.` (Punkt – der Ordner `supabase` liegt direkt im Repository)
   - **Deploy to production**: **an**
   - **Production branch**: `main`
   - **Automatic branching** (Vorschau-Datenbanken pro Pull Request): optional. Achtung: Vorschau-Branches können bei
     Supabase **Kosten** verursachen. Wenn du das nicht willst, ausschalten – dann entfällt nur der Check „Supabase Preview“.
4. **Save**.

Ab jetzt spielt Supabase beim Merge nach `main` alle neuen Migrationsdateien automatisch ein.

---

## Schritt 5 – Kontroll-Zugang für GitHub einrichten (empfohlen) ⚠️ deine Freigabe nötig

Damit GitHub nach dem Einspielen **prüfen** kann, ob alles da ist, braucht es einen Zugang, der **nur lesen** darf –
und zwar nur die Migrations-Liste und Tabellen-Informationen, **keine Spieldaten**.

1. Erzeuge in einem Passwort-Manager ein langes Zufallspasswort (mindestens 32 Zeichen, nur Buchstaben und Zahlen).
2. Supabase → **SQL Editor** → einfügen, `HIER-PASSWORT` durch dein Passwort ersetzen → **Run**:

   ```sql
   create role apex_ci_readonly with login password 'HIER-PASSWORT';
   grant usage on schema supabase_migrations to apex_ci_readonly;
   grant select on supabase_migrations.schema_migrations to apex_ci_readonly;
   ```

   (Danach die Abfrage im Editor löschen, damit das Passwort nicht stehen bleibt.)
3. Supabase → oben auf **Connect** → Reiter **Connection string** → **Session pooler** → die Adresse kopieren. Sie sieht so aus:
   `postgresql://postgres.xqkyaqxuoaxadpkcdhch:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres`
4. Ändere darin:
   - `postgres.xqkyaqxuoaxadpkcdhch` → `apex_ci_readonly.xqkyaqxuoaxadpkcdhch`
   - `[YOUR-PASSWORD]` → dein Passwort aus Punkt 1
5. GitHub → Repository **APEX-C** → **Settings** → links **Secrets and variables** → **Actions**:
   - Reiter **Secrets** → **New repository secret** → Name `SUPABASE_CI_DB_URL`, Wert: die geänderte Adresse → **Add secret**.
   - Reiter **Variables** → **New repository variable** → Name `APEX_URL`, Wert `https://apex-gray-eta.vercel.app` → **Add variable**.

Ohne dieses Secret bleibt der Check bei Pull Requests gelb (Warnung) und wird nach einem Merge auf `main` **rot**
mit dem Hinweis, dass die Datenbank nicht geprüft werden konnte – damit nichts unbemerkt bleibt.

---

## Schritt 6 – Pull Request prüfen und mergen ⚠️ deine Freigabe nötig

1. Pull Request **„fix: Supabase migration history …“** öffnen.
2. Warten, bis die Checks fertig sind:
   - **Migration files are complete and ordered** → grün (erst nach Schritt 2)
   - **Supabase Preview** → grün (falls Automatic branching an ist)
   - **Vercel** → grün
3. **Ready for review** → **Merge pull request**.
4. Danach GitHub → Reiter **Actions** → Lauf **„Supabase migrations“** öffnen. Der Schritt
   **„Production database deployed and secure“** wartet bis zu 15 Minuten, bis Supabase alles eingespielt hat,
   und zeigt dann die Migrations-Liste und „✓ Production database verified.“
5. Wird er **rot**, steht in der Meldung genau, was fehlt (z. B. „did not apply these migrations…“ oder
   „row level security is OFF on …“). Schick mir dann diese Zeile.

---

## Schritt 7 – Merge sperren, wenn Migrationen fehlen (empfohlen)

GitHub → **Settings** → **Branches** → **Add branch ruleset** (oder *Add rule*) für `main`:
- **Require status checks to pass** → Check **„Migration files are complete and ordered“** hinzufügen → **Save**.

Dann lässt sich ein Pull Request mit fehlender oder falsch sortierter Migration gar nicht erst mergen.

---

## In Zukunft: eine neue Datenbank-Änderung

1. Neue Datei `supabase/migrations/<JJJJMMTTHHMMSS>_<kurzer_name>.sql` mit einem Zeitstempel **nach** allen
   vorhandenen anlegen (z. B. `20261110120000_apex_weather.sql`).
2. Pull Request öffnen → Checks abwarten → mergen.
3. Supabase spielt sie ein, GitHub prüft das Ergebnis.
4. Optional: die neue Version in `supabase/remote_history.txt` nachtragen (das ist die Liste der in Produktion
   eingespielten Versionen; der Live-Vergleich aus Schritt 5 ist aber maßgeblich).

Gefährliche Befehle (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`) lässt der Check nur durch, wenn in der
Datei die Zeile `-- apex:destructive-reviewed` steht – also erst nach bewusster Prüfung.

---

## Übersicht: Was braucht deine Freigabe?

| Schritt | Was | Warum deine Entscheidung |
|---|---|---|
| 2 | Original-SQL der alten Migration aus der Datenbank kopieren und speichern | kann E-Mail-Adressen enthalten; nur du siehst den Inhalt |
| 4 | „Deploy to production“ in der Supabase-Integration einschalten | ab dann ändert jeder Merge die Live-Datenbank |
| 4 | „Automatic branching“ an/aus | möglicherweise kostenpflichtig |
| 5 | Lese-Zugang `apex_ci_readonly` + GitHub-Secret anlegen | Passwort erzeugst und verwaltest nur du |
| 6 | Pull Request mergen | spielt die vier APEX-Migrationen in die Live-Datenbank ein |
| 7 | Merge-Sperre bei fehlenden Migrationen | ändert die Regeln deines Repositorys |

# APEX online schalten – Schritt-für-Schritt-Anleitung (Deutsch)

Diese Anleitung ist für Einsteiger geschrieben. Du brauchst Zugang zu **Supabase** (Projekt *APEX MAIN*)
und zu **Vercel** (Projekt *apex*). Seit **APEX 0.3** gibt es keine E-Mail-Anmeldung mehr: Profil wählen, Passwort
eingeben, fertig.

> **Wichtig zur Sicherheit:** Kopiere niemals einen geheimen Schlüssel (*secret key* / *service_role key*)
> in einen Chat, in eine E-Mail oder in GitHub. Er gehört **nur** in die Vercel-Einstellungen.

Die Menünamen in Supabase und Vercel ändern sich gelegentlich ein wenig. Wenn ein Punkt nicht genau so heißt,
suche nach dem ähnlichsten Begriff.

---

## Teil A – Zuerst prüfen, was gerade los ist (2 Minuten)

1. Öffne im Browser: **https://4pex.online/api/apex?op=health**
2. Lies die Antwort:

| Du siehst … | Bedeutung | Weiter mit |
|---|---|---|
| eine Fehlerseite „404“ oder die normale APEX-Seite | Der Server-Teil ist auf dieser Version noch nicht installiert (die neue Version ist noch nicht live). | Teil E2 (nach dem Merge) |
| `"serverConfigured": false` | In Vercel fehlen `SUPABASE_URL` und/oder `SUPABASE_SECRET_KEY`. | Teil D |
| `"database": false` | Die Datenbank-Tabellen fehlen oder der Schlüssel ist falsch. | Teil B, dann Teil D |
| `"profilesTable": false` | Die Profile fehlen. | Teil B (MIGRATIONS_DE.md) |
| `"migrationsComplete": false` | Eine Migration fehlt (z. B. `20261101173039`, Passwort-Login). | Teil B (MIGRATIONS_DE.md) |
| alles `true`, `"errors": []` | Server und Datenbank sind in Ordnung. | Teil F (Test) |

3. Unter `"commit"` steht die Kurzkennung der Version, die gerade live ist (z. B. `ff2e982`).
   Vergleiche sie mit dem neuesten Commit auf GitHub (Repository → *Commits*). Sind sie gleich, läuft der aktuelle Code.

**Wahrscheinliche Ursache des bisherigen Problems:** Auf Vercel fehlten die Variablen `VITE_SUPABASE_URL` und
`VITE_SUPABASE_PUBLISHABLE_KEY`, oder sie wurden eingetragen, ohne danach neu zu deployen. Dann startete APEX bisher
stillschweigend den *lokalen Demo-Modus* – jeder Browser hatte sein eigenes Spiel. Die neue Version zeigt in diesem
Fall stattdessen deutlich „APEX is not connected yet“ und startet **kein** lokales Spiel mehr.

---

## Teil B – Datenbank einrichten (automatisch über GitHub)

**Neu:** Die Datenbank-Änderungen werden **nicht mehr von Hand** in den SQL Editor kopiert. Sie werden automatisch
eingespielt, sobald ein Pull Request nach `main` gemergt wird – über die Supabase-GitHub-Integration.
Von Hand eingefügte Skripte tauchen nicht in der Migrations-Historie auf und bringen sie durcheinander.

➡ **Die vollständige Anleitung steht in [MIGRATIONS_DE.md](MIGRATIONS_DE.md).** Dort ist auch beschrieben, wie die
fehlende alte Migration `20261101094428_apex_initial_account_allowlist` wiederhergestellt wird.

Nach dem automatischen Einspielen kannst du zur Kontrolle im **SQL Editor** `supabase/verify_security.sql` ausführen
(nur lesend). Erwartet:
- erste Tabelle: **keine Zeilen**
- zweite Tabelle: genau zwei Zeilen (`apex_campaign_heads` und `apex_campaign_members`, jeweils `authenticated`, `SELECT`)
- dritte Tabelle: **eine** Zeile mit `apex_campaign_heads`
- im **Table Editor** → **apex_profiles**: fünf Zeilen (gm, hannah, jean, simon, jerba)

---

## Teil C – Anmeldung (seit APEX 0.3: Profil + Passwort, keine E-Mails mehr)

APEX braucht **keine E-Mails, keinen SMTP-Server und keine Codes per Mail** mehr. Jede Person wählt ihr Profil
und gibt ihr Passwort ein. Passwörter werden nur als sichere Prüfsumme (Argon2id) gespeichert – niemand kann sie
später auslesen, auch du als Spielleiter nicht.

**Aufräumen (optional, sobald 0.3 live läuft und funktioniert):**
- Vercel → *Settings → Environment Variables*: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_FROM` (und, falls vorhanden,
  `SMTP_PASS`, `APEX_LOGIN_INTERVAL_SEC`) löschen. Sie werden nicht mehr benutzt.
- Supabase → *Authentication*: eigenes SMTP und die Code-E-Mail-Vorlage werden nicht mehr gebraucht. Die drei alten
  Konten unter *Users* stören nicht und können bleiben.

---

## Teil D – Schlüssel in Vercel eintragen (ca. 10 Minuten)

### D1 – Schlüssel in Supabase finden (nicht kopieren, bevor du in Vercel bist)
1. Supabase → Projekt → links unten **Project Settings** (Zahnrad) → **API Keys**.
2. Dort gibt es einen **Publishable key** (beginnt mit `sb_publishable_…`) und einen **Secret key**
   (beginnt mit `sb_secret_…`). Ältere Projekte zeigen stattdessen **anon** und **service_role** im Reiter *Legacy API Keys* –
   die funktionieren auch.
3. Die **Project URL** findest du unter **Project Settings → Data API**: `https://xqkyaqxuoaxadpkcdhch.supabase.co`

### D2 – In Vercel eintragen
1. Öffne **https://vercel.com/dashboard** → Projekt **apex**.
2. Oben **Settings** → links **Environment Variables**.
3. Für jede Zeile der Tabelle: **Key** eintragen, **Value** einfügen, bei *Environments* **Production** und **Preview**
   anhaken, dann **Save**.

| Key | Value | Hinweis |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://xqkyaqxuoaxadpkcdhch.supabase.co` | öffentlich |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | der *Publishable key* (oder *anon*) | öffentlich |
| `SUPABASE_URL` | `https://xqkyaqxuoaxadpkcdhch.supabase.co` | nur Server |
| `SUPABASE_SECRET_KEY` | der *Secret key* (oder *service_role*) | **geheim** – Vercel markiert ihn als „Sensitive“, das ist gut |

4. **Sehr wichtig:** Der geheime Schlüssel darf **nie** einen Namen haben, der mit `VITE_` beginnt.
5. Prüfe, dass es **keine** alte Variable `VITE_APEX_ALLOW_DEMO` mit dem Wert `true` in *Production* gibt.

### D3 – Neu bauen lassen (sonst wirken die Variablen nicht!)
Variablen mit `VITE_` werden beim Bauen in die Webseite eingebaut. Nach jeder Änderung:
1. Oben **Deployments** klicken.
2. Beim obersten Eintrag (Production) rechts auf **⋯** → **Redeploy** → bestätigen.
3. Warten, bis „Ready“ erscheint.

---

## Teil E – Erstes Spielleiter-Passwort und Spieler-Passwörter (ca. 5 Minuten)

### E1 – Einmaliger Einrichtungscode für den Spielleiter
Das erste GM-Passwort wird mit einem **Einmal-Code** gesetzt. Nur wer Zugang zum Supabase-Projekt hat, kann ihn erzeugen.

1. Supabase → Projekt **APEX MAIN** → links **SQL Editor** → **New query**.
2. Einfügen und auf **Run** klicken:
   ```sql
   select apex_private.create_gm_setup_code();
   ```
3. Es erscheint ein Code wie `7F3A-19C2-…`. Er gilt **24 Stunden** und **nur einmal**. (Ein neuer Code macht den alten ungültig.)
4. APEX öffnen → **Join Campaign** → **GM** → „First-time setup“ → Code eingeben, dein neues Passwort zweimal → **Set password and enter**.
5. Beim allerersten Mal: **Generate arena** klicken.

**GM-Passwort vergessen?** Genau dieselben Schritte – der Code setzt ein neues GM-Passwort und meldet alle GM-Geräte ab.

### E2 – Passwörter für Hannah, Jean, Simon und Jerba
1. Als GM rechts **Players & Access** → Reiter **Profiles**.
2. Beim Profil (z. B. **Hannah**) **🔑 Set password** → Passwort eintippen (mind. 8 Zeichen) → **Save**.
   Das Profil ist damit aktiviert. Sag der Person das Passwort persönlich.
3. Profile **ohne Passwort bleiben gesperrt** („Not activated yet“) und lassen sich auf der Startseite nicht wählen.
4. Weitere Knöpfe pro Profil:
   - **Reset password** – neues Passwort, alle Geräte dieser Person werden sofort abgemeldet.
   - **Deactivate / Activate** – Zugang sperren bzw. wieder freigeben (Sperren meldet sofort überall ab).
   - **Sign out devices** – alle angemeldeten Geräte abmelden.
   - **Remove password** – Profil sperren, bis du ein neues Passwort setzt.
   - **Character** – welche Figur das Profil spielt (Hannah → Sinna, Jean → Aster, Simon → Elwin, Jerba → Javi).
5. Jede Person kann ihr Passwort später selbst ändern: oben rechts auf **🔑** klicken.

Falls ein gelber Hinweis „old placeholder characters“ erscheint: **Convert old characters** klicken – Positionen,
Wissen und Gegenstände bleiben erhalten, vorher wird automatisch eine Sicherung angelegt.

---

## Teil E2 – Neue Version testen und veröffentlichen

1. Auf GitHub den neuesten Pull Request von APEX öffnen (z. B. **APEX 0.3 – Password login, character sheets & inventory**).
2. Unten im Kommentar von **vercel[bot]** auf **Preview** klicken – das ist eine Testversion mit eigener Adresse.
3. Teste dort Teil F. Erst wenn alles klappt: im Pull Request **Ready for review** → **Merge pull request**.
4. Danach baut Vercel automatisch die Live-Seite. Teil A, Schritt 1 erneut prüfen.

---

## Teil F – Test mit drei Geräten (Spielleiter, Hannah, Jean)

Nimm drei Geräte oder drei verschiedene Browser (z. B. Chrome, Firefox und ein privates Fenster).

| # | Was du tust | Was passieren muss |
|---|---|---|
| 1 | Seite ohne Anmeldung öffnen | „Welcome to APEX“ mit Knopf **Join Campaign** |
| 2 | **Join Campaign** | „Who are you?“ mit GM, Hannah, Jean, Simon, Jerba; Profile ohne Passwort „Not activated yet“ |
| 3 | Gerät 1: **GM** + Passwort → **Enter the Arena** | Spielleiter-Ansicht mit ganzer Karte |
| 4 | Profil **Hannah**, aber falsches Passwort | „Wrong password“, keine Anmeldung; nach 5 Fehlversuchen 15 Minuten Pause |
| 5 | Profil **GM** mit Hannahs Passwort | „Wrong password“ – niemand wird ohne GM-Passwort Spielleiter |
| 6 | Gerät 2: **Hannah** + ihr Passwort | „Playing as Sinna“, oben grün „Live“ |
| 7 | Gerät 3: **Jean** + sein Passwort | „Playing as Aster“ |
| 8 | Hannah zieht Sinna | Bei GM und Jean bewegt sich Sinna **ohne Neuladen** |
| 9 | Hannah → **Character** → **Import Character Sheet** → PDF | Prüfansicht: grün „Recognized“, gelb „Please check“, rot „Missing“; erst nach **Save** gespeichert |
| 10 | Seite neu laden → **Character** | importierte Werte sind noch da |
| 11 | Bei **Hit points** auf − klicken | Wert sinkt sofort, auch beim GM sichtbar |
| 12 | **Inventory** → „Old iron key, wrapped in red cloth“ → **+ Add**; neuen Behälter anlegen | Eintrag und Behälter erscheinen, auch beim GM |
| 13 | GM → **Character sheets** → Figur wählen → **Edit sheet** | GM kann alles sehen und ändern |
| 14 | GM → **Profiles** → Jean **Deactivate** | Jean wird sofort abgemeldet und kommt nicht mehr hinein; danach **Activate** |
| 15 | **Sign out** | zurück zu „Who are you?“ |

Wenn etwas nicht klappt: Teil A wiederholen und die Antwort von `?op=health` notieren (sie enthält keine Geheimnisse).

---

## Teil H – Welten verwalten (Spielleiter)

Rechts im Bereich **World Management**:

- **Archive World** – speichert eine vollständige Kopie der aktuellen Welt (Name und Beschreibung frei wählbar). Die Welt selbst ändert sich nicht.
- **Create New World** – Name, Kartenradius, optional ein Seed. Wähle **Keep progress** (Willenskraft bleibt wie sie ist) oder **Fresh start**
  (Willenskraft wird aufgefüllt). Die aktuelle Welt wird vorher automatisch archiviert.
- **Reset Current World** – neue Karte mit gleichem Namen. Zur Bestätigung **RESET** eintippen. Die alte Welt wird vorher archiviert.
- **Restore** (in der Archivliste) – holt eine archivierte Welt zurück. Die aktuelle Welt wird vorher archiviert. Inventare: **Keep current**
  (empfohlen) oder **Use archived**.

**Bleibt immer erhalten:** Konten, Passwörter, Profile, GM-Rechte, Zuordnung Spieler ↔ Figur, Charakterbögen und Inventare.
**Neu pro Welt:** Karte, Positionen, erkundete Felder (Fog of War), Tag/Nacht, schrumpfende Arena, Ereignisse.
Alle Spieler werden automatisch auf die neue Welt umgestellt und bekommen einen Hinweis. Schlägt etwas fehl, bleibt die alte Welt aktiv.

## Teil G – Neue Spieler später freischalten

1. Als Spielleiter anmelden → **Players & Access** → **Profiles**.
2. Beim Profil (z. B. **Simon**) **🔑 Set password** → Passwort → **Save**.
3. Der Person sagen: „Öffne APEX → Join Campaign → wähle dein Profil → gib dein Passwort ein.“

Zugang entziehen: **Deactivate** (sofort überall abgemeldet).

## Notfall: zurück zur alten Version
Vercel → **Deployments** → eine ältere Version mit „Ready“ → **⋯** → **Promote to Production**.
Der Spielstand in Supabase bleibt dabei erhalten (Sicherungen: *Players & Access → Backups*).

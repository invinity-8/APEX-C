# APEX online schalten – Schritt-für-Schritt-Anleitung (Deutsch)

Diese Anleitung ist für Einsteiger geschrieben. Du brauchst Zugang zu **Supabase** (Projekt *APEX MAIN*)
und zu **Vercel** (Projekt *apex*). Plane etwa 30–45 Minuten ein.

> **Wichtig zur Sicherheit:** Kopiere niemals einen geheimen Schlüssel (*secret key* / *service_role key*)
> in einen Chat, in eine E-Mail oder in GitHub. Er gehört **nur** in die Vercel-Einstellungen.

Die Menünamen in Supabase und Vercel ändern sich gelegentlich ein wenig. Wenn ein Punkt nicht genau so heißt,
suche nach dem ähnlichsten Begriff.

---

## Teil A – Zuerst prüfen, was gerade los ist (2 Minuten)

1. Öffne im Browser: **https://apex-gray-eta.vercel.app/api/apex?op=health**
2. Lies die Antwort:

| Du siehst … | Bedeutung | Weiter mit |
|---|---|---|
| eine Fehlerseite „404“ oder die normale APEX-Seite | Der Server-Teil ist auf dieser Version noch nicht installiert (die neue Version ist noch nicht live). | Teil E (nach dem Merge) |
| `"serverConfigured": false` | In Vercel fehlen `SUPABASE_URL` und/oder `SUPABASE_SECRET_KEY`. | Teil D |
| `"database": false` | Die Datenbank-Tabellen fehlen oder der Schlüssel ist falsch. | Teil B, dann Teil D |
| `"presenceColumn": false` | Die dritte Migration fehlt. | Teil B, Schritt 5 |
| `"authAdmin": false` | Der geheime Schlüssel ist falsch oder abgelaufen. | Teil D |
| alles `true`, `"errors": []` | Server und Datenbank sind in Ordnung. | Teil F (Test) |

3. Unter `"commit"` steht die Kurzkennung der Version, die gerade live ist (z. B. `ff2e982`).
   Vergleiche sie mit dem neuesten Commit auf GitHub (Repository → *Commits*). Sind sie gleich, läuft der aktuelle Code.

**Wahrscheinliche Ursache des bisherigen Problems:** Auf Vercel fehlten die Variablen `VITE_SUPABASE_URL` und
`VITE_SUPABASE_PUBLISHABLE_KEY`, oder sie wurden eingetragen, ohne danach neu zu deployen. Dann startete APEX bisher
stillschweigend den *lokalen Demo-Modus* – jeder Browser hatte sein eigenes Spiel. Die neue Version zeigt in diesem
Fall stattdessen deutlich „APEX is not connected yet“ und startet **kein** lokales Spiel mehr.

---

## Teil B – Datenbank einrichten (Supabase, ca. 10 Minuten)

Die Skripte löschen **keine** vorhandenen Daten und dürfen auch mehrfach ausgeführt werden.

1. Öffne **https://supabase.com/dashboard** und melde dich an.
2. Klicke auf das Projekt **APEX MAIN**.
3. Klicke links auf **SQL Editor** (Symbol mit `>_`).
4. Klicke auf **New query** (oder „+“).
5. Führe die drei Dateien **in dieser Reihenfolge** aus. Für jede Datei:
   1. Öffne die Datei auf GitHub (Repository → Ordner `supabase/migrations`).
   2. Klicke auf die Datei, dann oben rechts auf **Copy raw file** (Symbol mit zwei Blättern).
   3. Füge den Text im SQL Editor ein (alten Text vorher löschen).
   4. Klicke unten rechts auf **Run**.
   5. Es muss „Success“ erscheinen. Hinweise („NOTICE … skipping“) sind normal.

   | Reihenfolge | Datei |
   |---|---|
   | 1 | `20261101000100_apex_online.sql` |
   | 2 | `20261101000200_apex_seed_main_campaign.sql` |
   | 3 | `20261102000100_apex_presence_and_grants.sql` |

6. Prüfen: Führe auf dieselbe Weise `supabase/verify_security.sql` aus. Erwartet:
   - erste Tabelle: **keine Zeilen**
   - zweite Tabelle: genau zwei Zeilen (`apex_campaign_heads` und `apex_campaign_members`, jeweils `authenticated`, `SELECT`)
   - dritte Tabelle: **eine** Zeile mit `apex_campaign_heads`
7. Klicke links auf **Table Editor** → Tabelle **apex_campaign_invites**. Dort müssen die drei eingeladenen
   E-Mail-Adressen stehen (deine als `gm`, die beiden anderen als `player`).

---

## Teil C – Anmeldung mit E-Mail-Code einrichten (Supabase, ca. 15 Minuten)

APEX meldet Spieler ohne Passwort an: E-Mail-Adresse eingeben → 6-stelliger Code kommt per E-Mail → Code eingeben.
Nur eingeladene Adressen bekommen einen Code.

### C1 – Selbstregistrierung ausschalten
1. In Supabase links auf **Authentication** klicken.
2. Im Untermenü **Sign In / Providers** (früher: *Providers*) öffnen.
3. Den Schalter **Allow new users to sign up** auf **aus** stellen. Speichern.
4. Darunter **Email** anklicken: **Enable Email provider** muss **an** sein.
5. Im selben Fenster:
   - **Email OTP Length**: `6`
   - **Email OTP Expiration**: `600` (Sekunden = 10 Minuten)
6. **Save** klicken.

### C2 – E-Mail-Vorlage auf „Code“ umstellen
Supabase schickt einen **Code statt eines Links**, sobald die Vorlage den Platzhalter `{{ .Token }}` enthält.

1. **Authentication** → **Emails** (früher: *Email Templates*).
2. Vorlage **Magic Link** öffnen.
3. **Subject**: `Dein APEX-Anmeldecode`
4. **Body** komplett ersetzen durch:

   ```html
   <h2>APEX – Arena of the Eternal Will</h2>
   <p>Dein Anmeldecode lautet:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:6px">{{ .Token }}</p>
   <p>Der Code gilt 10 Minuten und nur ein einziges Mal. Wenn du keinen Code angefordert hast, ignoriere diese E-Mail.</p>
   ```

5. **Save** klicken.
6. Dasselbe für die Vorlage **Confirm signup** wiederholen (gleicher Text).

### C3 – E-Mail-Versand an alle Spieler ermöglichen (wichtig!)
Der eingebaute Supabase-E-Mail-Dienst ist nur zum Ausprobieren gedacht: Nach meinem Kenntnisstand sendet er nur
an Adressen von Mitgliedern deines Supabase-Teams und nur sehr wenige E-Mails pro Stunde. Damit Hannah und Jean
ihre Codes sicher bekommen, richte einen eigenen E-Mail-Versand (SMTP) ein:

1. Lege bei einem E-Mail-Dienst ein kostenloses Konto an (z. B. *Resend*, *Brevo* oder *Postmark*) und folge dort
   der Anleitung „SMTP-Zugangsdaten erstellen“. Dort bestätigst du auch deine Absender-Adresse oder Domain.
2. In Supabase: **Authentication** → **Emails** → Reiter **SMTP Settings** → **Enable Custom SMTP** einschalten.
3. Die Daten vom E-Mail-Dienst eintragen (Host, Port, Benutzername, Passwort, Absender-Adresse, Absender-Name `APEX`).
4. **Save** klicken.
5. Unter **Authentication** → **Rate Limits** prüfen: „Rate limit for sending emails“ auf z. B. `30` pro Stunde stellen.

### C4 – Adressen der Webseite eintragen
1. **Authentication** → **URL Configuration**.
2. **Site URL**: `https://apex-gray-eta.vercel.app`
3. Unter **Redirect URLs** auf **Add URL** klicken und hinzufügen:
   - `https://apex-gray-eta.vercel.app/**`
   - `https://*-apex-7c89.vercel.app/**` (für Vorschau-Versionen)
4. **Save** klicken.

> Konten musst du **nicht** mehr von Hand anlegen. Wenn eine eingeladene Person zum ersten Mal einen Code anfordert,
> legt der APEX-Server ihr Konto automatisch an. Für alle anderen Adressen passiert nichts.

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

## Teil E – Neue Version testen und veröffentlichen

1. Auf GitHub den Pull Request **fix: Supabase multiplayer & email-code login** öffnen.
2. Unten im Kommentar von **vercel[bot]** auf **Preview** klicken – das ist eine Testversion mit eigener Adresse.
3. Teste dort Teil F. Erst wenn alles klappt: im Pull Request **Ready for review** → **Merge pull request**.
4. Danach baut Vercel automatisch die Live-Seite. Teil A, Schritt 1 erneut prüfen.

---

## Teil F – Test mit drei Geräten (Spielleiter, Spieler 1, Spieler 2)

Nimm drei Geräte oder drei verschiedene Browser (z. B. Chrome, Firefox und ein privates Fenster).

| # | Was du tust | Was passieren muss |
|---|---|---|
| 1 | Seite ohne Anmeldung öffnen | nur die Anmeldeseite |
| 2 | Eine **nicht** eingeladene Adresse eingeben | Hinweis „If this email address is invited …“, aber **keine** E-Mail kommt an |
| 3 | Als Spielleiter deine Adresse eingeben → Code aus der E-Mail eingeben | Du bist drin. Beim ersten Mal: **Generate arena** klicken |
| 4 | Spielleiter → rechts **Players & Access** → **Characters**: Spielfiguren den Spielern zuweisen | – |
| 5 | Spieler 1 und Spieler 2 melden sich mit ihren Codes an | Jeder sieht „Playing as …“ mit seiner Figur, oben grün „Live“ |
| 6 | Spieler 1 zieht seine Figur | Bei Spielleiter und Spieler 2 bewegt sich die Figur **ohne Neuladen** (1–2 Sekunden) |
| 7 | Spielleiter klickt **Begin Night 1** | Bei beiden Spielern wird es Nacht |
| 8 | Irgendeinen Browser neu laden | gleicher Spielstand |
| 9 | Spieler 1 versucht, die Figur von Spieler 2 zu ziehen | geht nicht, Meldung erscheint |
| 10 | Spieler 1: WLAN kurz ausschalten, Spieler 2 zieht, WLAN wieder an | rotes Hinweisband, danach automatisch aktueller Stand |
| 11 | Spielleiter → **Players & Access** → **Accounts** | grüne Punkte = gerade online |
| 12 | **Sign out** | zurück zur Anmeldeseite |

Wenn etwas nicht klappt: Teil A wiederholen und die Antwort von `?op=health` notieren (sie enthält keine Geheimnisse).

---

## Teil G – Neue Spieler später einladen

1. Als Spielleiter anmelden → rechts **Players & Access** → **Accounts** → **Invite a person**.
2. E-Mail-Adresse eingeben, *Player* wählen, Figur(en) anklicken → **Save invitation**.
3. Der Person sagen: „Öffne APEX, gib deine E-Mail ein, du bekommst einen Code.“

Zugang entziehen: In der Liste beim Konto auf **✕** klicken – die Person kommt sofort nicht mehr ins Spiel.

## Notfall: zurück zur alten Version
Vercel → **Deployments** → eine ältere Version mit „Ready“ → **⋯** → **Promote to Production**.
Der Spielstand in Supabase bleibt dabei erhalten (Sicherungen: *Players & Access → Backups*).

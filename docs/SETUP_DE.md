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
| eine Fehlerseite „404“ oder die normale APEX-Seite | Der Server-Teil ist auf dieser Version noch nicht installiert (die neue Version ist noch nicht live). | Teil E2 (nach dem Merge) |
| `"serverConfigured": false` | In Vercel fehlen `SUPABASE_URL` und/oder `SUPABASE_SECRET_KEY`. | Teil D |
| `"database": false` | Die Datenbank-Tabellen fehlen oder der Schlüssel ist falsch. | Teil B, dann Teil D |
| `"presenceColumn": false` | Die dritte Migration fehlt. | Teil B (MIGRATIONS_DE.md) |
| `"profilesTable": false` | Die vierte Migration (Profile) fehlt. | Teil B (MIGRATIONS_DE.md) |
| `"authAdmin": false` | Der geheime Schlüssel ist falsch oder abgelaufen. | Teil D |
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

## Teil E – Profile mit E-Mail-Adressen verknüpfen (in APEX, ca. 5 Minuten)

Auf der Startseite wählt jede Person ihr Profil („Who are you?“). Ein Profil öffnet sich aber **nur** für die
E-Mail-Adresse, die du als Spielleiter damit verknüpft hast. Die Adressen stehen deshalb nicht im Code, sondern
nur in deiner Datenbank.

1. APEX öffnen → **Join Campaign** → Profil **GM** wählen → deine E-Mail-Adresse eingeben → Code aus der E-Mail eingeben.
   (Das GM-Profil funktioniert für jedes Konto mit der Spielleiter-Rolle.)
2. Beim allerersten Mal: **Generate arena** klicken.
3. Rechts im Bereich **Players & Access** den Reiter **Profiles** öffnen.
4. Bei **Hannah** ihre E-Mail-Adresse eintragen → **Save**. Genauso bei **Jean**.
5. **Simon** und **Jerba** leer lassen, bis du ihre Adressen hast – ihre Profile sind so lange „Not activated yet“
   und lassen sich auf der Startseite nicht auswählen. Später einfach eintragen und **Save** klicken.
6. Unter **Character** siehst du, welche Figur zum Profil gehört (Hannah → Sinna, Jean → Aster, Simon → Elwin,
   Jerba → Javi). Du kannst sie dort ändern.
7. Falls oben ein gelber Hinweis „old placeholder characters“ erscheint: Die Kampagne stammt noch aus der alten
   Version (Livia, Marcus, …). Klicke **Convert old characters** – Positionen, Wissen und Gegenstände bleiben erhalten,
   vorher wird automatisch eine Sicherung angelegt.

**Profil wechseln oder Zugang entziehen:** Bei einem Profil **Unlink** klicken – die bisherige Person kommt sofort
nicht mehr in dieses Profil. Eine neue Adresse eintragen und **Save** – ab dann gilt nur diese.

> Hinweis: Die ältere Datei `20261101100100_apex_seed_main_campaign.sql` enthält noch die drei ersten E-Mail-Adressen
> (als Einladungen). Falls dein GitHub-Repository öffentlich ist, solltest du das wissen. Die neuen Profile
> funktionieren ohne Adressen im Code.

---

## Teil E2 – Neue Version testen und veröffentlichen

1. Auf GitHub den neuesten Pull Request von APEX öffnen (z. B. **feat: Welcome screen, "Who are you?" profiles**).
2. Unten im Kommentar von **vercel[bot]** auf **Preview** klicken – das ist eine Testversion mit eigener Adresse.
3. Teste dort Teil F. Erst wenn alles klappt: im Pull Request **Ready for review** → **Merge pull request**.
4. Danach baut Vercel automatisch die Live-Seite. Teil A, Schritt 1 erneut prüfen.

---

## Teil F – Test mit drei Geräten (Spielleiter, Hannah, Jean)

Nimm drei Geräte oder drei verschiedene Browser (z. B. Chrome, Firefox und ein privates Fenster).

| # | Was du tust | Was passieren muss |
|---|---|---|
| 1 | Seite ohne Anmeldung öffnen | Startseite „Welcome to APEX“ mit Kartenbild und Knopf **Join Campaign** |
| 2 | **Join Campaign** | „Who are you?“ mit GM, Hannah, Jean, Simon, Jerba; Simon und Jerba „Not activated yet“ |
| 3 | Profil **Hannah** wählen, aber **Jeans** Adresse eingeben | neutraler Hinweis, **keine** E-Mail kommt an, keine Adresse wird angezeigt |
| 4 | Gerät 1: **GM** mit deiner Adresse + Code | Spielleiter-Ansicht mit ganzer Karte |
| 5 | Gerät 2: **Hannah** mit ihrer Adresse + Code | „Playing as Sinna“, oben grün „Live“ |
| 6 | Gerät 3: **Jean** mit seiner Adresse + Code | „Playing as Aster“ |
| 7 | Hannah zieht Sinna | Bei GM und Jean bewegt sich Sinna **ohne Neuladen** (1–2 Sekunden) |
| 8 | Hannah versucht, Aster zu ziehen | geht nicht |
| 9 | GM klickt **Begin Night 1** | Bei beiden Spielern wird es Nacht |
| 10 | Irgendeinen Browser neu laden | gleicher Spielstand, gleiches Profil |
| 11 | Hannah: WLAN kurz aus, Jean zieht, WLAN wieder an | rotes Hinweisband, danach automatisch aktueller Stand |
| 12 | GM → **Profiles** → bei Jean **Unlink** | Jean kommt nicht mehr ins Profil (Meldung „Wrong profile“); danach wieder **Save** mit seiner Adresse |
| 13 | **Sign out** | zurück zu „Continue as …“ |

Wenn etwas nicht klappt: Teil A wiederholen und die Antwort von `?op=health` notieren (sie enthält keine Geheimnisse).

---

## Teil G – Neue Spieler später einladen

1. Als Spielleiter anmelden → rechts **Players & Access** → **Profiles**.
2. Beim Profil (z. B. **Simon**) die E-Mail-Adresse eintragen → **Save**.
3. Der Person sagen: „Öffne APEX → Join Campaign → wähle dein Profil → gib deine E-Mail ein, du bekommst einen Code.“

Für Personen ohne eigenes Profil gibt es weiterhin **Accounts → Invite a person**.

Zugang entziehen: In der Liste beim Konto auf **✕** klicken – die Person kommt sofort nicht mehr ins Spiel.

## Notfall: zurück zur alten Version
Vercel → **Deployments** → eine ältere Version mit „Ready“ → **⋯** → **Promote to Production**.
Der Spielstand in Supabase bleibt dabei erhalten (Sicherungen: *Players & Access → Backups*).

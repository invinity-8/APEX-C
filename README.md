# APEX – Interactive Arena

Webbasierte Spielleiter-Plattform für eine D&D-Kampagne in einer magischen Arena des Römischen Reichs.
Version **0.1 – Phase 1 (Demo-Harness)**: läuft komplett im Browser, ohne Backend.

> ⚠️ **Demo-Modus:** Der Spielstand liegt im `localStorage` deines Browsers. Der Wechsel zwischen
> Spielleiter- und Spieleransicht ist ein **Testwerkzeug**, kein Schutz – wer am selben Browser sitzt,
> kann alles sehen. Echter Mehrspieler-Betrieb kommt in Phase 2 (siehe [`docs/SUPABASE.md`](docs/SUPABASE.md)).

---

## 1. Lokal starten

**Einmalig:** [Node.js](https://nodejs.org) installieren – Version **22 LTS** (oder ≥ 20.19).
Prüfen im Terminal: `node -v`

```bash
cd apex            # in den Projektordner wechseln
npm install        # Abhängigkeiten laden (einmalig, ~30 Sekunden)
npm run dev        # Entwicklungsserver starten
```

Dann im Browser öffnen: **http://localhost:5173**
Beenden mit `Strg + C` im Terminal.

| Befehl | Was er tut |
|---|---|
| `npm run dev` | Startet die App mit Live-Neuladen beim Bearbeiten |
| `npm test` | Führt alle automatischen Tests aus |
| `npm run build` | Prüft Typen und baut die fertige Version nach `dist/` |
| `npm run preview` | Zeigt die gebaute Version lokal an (http://localhost:4173) |

---

## 2. Kurzanleitung zum Spielen

1. **Figur wählen:** in der Gruppenliste rechts oder direkt auf der Karte anklicken.
2. **Ziehen:** Erreichbare Felder sind golden umrandet. Fährst du mit der Maus über ein Feld, siehst du Weg und Kosten. Klick = ziehen.
   Unerreichbare Ziele werden erklärt (Wasser, zu wenig BP, unerforscht …).
3. **Tag beenden** (nur Spielleiter, goldener Button oben): Bewegungspunkte werden zurückgesetzt, Events lösen aus, die Arena schrumpft.
4. **Rolle wechseln:** oben rechts *Spielleiter* ↔ *Spieler* und im Auswahlfeld die Figur, aus deren Sicht du spielst.
5. **Karte:** Mausrad oder Pinch = Zoom, Ziehen = verschieben, ⬡ = ganze Arena, `Esc` = Auswahl aufheben.
6. **Speichern** passiert automatisch. ⤓ Export / ⤒ Import sichern den Spielstand als JSON-Datei, ↺ setzt die Demo zurück.

**Spielleiter-Werkzeuge** (rechts, nur in GM-Ansicht): Bewegungspunkte, BP pro Tag, Sichtweite und
temporären Sichtbonus (z. B. „Turm bestiegen“) ändern, Figuren **frei platzieren**, Steuerrechte vergeben,
Wissensteilung ein/aus, Rivalen *verbergen/enthüllen*, **Tracking** (ungefähr/genau), Events auslösen,
Orte freigeben, Tag korrigieren, Schrumpfung konfigurieren, Gruppensicht einblenden, neue Arena erzeugen.

---

## 3. Architektur in einem Satz

**Alle Regeln stecken in reinen TypeScript-Funktionen (`src/game/`), die Oberfläche (`src/components/`) zeigt nur
eine gefilterte Ansicht an und schickt „Commands“ – dadurch lassen sich Regeln leicht ändern und später auf einen Server verlegen.**

```
src/
├─ game/                 ← Spiellogik, ohne React, vollständig getestet
│  ├─ hex.ts             Axiale Hex-Koordinaten: Nachbarn, Distanz, Ringe, Pixel
│  ├─ terrain.ts         Geländetypen, Kosten, Farben   ← Regeln hier anpassen
│  ├─ types.ts           Zentrale GameState-Struktur (Teams, Orte, Events, Inventar, Willenskraft …)
│  ├─ mapgen.ts          Deterministische Arena-Generierung (Seed)
│  ├─ movement.ts        Wegfindung (Dijkstra) & erreichbare Felder
│  ├─ visibility.ts      Fog of War, Wissen, buildPlayerView()/buildGmView()
│  ├─ zone.ts            Schrumpfende Arena
│  ├─ day.ts             Tageswechsel
│  ├─ events.ts          Event-Effekte
│  ├─ commands.ts        ★ Einzige Stelle, die den Spielstand ändert (inkl. Rechteprüfung)
│  └─ viewRules.ts       Bewegungsvorschau für die Oberfläche (nur auf Basis der Ansicht)
├─ data/demo.ts          Demo-Kampagne: Figuren, Teams, Orte, Events, Startwerte
├─ state/
│  ├─ useGame.ts         React-Hook: hält Spielstand, führt Commands aus, speichert
│  └─ storage.ts         localStorage, JSON-Export/-Import
├─ components/           Oberfläche (Header, Karte, Panels, Log)
│  └─ map/               SVG-Hex-Karte mit Zoom/Pan, Markern, Token-Stapeln
tests/                   Vitest: Geometrie, Generierung, Bewegung, Sicht, Tageswechsel
supabase/migrations/     Datenbank-Entwurf für Phase 2 (noch nicht aktiv)
docs/                    SUPABASE.md (Online-Konzept), WELT.md (Lore & Willenskraft)
```

**Datenfluss:** Klick → `dispatch(command)` → `executeCommand()` prüft Rechte & Regeln → neuer `GameState`
→ `buildPlayerView()` bzw. `buildGmView()` → `ViewModel` → Komponenten zeichnen.
Spieler-Komponenten sehen nie den vollen `GameState`, sondern nur ihr `ViewModel`.

**Abhängigkeiten:** nur React, Vite, Tailwind CSS, TypeScript und Vitest. Keine Datenbank, kein Docker, keine kostenpflichtigen Dienste.

### Häufige Anpassungen

| Ich möchte … | Datei |
|---|---|
| Bewegungskosten/Geländefarben ändern | `src/game/terrain.ts` |
| Start-BP, Sichtweite, Schrumpf-Zeitplan ändern | `src/data/demo.ts` → `config` |
| Figuren, Teams, Orte, Events umbenennen/ergänzen | `src/data/demo.ts` |
| Landschaft anders mischen | `src/game/mapgen.ts` (Schwellenwerte) oder im GM-Tab *Arena* einen anderen Seed |
| Neue Spielleiter-Aktion | Command in `src/game/commands.ts` ergänzen, Button in `src/components/` |

> Tipp: Nach Änderungen an `demo.ts` im Spiel auf **↺ Reset** klicken, sonst lädt der alte gespeicherte Stand.

---

## 4. Tests

```bash
npm test
```

37 Tests in 5 Dateien prüfen u. a.: 469 Felder bei Radius 12, Nachbarn/Distanz/Ringe, deterministische Karte,
Erreichbarkeit aller Felder, Geländekosten und Umwege, unpassierbares Wasser, BP-Limit, Rechte (Spieler nur eigene Figur,
GM-Befehle gesperrt), keine Bewegung durch unerforschtes Gelände, Fog-of-War-Zustände, Aufklärung entlang des Weges,
Sichtbonus, letzte Sichtung von Rivalen, verborgene Teams, Tracking ohne Geländeaufdeckung, **keine GM-Geheimnisse
in der Spieleransicht**, Tageswechsel, Events, Schrumpfzone.

Zusätzlich wurde die Oberfläche in Chrome durchgeklickt (Auswählen, Ziehen, ungültiges Ziel, Tag beenden,
Rollenwechsel, Tracking, Event, Gruppensicht, Neuladen, Tablet-Breite 1024 px).
Nicht automatisiert getestet: echte Touch-Geräte (Pinch-Zoom) und Safari.

---

## 5. Auf GitHub und Vercel veröffentlichen

### GitHub (Versionierung)

1. Dein bestehendes Repository ist **https://github.com/invinity-8/APEX-C**. Lade alle Dateien aus dem vorbereiteten ZIP in das Root-Verzeichnis des Repositories hoch (ZIP vorher entpacken).
2. Alternativ kannst du den Ordner lokal mit Git übertragen:

```bash
git remote add origin https://github.com/invinity-8/APEX-C.git
git branch -M main
git push -u origin main
```

Spätere Änderungen hochladen:

```bash
git add .
git commit -m "Beschreibung der Änderung"
git push
```

### Vercel (öffentliche Website, kostenlos)

1. Auf <https://vercel.com> mit dem GitHub-Konto anmelden.
2. **Add New → Project** → das Repository `APEX-C` importieren.
3. Vercel erkennt **Vite** automatisch (Build: `npm run build`, Output: `dist`). Einfach **Deploy** klicken.
4. Nach ~1 Minute bekommst du eine Adresse wie `apex-arena.vercel.app`. Jeder `git push` aktualisiert sie automatisch.

> Achtung: Auch online bleibt v0.1 ein **Demo-Modus** – jeder Besucher hat seinen eigenen, lokalen Spielstand.
> Ein gemeinsamer Spielstand für deine Gruppe kommt mit Phase 2.

---

## 6. Was funktioniert – und was noch nicht

### ✅ Funktioniert (Phase 1)

- Sechseckige Arena aus 469 Hex-Feldern (Radius 12, im GM-Tab *Arena* zwischen 4 und 20 einstellbar), deterministisch per Seed
- 7 Geländetypen inkl. verzauberter Straßen (0,5 BP), schwierigem und unpassierbarem Gelände, Legende mit Kosten
- Zoom (Mausrad, Buttons, Pinch), Verschieben, Hover-Tooltip, Klickauswahl, Feldinformationen
- 4 Spielerfiguren, 3 Rivalenteams mit Identität, Persönlichkeit, Zielen, Strategie-Feld
- Mehrere Figuren pro Feld als gruppierter Stapel + Liste im Feld-Panel
- Bewegung per Klick mit Wegfindung, Wegvorschau, BP-Verbrauch nach Gelände, verständliche Fehlermeldungen
- Tagessystem: Anzeige, GM-Button, BP-Reset, Log/Chronik
- Fog of War mit 3 Zuständen, Sichtradius 2 (Späherin 3), GM-Sichtbonus, Aufklärung entlang des Weges,
  Wissen pro Figur, teilbar mit der Gruppe; erinnertes Gelände bleibt sichtbar
- Getrennte Teamentdeckung (aktuelle Sicht + „zuletzt gesehen“-Marker), GM kann Teams verbergen/enthüllen
- Tracking-Marker (ungefähr/genau) ohne Geländeaufdeckung
- 6 Orte (u. a. neutrales Lager *Castra Neutra*, versteckter Tempel), Sichtbarkeit pro Ort, GM-Notizen
- 3 Events (2 an Spieltage gebunden, 1 manuell), Schrumpfende Arena mit Warnung und Konsequenztext
- Rollenwechsel GM/Spieler + Spielerauswahl; Spieler bewegen nur die eigene Figur (GM kann Rechte erteilen)
- Automatisches Speichern, Wiederherstellen nach Neuladen, Reset, JSON-Export/-Import
- Datenmodelle für Inventar und Willenskraft (Anzeige im Figuren-Panel)

### ⏳ Noch nicht (bewusst)

- **Kein echter Mehrspieler-Modus**, keine Accounts, keine Synchronisation (Phase 2)
- Keine Sichtlinien (Berge/Wälder blockieren die Sicht noch nicht)
- Kein Terrain-Editor, kein Editor für Orte/Events (Daten werden in `demo.ts` gepflegt)
- Strategien der Rivalen werden gespeichert, aber noch nicht automatisch ausgeführt
- Inventar und Willenskraft werden angezeigt, aber nicht im Spiel verändert
- Kein Rückgängig-Knopf für Züge (Korrektur über „Frei platzieren“ + BP-Stepper)
- Drag-and-drop von Figuren (Klick-zum-Ziehen ist robuster und genügt für v0.1)

---

## 7. Fünf sinnvolle nächste Erweiterungen

1. **Online-Spielstand mit Supabase** (Phase 2): Magic-Link-Login, Edge Function `apply-command`,
   gefilterte `player_views` per Realtime – Entwurf liegt in `supabase/` und `docs/SUPABASE.md`.
2. **Terrain- & Orts-Editor für den GM:** Pinsel-Modus zum Umfärben von Feldern, Orte per Klick anlegen und beschreiben.
3. **Sichtlinien:** Gebirge blockieren, Wald begrenzt Sicht auf 1, Türme/Berge erhöhen sie automatisch (in `visibility.ts`).
4. **Rivalen-Automatik:** pro Tag einfache Züge nach Strategie (patrouillieren, Ressourcen suchen, fliehen, verfolgen) –
   der GM bestätigt die Vorschläge mit einem Klick.
5. **Voluntas-System spielbar machen:** Willenskraft ausgeben für +BP/+Sicht, Phiolen am *Fons Voluntatis* füllen,
   Inventar per GM-Dialog bearbeiten, Event-Editor mit eigenen Effekten.

---

## 8. Roadmap

| Phase | Inhalt | Status |
|---|---|---|
| 1 | Demo-Harness: Karte, Bewegung, Tage, Fog, Rollen, Speicherung, Tests | ✅ v0.1 |
| 2 | Supabase, Auth, sichere Rollen (RLS), Live-Sync, Vercel | 📐 Konzept |
| 3 | GM-Werkzeuge: Terrain-Editor, Events, Tracking, Camps, Sichtlinien, Schrumpfung | 🔸 teilweise vorbereitet |
| 4 | Inventar, Ressourcen, Fraktionen, Team-KI, magische Technologie | 🔸 Datenmodelle vorbereitet |

## Fehlerbehebung

- **`npm` nicht gefunden:** Node.js installieren und Terminal neu öffnen.
- **Leere Seite / alter Stand nach Code-Änderung:** In der App ↺ Reset klicken oder im Browser die Website-Daten löschen.
- **Port 5173 belegt:** `npm run dev -- --port 3000`.

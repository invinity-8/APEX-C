# APEX 0.8 – Campaign Engine

## Deutscher Implementierungs- und Prüfbericht

**Arbeitsbranch:** `feat/apex-0-8-campaign-engine-v2`
**Review:** [Draft Pull Request #39](https://github.com/invinity-8/APEX-C/pull/39)
**Ausgangspunkt:** aktueller `main` zum Start dieser Arbeit (`e9e5155`). Änderungen sind auf dem Feature-Branch gebündelt. Kein Merge nach `main`, keine Produktionsmigration und kein Produktionsdeployment.

## 1. Kampagnenarchitektur und Szenenbibliothek

APEX führt Szenendefinitionen als eigenständige, stabile Datensätze mit Kategorie, Elternbeziehung, Entwurfs-/Veröffentlichungsstand, Kartenmetadaten und optionalen Assets. Figuren- und Inventardaten bleiben im bestehenden Kampagnenmodell. Szenen- und Journalzustand werden nicht in einen großen globalen Spielzustand geschrieben.

Die Bibliothek besitzt vier getrennte Kategorien, serverseitige Suche, Sortierung, Archivfilter, begrenztes Nachladen, Status, Thumbnail, Elternort und aktive Spieler. Szenen lassen sich als Entwurf anlegen, umbenennen, privat ansehen, duplizieren, archivieren/wiederherstellen und veröffentlichen. Startervorlagen umfassen ein leeres Planetensystem, zwei Weltkarten, eine leere Hexregion sowie quadratische und hexagonale Kampfkarten. Die vorhandene Arena wird als geschützte Legacy-Region angezeigt.

## 2. GM Scene Director und Editor

Der Scene Director verbindet Bibliothek, private GM-Vorschau, eine gefilterte Vorschau für einen ausgewählten Spieler, Eltern-/Szenenverknüpfungen und Spielerzuordnungen. Vorschau und Veröffentlichung ändern keine Spielerzuweisung. Die gesamte Gruppe oder einzelne Spieler können atomar in eine veröffentlichte Szene oder ins Sanctuary wechseln. Revisionen, Idempotenz und Datenbanktransaktionen schützen vor doppelten oder konkurrierenden Transfers. Nach einer unsicheren Clientantwort kann der GM den Transfer prüfen/wiederholen.

Der gemeinsame 2D-Editor unterstützt Bildhintergründe, Quadrat-/Hexraster, Maßstab, Scroll-Pan und Zoom, Kartenmarker, Beschriftungen, POIs, Spawnpunkte, Wände, blockierte Bereiche, Terrainkosten, Links und verborgene/aufgedeckte Elemente. Welt- und Himmelskarten können Orte und Routen mit Reisezeit und Entfernung definieren. Die Himmelskarte ist eine frei verbundene 2D-Navigation, keine Orbitalphysik. Das ist ein bewusst begrenzter Szeneneditor und kein professionelles Zeichenwerkzeug.

Bilder werden auf Typ, Dateikopf, Abmessungen und Größe geprüft, verkleinert und mit Vorschaubild gespeichert. Private GM-Originale sind in getrennten privaten Buckets. Spieler erhalten ein separat erzeugtes, beschnittenes Kartenbild: nur offenbarte Rechtecke oder ausdrücklich die ganze Karte. Kurzlebige signierte URLs werden erst nach Berechtigungsprüfung erstellt.

## 3. Arena und Migration

Die neue Migration ist additiv und idempotent. Sie registriert die bestehende Arena als Region und referenziert deren vorhandenen Spielstand, statt Welt-ID, Seed, Gelände, Figuren, Fog of War, Zeit, Ereignisse oder Chronik zu regenerieren. Bestehende Arena-Tabellen und 8-MP-Regeln bleiben zuständig. Neue Spieler ohne gültige Zuordnung beginnen sicher im Sanctuary; bestehende Spieler behalten die explizite Arena-Zuweisung.

Die Migration wurde **nicht** in Supabase Main ausgeführt. Vor einem späteren Rollout müssen Migration und Anwendung gemeinsam durch eine isolierte echte PostgreSQL-/Supabase-Umgebung laufen. Ein Anwendungsrollback kann die neuen Tabellen zunächst liegen lassen. Vor einer späteren Schemaentfernung sind Szenen, Journale, Anhänge und Assets zu sichern und neue Trigger/Buckets kontrolliert zurückzubauen; bestehende Arena-Daten sind davon getrennt.

## 4. Character Sanctuary

Das Sanctuary ist die neutrale Standardansicht, wenn keine gültige aktive Szene zugewiesen ist. Sie verwendet das vorhandene Charakterporträt und lässt Charakterblatt, Inventar und übrige bestehende Widgets erreichbar. Drei eigene CSS-Atmosphären sowie vom GM geprüfte, optionale Hintergründe sind verfügbar. Die persönliche Auswahl bleibt eine UI-Präferenz. Es gibt kein 3D-, Spline- oder Blender-Laufzeitsystem.

## 5. Journale

Jeder Spieler besitzt persistente Einträge mit Titel, Markdown-Text, Datum, Ingame-Datum, Szenenverweis, Tags, Kategorie, Pin, optionalem Bild und explizitem Speichern. Suche, Kategorie-/Tagfilter, Sortierung, Löschen sowie vollständiger Markdown-Export sind umgesetzt; mit Bildern wird ein ZIP mit Markdown und Anhängen erzeugt. Die Freigabe ist ausdrücklich privat, an GM oder Partei. Private Inhalte werden weder in den gemeinsamen Spielzustand noch in Realtime-Broadcasts aufgenommen. Serverberechtigungen schützen Einträge und Bilder; die Freigabe kann jederzeit entzogen werden.

Questverwaltung, automatisierte Zusammenfassungen, NPC-Kodex und gemeinsames Partei-Journal bleiben Erweiterungen für spätere Releases.

## 6. Bewegung, Sichtbarkeit und Multiplayer

Bewegung ist pro Szeneart getrennt:

- **Celestial:** GM-gesteuerte Navigation/Verbindungen.
- **World:** Vorschläge entlang bekannter Routen; der GM bestätigt und steuert Fortschritt. Ein Vorschlag teleportiert nicht.
- **Region:** konfigurierbares Raster, Terrainkosten und explizite Stundenintervalle. Umrechnung: `Gehgeschwindigkeit in ft/Runde × 600 / 5280 / Terrainkosten` Meilen je Stunde.
- **Battle:** Raster-/Hexbewegung in Fuß je taktischer Runde von sechs Sekunden.

Bewegungsbudget ist serverautoritativ, pro Figur und Intervall über Szenenwechsel hinweg geteilt und wird nur durch ausdrückliche GM-Runden-/Stundenfortschaltung erneuert. Überlappung mit Wänden wird geometrisch geprüft. Das bestehende Arena-8-MP-System wird nicht umgerechnet oder aufgefüllt.

Jeder Spieler sieht serverseitig nur seine zugewiesene veröffentlichte Szene, freigegebene Elemente und eigene Entdeckungen. GM-Notizen, Entwürfe, verborgene Routen/Orte, Spawndefinitionen und GM-Originalbilder werden nicht an Spielerantworten ausgegeben. Alte Arena-Karteninhalte werden außerhalb der Arena aus der Spielerantwort gefiltert; Figur, Inventar und Ressourcen bleiben zugänglich. Entdeckungen sind szenenbezogen. Veraltete Bewegungen nach einem Transfer werden abgewiesen. Offline-Spieler erhalten beim erneuten Laden ihre gespeicherte Zuweisung.

Spieler können ihre eigene Figur bewegen; der GM kann Token platzieren und Runden/Stunden fortschalten. Angriffswürfe, Zauberziele, Initiative, Kampfautomatisierung und Zufallsbegegnungen sind nicht implementiert und erscheinen nicht als funktionslose Aktionen.

## 7. Integration, Performance und Rücknahme

Die Integration nutzt das bestehende Workspace, Charakter-/Inventar-Widgets, API, Sitzung, CSRF-Schutz, Realtime-Versionierung und Wiederverbindung. Persönliche Journale starten ohne zusätzliche Polling-Schleife. Szenenmetadaten und Spielerlisten werden seitenweise begrenzt; Kartenbilder und Thumbnails werden bei Bedarf geladen. Entwurfs- und Veröffentlichungsrevisionen sind unabhängig, sodass GM-Entwurfsbearbeitung keine laufende Spielerbewegung ungültig macht.

Der lokale Mockserver und In-Memory-Speicher werden nur in der isolierten Mock-Konfiguration geladen. Sie bieten keinen Fallback in Produktion. Änderung und Rückbau neuer Tabellen/Assets sind von der alten Arena getrennt; die bestehenden Regel- und Itembereiche aus APEX 0.7 wurden nicht nachgebaut.

## 8. Prüfung

Erfolgreich auf diesem Branch:

- **349 Unit-/API-Tests in 41 Dateien**.
- TypeScript- und Produktionsbuild erfolgreich.
- **52 Browserprüfungen für 0.8** gegen echte APEX-API-Handler und isolierten In-Memory-Speicher: Szenenkategorien/Vorlagen, private Karte und physisch beschnittene Spielerversion, zwei verbundene Spieler, geteilte Gruppe, Wechsel/Wiederverbindung, Erhalt des Arena-Zustands, Bewegungsbudgets, GM-Reisebestätigung, Sanctuary, private/geteilte Journale, Bilder und ZIP-Export.
- Bestehende Browserregression: 139/139 Prüfungen bestanden, einschließlich GM-Ereignisse, Ankündigungen, Weltwechsel, Archive, Charakterblatt, Inventar, Ausrüstung, Ressourcen und Workspace-Widgets.
- Alle Migrationen zweimal in flüchtigem PostgreSQL/WASM angewendet; RLS-, Deploy-, Szenen-, Bewegungs- und Reiseroutinen bestanden. Auth/Realtime und Storage-HTTP-Dienst sind in diesem WASM-Lauf gestubbt.
- Migrationsregister und `git diff --check` erfolgreich.

Diese Prüfungen sind lokale, isolierte Verifikation. Sie belegen keine Live-Supabase-, echten Storage-, Vercel-Preview- oder Produktionslastprüfung. Das Auslassen einer kostenpflichtigen Supabase-Testdatenbank spart Kosten; die produktive Supabase-Datenbank blieb unangetastet.

## 9. PR, Integration und Zukunft

Der zusammenhängende Draft-PR #39 umfasst die Fundament-, Editor-, Sanctuary/Journal- und Navigationsänderungen in einem reviewbaren Feature-Branch. Ein einzelner PR vermeidet, dass abhängige Zwischenstände in bereits gemergte Feature-Branches integriert werden. Er ist nicht automatisch gemergt. Nachfolgende technische Prüfung kann die Änderung bei Bedarf in kleinere abhängige PRs aufteilen.

Die 0.7-Arbeit war in `main` enthalten, bevor dieser Branch angelegt wurde. Inventar, Klassenfähigkeiten, Wild Shape, Sorcery Points, Händler, Loot, Ressourcen und Charakterdarstellung wurden in dieser Umsetzung nicht neu aufgebaut. Es sind keine Konflikte mit einem anderen aktiven Feature-Branch absichtlich integriert worden. Vor dem Merge sollte der GitHub-Review und der Vercel-Preview-Check abgewartet werden.

**Später:** vollständiges Kampfsystem, Angriffe/Zauber/Initiative, Begegnungsgenerator, Quest-/NPC-Kodex und automatische Recaps. Weltkarten- und Himmelskartenbilder sind GM-gesteuerte, frei zuordenbare Karten; keine komplexe neue Illustration oder physikalische Simulation.

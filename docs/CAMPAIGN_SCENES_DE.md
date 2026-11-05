# APEX 0.8 Szenenbasis

## Aktualisierung: neuer Branch und Draft-PR

**Dieser Abschnitt ersetzt den darunter dokumentierten historischen Teilstand.**
Branch: `feat/apex-0-8-campaign-engine-v2`; Draft-PR: https://github.com/invinity-8/APEX-C/pull/39. Basis: main/e9e5155. Kein Merge, keine Produktionsmigration, kein Produktionsdeployment.

Mittlerweile implementiert:

- Vier Szenenkategorien mit UUIDs, begrenzten Metadatenseiten, Suche in geladenen Einträgen, Sortierung, Archivfilter, Umbenennen, Duplizieren, Archivieren und Wiederherstellen. Die Arena bleibt eine unangetastete Legacy-Referenz.
- Karteneditor mit Quadrat-/Hexraster, Skalierung, Zoom/Scroll-Pan, verschiebbaren Markern, Beschriftungen, Spawnpunkten, Wänden/Bereichen, Szenen-Zielreferenzen und sichtbaren/verborgenen Routen mit Reisezeit. Entwurfsdaten und veröffentlichte Daten sind getrennt und revisionsgeschützt. Ein Sichtbarkeitsmodus zeigt offenbarte Elemente; er ist noch keine vollständige Spieleridentitätsvorschau.
- Atomare Zuordnung ausgewählter Spieler oder der aktiven Partei zu veröffentlichten Szenen oder Sanctuary. `apex_assign_scene` prüft GM-Rolle, Mitgliedschaften, Spawn und alle Zuordnungsrevisionen vor dem Schreiben. Idempotenz schützt wiederholte Transfers. Ein Versionsupdate nutzt die bestehenden Realtime-/Reconnect-Abläufe. Archivieren belegter Szenen wird durch einen Datenbanktrigger verhindert.
- Veraltete Arena-Bewegungen werden nach Szenenwechseln einschließlich Verlassen/Rückkehr serverseitig abgewiesen. Eigene Charakterbearbeitung bleibt möglich. Transfers verändern das Arena-JSON und damit Inventar, Ressourcen, Gelände und Fog nicht.
- Spieler erhalten serverseitig ausschließlich offenbarte Elemente ihrer veröffentlichten zugewiesenen Szene, ohne GM-Notizen, verborgene Knoten/Routen oder Spawn-Definitionen. Außerhalb der Arena wird deren Karten-/Orts-/Log-/Händler-/Loot-Information aus der Antwort entfernt. Autorisierte eigene Charakterdaten bleiben verfügbar.
- Sanctuary im bestehenden Workspace mit vorhandenem Porträt, Charakter-/Inventarzugang und drei originalen CSS-Atmosphären. Die persönliche Auswahl ist eine lokale UI-Präferenz. GM-Hintergründe und freie freigegebene Bilder fehlen noch.
- Persönliche Journale in einer separaten geschützten Tabelle mit Titel, Text, Kategorien, Tags, Datum, Ingame-Datum, Pins, explizitem Save, Versionsprüfung, Suche/Filter in geladenen Einträgen, Löschen und Markdown-Export geladener eigener Einträge. Standard privat, explizite GM-/Party-Freigabe; GM hat keinen allgemeinen Zugriff auf private Notizen. Szenenreferenzen und Bildanhänge sind noch nicht freigeschaltet. Einfache Überschriftenvorschau, vollständiger Markdowntext im Export.
- Neue Skalen sind explizit vorbereitet: GM-Navigation, Routenreise, Stundenexploration und taktische Runden. Stundenumrechnung: `speedFt × 600 / 5280 / terrainCost` Meilen/Stunde (600 Sechs-Sekunden-Runden). Keine Umrechnung der bisherigen Arena-8-MP-Regeln. Neue Bewegung ist noch nicht implementiert.

Verifikation dieses Zwischenstands: Build und 334 Tests (38 Dateien) erfolgreich. 29 isolierte Browserchecks gegen echte APEX-Handler und In-Memory-Speicher bestanden: Kartenentwurf/Spawn/Veröffentlichung, zwei live wechselnde Browser, Split-Party/Sanctuary, Wiederholung, Reconnect, unverändertes Arena-JSON, Privatsphäre und Journalpersistenz/-freigabe/-export. `dev/e2e-campaign08.cjs` benötigt den lokalen Mockserver. Playwright ist über die gebündelte Runtime verfügbar; optional `APEX_PLAYWRIGHT_MODULE` und `APEX_BROWSER_PATH` setzen.

Zusätzlich wurden alle Migrationen zweimal in isoliertem PostgreSQL/WASM angewendet und die RLS-, Deployment- und neuen Szenentransaktionsprüfungen erfolgreich ausgeführt. Auth-/Realtime-Dienste sind dabei gestubbt. `scripts/verify-db-embedded.mjs` verwendet eine flüchtige Datenbank; Testinstallation: `pnpm --dir .test-tools add --save-exact @electric-sql/pglite@0.5.15` ([API-Dokumentation](https://pglite.dev/docs/api)). CI ergänzt echte isolierte PostgreSQL-17-Tests. Das ist keine Live-Supabase-/Vercel-Verifikation.

Offen für 0.8: Uploads/Assetrechte/Thumbnails, Templates, GM-Hintergründe, Spielerbewegung/GM-Tokenplatzierung, Routenreisevorschläge/-bestätigung/-fortschritt, individuelle Exploration, vollständige Sicherheits-/Konkurrenz-/Lastabnahme und reale Preview-Verifikation. Spieler ohne Welt/Charakter verwenden bislang die bisherige Warteansicht. Erweiterte Kampf-, Zauber-, Initiative-, Zufallsbegegnungs-, Quest-/NPC-Kodex- und Zusammenfassungssysteme bleiben künftigen Releases vorbehalten.

Die noch unveröffentlichte Version-6-Migration enthält inzwischen zusätzlich Journale, Transitionsprotokoll und RPC/Archivschutz. Rollback bleibt additiv: alte Anwendung kann die neuen Tabellen ignorieren; vor deren Entfernung Daten sichern und neue Trigger entfernen. Gemeinsame Integrationspunkte: App, Online-Hook/-API, Server-API/Repository, Mock und Campaign-Widget. Keine 0.7-Regelsysteme wurden neu gebaut. Keine Produktionslastmessung; Metadatenpages sind auf 50 Zeilen, Zuordnungslisten auf 100 Spieler begrenzt. Keine neuen Polling-Loops und keine Journal-Broadcasts.

## Historischer Teilstand (vor den obigen Ergänzungen)

## Implementierungsstand, 5. November 2026

Dies ist ein Teilstand von PR 1, keine abgeschlossene APEX-0.8-Auslieferung. Arbeitsbranch: `feat/apex-0-8-campaign-engine`; Basis nach Fast-forward: `e9e5155` (main). Bereits vorhandene uncommittete Schema-/SQL-Vorarbeiten wurden erhalten. Kein Push, PR, Produktionsdeployment oder Datenbankeingriff wurde ausgeführt.

- Architektur: eigenständiger Szenenkatalog neben dem unveränderten Arena-Spielstand. Keine Änderungen an Inventar, Fähigkeiten, Ausrüstung oder Händlerregeln.
- Kategorien: Celestial, World, Region, Battle sind als Entwurf anlegbar. Die Kategorien besitzen noch keine eigenen spielbaren Kartenansichten.
- Scene Director: neuer Tab im bestehenden Campaign-Widget mit vier Kategorien, Suche in geladenen Metadaten, Entwurfserstellung und privater Vorschau der Szenendefinition. Er übernimmt Verschieben, Skalieren, Einklappen und Wiederherstellen vom vorhandenen Widget.
- Bibliothek/Editor: maximal 50 Metadaten pro API-Seite; Karteneditoren, Uploads, Templates, Duplizieren, Archivieren und Verknüpfungen fehlen noch. Die Vorschau ist keine gerenderte Karte und keine Spielerperspektive.
- Arena: additive Referenzmigration, ohne Änderung des gespeicherten Weltzustands. Laufzeit und bestehende Befehle bleiben im bisherigen Arena-Modell.
- Sanctuary und Journale: noch nicht implementiert. Das Zuordnungsschema kann Sanctuary darstellen, die Oberfläche verwendet es noch nicht.
- Bewegung: keine Änderung der vorhandenen 8-MP-Regeln. Stundenbasierte Regionenbewegung, taktische Bewegung und Routenreisen bleiben offen.
- Berechtigungen: `/api/apex?op=scenes` läuft hinter Sitzung, CSRF und Schemaverifikation. Spieler erhalten 403 vor dem Speicherzugriff. Kampagnen-ID stammt ausschließlich aus der Sitzung. Schreibanfragen dürfen nur Namen und Kategorie setzen; Entwürfe können damit weder veröffentlicht noch zur Legacy-Arena erklärt werden. Direkter Browserzugriff auf beide Tabellen wird durch RLS und entzogene Rechte gesperrt.
- Multiplayer: Spielerzuordnung, atomare Übergänge, Spawnpunkte, eigene Szenenpositionen, Szenen-Fog, Reconnect und Sperren veralteter Aktionen fehlen. Deshalb existiert noch keine Aktivierungsschaltfläche.
- Performance: begrenzte, deterministisch sortierte Katalogseiten; keine neuen Polling-Loops, keine Journale oder privaten Szenen in gemeinsamen Broadcasts. Bestehendes Datenbank-Timeout und Request-Messung werden genutzt. Keine Lasttest- oder Produktionsmesswerte erhoben.
- Migration: `20261105120000_apex_scene_foundation.sql` ist vorbereitet, nicht angewendet. Schema-Vertrag auf Version 6 angehoben. Anwendung und Migration müssen vor einem Deployment gemeinsam geprüft werden; Version 6 blockiert Anfragen gegen eine ältere Datenbank.
- Verifikation: Produktionsbuild erfolgreich, 37 Testdateien / 329 Tests erfolgreich, Migrationsregister und `git diff --check` erfolgreich. Neue Modultests decken Rollen, fremde Kampagnen, validierte Erstellung und Pagination ab; API-Tests prüfen Sitzung und CSRF. Datenbanktests sind vorbereitet, aber nicht ausgeführt. PostgreSQL/Docker und Playwright sind lokal nicht verfügbar; Browser-, Live-Supabase- und Vercel-Tests stehen aus. Der vollständige 25-Punkte-Abnahmekatalog ist nicht erfüllt.
- Pull Requests: noch keine angelegt. Vorgesehene Reihenfolge bleibt PR 1 (Basis, main), PR 2 (Editoren, PR-1-Branch), PR 3 (Sanctuary/Journale, PR-2-Branch), PR 4 (Navigation, PR-3-Branch). Nach jedem Merge die nächste PR auf main umbasieren, keine bereits gemergten Feature-Branches weiterverwenden.
- Integration: main enthielt inzwischen die 0.7-Abschlüsse und `APEX_08_HANDOVER.md`. Fast-forward und Wiederherstellung der Vorarbeiten liefen ohne Konflikte. Gemeinsame Integrationspunkte sind `App.tsx`, Online-API und Server-Repository/API; vor einem späteren Push erneut mit main abgleichen.
- Zukunft: vollständige Kampfautomatisierung, Zauber, Initiative, Zufallsbegegnungen, Quest-/NPC-Kodex und automatische Zusammenfassungen bleiben außerhalb 0.8. Die noch offenen oben genannten 0.8-Funktionen sind davon getrennte Pflichtarbeit.

## API dieses Teilstands

`GET /api/apex?op=scenes&offset=0` liefert GM-Metadaten und `nextOffset`. `GET /api/apex?op=scenes&id=<uuid>` liefert eine GM-interne Szenendefinition. `POST /api/apex?op=scenes` erwartet `{ name, category }` und legt einen Entwurf an. Weder GET noch POST verändert Spielerzuordnungen oder den Arena-Spielstand. Suche im UI gilt nur für bereits geladene Seiten.

Die Migration registriert pro Kampagne eine veröffentlichte Region Map namens Arena. Diese Szene verweist über die Kampagnen-ID auf den bestehenden Arena-Spielstand. Welt-ID, Seed, Gelände, Positionen, Fog of War und Ereignisse liegen weiterhin im bestehenden Spielstand. Snapshots, Archive und Befehle verwenden weiterhin ihre bisherigen Tabellen. Neue Kampagnen erhalten die Arena-Referenz über einen Trigger.

Die Szenentabelle kennt die Kategorien Celestial, World, Region und Battle. Zuordnungen verweisen über Kampagnen-ID und Szenen-ID auf eine Szene derselben Kampagne. Für die spätere Laufzeitintegration bedeutet eine fehlende Zuordnung die bisherige Arena und eine explizite leere Szenen-ID Sanctuary. Beide Tabellen sind ausschließlich für den Server vorgesehen. GM- und Spielerberechtigungen müssen zusätzlich in der späteren API durchgesetzt werden.

## Prüfung und Wiederherstellung

Die Migration zuerst in einer isolierten PostgreSQL-15- oder neueren Umgebung mit `scripts/verify-db-local.sh` prüfen. Der Testlauf wendet die Migrationen zweimal an. Die Szenentests prüfen den Backfill, die Registrierung neuer Kampagnen, direkten Tabellenzugriff und kampagnenübergreifende Zuordnungen.

Bei einem Rollback der Anwendung können die zusätzlichen Tabellen liegen bleiben. Die Migration schreibt keine vorhandenen Arena-Spielstände um. Vor einer späteren Entfernung der Tabellen Szenendefinitionen und Zuordnungen sichern und den Trigger auf Kampagnen entfernen. Das Entfernen der Tabellen gehört in eine eigene geprüfte Migration.

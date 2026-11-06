# APEX 0.9 – Implementierungsstatus und Handover

Stand: 2026-11-06
Produktionsbasis: `df8090fad406677f26830952861c7b092f4beff0`; PRs #41–#47 sind gemergt.
Abschlussbranch: `feat/apex-09-closeout` (auf aktuellem `origin/main`).
Keine Produktionsmigration, Daten-/Storageänderung, automatische Merge- oder Production-Deployment-Aktion durchgeführt.

## Implementiert und automatisiert geprüft

- **PR #47 Journalreferenzen:** People-/Places-Ziele werden als UUID-Referenzen gespeichert; die Zielauflösung läuft durch sichtbarkeitsgeprüfte Journal-Leseoperationen.
- **Journal-Backlinks (dieser Branch):** Rückverweise kommen nicht mehr nur aus der sichtbaren Journal-Liste. Neuer Server-/Store-Pfad filtert dieselbe Kampagne nach Benutzer- und Rollenfreigabe und liefert Seiten mit 50 Einträgen. UI erlaubt „Load older backlinks“. Invalid UUIDs und fehlende Seiten werden abgewiesen. Regressionstest ergänzt.
- **TypeScript-Konfiguration (dieser Branch):** globale `types`-Liste entfernt, Vite-Client-Typen via `src/vite-env.d.ts` auf den Client begrenzt. Lokaler TypeScript-/Produktionsbuild und aktueller Vercel-Preview-Build bestehen. Der Preview-API-Endpunkt antwortet mit HTTP 200 und bestätigt Version `0.9.0` sowie den aktuellen PR-Commit. Production wurde nicht neu bereitgestellt.
- **APEX-Version:** Frontend, API und Paketversion sind für den Releasekandidaten auf `0.9.0` angehoben; Versionssynchronität ist durch `tests/foundation.test.ts` abgesichert.
- **Versatile-Griff:** Handwechsel ist jetzt eine autorisierte `setWeaponGrip`-Aktion auf dem Charakter. Die serverseitige Regel akzeptiert nur eine ausgerüstete vielseitige Waffe mit gültigem Zweithand-Schadenswürfel; Zweihandgriff räumt den Nebenhandslot frei und die abgeleitete Angriffsübersicht zeigt den alternativen Würfel. Beim Zurückschalten wird Nebenhandausrüstung nicht automatisch wieder angelegt. Unit-/Validierungstests ergänzt; Browser-/Live-Roundtrip bleibt offen.
- **Automatisierte Ergebnisse:** lokal bestanden: Migration Guard (12 registrierte, keine pending), 45 Testdateien / 376 Tests, TypeScript und Produktionsbuild. PR-CI Run `42270359126` auf Head `b0def743dd81b7779f8e1e65dfab60787524d740` bestand Migration Guard, Gesamttests, TypeScript/Build und isolierte Migration-/RLS-/Scene-Transaktionschecks; der Production-DB-Job wurde übersprungen. Danach folgte nur diese Dokumentationskorrektur.
- **Produktionsstatus der Ausgangsbasis:** read-only `/api/apex?op=health` HTTP 200 mit `ok: true`, schemaVersion 6, migrationsComplete true und leeren Missing-/Unknown-/Error-Listen; Vercel Deployment für `df8090f` meldete READY. Das belegt den Ausgangsstand, nicht die Änderungen dieses Branches.

## Bereits gemergte Funktionen – Code vorhanden; Browserabnahme offen

- **Character/Spells-Navigation (#44):** Character Overview und separater Spellbook-Einstieg, keine doppelte Journal-Navigation.
- **Map Campaign Director (#45):** GM-Fokus, Spielerzuweisung und Sanctuary-Transfer als getrennte Aktionen; Server prüft Szenenzugriff und Player-Szenenausgabe.
- **Kenney 2.5D (#46):** optionale Darstellung, Classic-Fallback, Allowlist, private Assets und kurze signierte URLs. Keine neue Assetkopie hochgeladen.
- **Szeneneditor:** Bibliothek, Draft, privater Preview, Speichern und Publish mit separatem `published_metadata`/`published_revision`. Veröffentlichte Karten können spielersichere abgeleitete Bilder erzeugen.
- **Inventar/Equipment/Loot/Händler:** Basisaktionen, Freigabeanfragen, Mengen-/Gewicht-/Besitzregeln, Loot und minimierbare Loot-Präsentation sind im Code und durch Unit-/API-/SQL-Prüfungen abgedeckt.

## Teilweise implementiert

- **Fog / Map-Kontrollen:** Sichtbare Kartenbereiche und GM-only Quellbilder existieren. Szenegebundene Event-, Loot- und Encounter-Kontrollen sind nicht in den Map-Fokus integriert.
- **Zauber / Charakter / Ressourcen:** Spell-Daten haben Grundfelder. Strukturierte Spell-Details, Klassen-/Preparation-Regeln, vollständige Slot- und Ressourcenquelle sowie sichere Cast-Aktionen (einschließlich Mage Armor mit Ablauf/Stacking) fehlen.
- **Ausrüstung:** AC-/Gewichtsregeln sowie servervalidierter Versatile-Griff und zugehöriger abgeleiteter Schadenswürfel sind implementiert. Es gibt weiterhin keinen vollständigen Angriffs-/Würfelwurf-Workflow, der Angriff, Ziel und Trefferauflösung verbindet.
- **Encumbrance-Bewegung:** Lastzustand wird berechnet/gezeigt. Aktuelle Spielregel dokumentiert ausdrücklich keine automatische Bewegungssperre; GM entscheidet über Folgen. Keine gegenteilige Sperre wurde hinzugefügt.
- **Journal-Kontinuität:** People/Places und Szenenreferenz/In-game-Date-Feld bestehen. Backlinks sind jetzt paginiert; referenzierte Charakter-/Szenenobjekte mit typisierten Feldern sind darüber hinaus nicht umgesetzt.

## Nicht verifiziert / blockiert

- **GM-/Player-Browserabnahme:** nicht durchgeführt. Der isolierte Harness (`vite.mock.config.ts`, MemoryRepo) ist vorhanden, aber `playwright` fehlt in dieser Arbeitsumgebung. Der aktuelle Vercel-Preview liefert die Version `0.9.0` für den PR-Commit; das ersetzt keinen Rollen-/Kampagnenablauf. Keine Produktionsdaten wurden verwendet.
- **Isolierte DB-Prüfung:** lokal nicht ausgeführt; PR-CI Run `42270359126` hat Migrationen, RLS, Scene runtime/motion/travel und Post-deploy SQL gegen Wegwerf-Postgres erfolgreich geprüft.
- **Production:** keine neue Production-Bereitstellung. Der aktuelle Vercel-Preview wurde als Preview für den PR-Commit geprüft; er wurde nicht promoted.
- **Kenney visuell/Performance:** keine Classic-/2.5D-Screenshots und keine 39-/78-Radius-Metriken erhoben.
- **Live-Status:** die aktuellen Codeänderungen dieses Branches sind weder gemergt noch live; nur die oben benannte `df8090f`-Produktionsbasis ist live verifiziert.

## Priorisierte offene Abnahme- und Implementierungsaufgaben

| Priorität | Restpunkt | Abnahmekriterium |
|---|---|---|
| P0 | Isolierte Rollen-Browserabnahme nach Bereitstellung eines erreichbaren, kostenneutralen Playwright-/Browser-Testtreibers | GM, zwei Player, Caster und Non-caster; Scene-Draft/Publish/Assignment/Sanctuary; Journal private/GM/party; Berechtigungsablehnungen; Reconnect/Reload; keine doppelten Aktionen; Screenshots und Testdaten nur lokal isoliert |
| P0 | Isolierte SQL-CI für den Closeout-Head | Erledigt: Head `b0def743dd81b7779f8e1e65dfab60787524d740` bestand Run `42270359126` mit Migration Guard, RLS, Scene runtime/motion/travel und Post-deploy checks gegen Wegwerf-Postgres; Production-DB-Job übersprungen |
| P1 | Reguläre Production-Abnahme nach Merge | Erst nach Owner-Merge und planmäßiger Release-Pipeline Produktions-Health und Function-Verarbeitung erneut kontrollieren; kein Production-Deployment wurde ausgeführt |
| P1 | Szenegebundene GM-Kontrollen | Fokus-Szene zeigt Fog, Events, Loot und Encounter; Draft bleibt privat; Apply/Publish ist explizit; Player erhält ausschließlich freigegebene Szene/Informationen |
| P1 | Zauber- und Character-Regelmodell | Lizenziertes Spell-Datenmodell, Klassen/Vorbereitung/Slots; Mage Armor sicher castbar mit Dauer/Ablauf/Stacking; Ressourcenverbrauch, AC und Character-Ansicht haben je eine Quelle; Positiv-/Negativtests |
| P1 | Versatile-Kampfgriff-Abnahme | Unit-/Parser-Regeln sind vorhanden; GM-/Player-Browser-Roundtrip mit konkurrierenden Änderungen, Reload und explizitem Wiederausrüsten des Schilds prüfen. Ein vollständiger Angriffs-/Trefferwurf-Workflow existiert außerhalb dieses 0.9-Korrekturschritts nicht. |
| P1 | Inventar-/Merchant-/Loot-Browser-Roundtrip | Antrag → Bearbeitung → approve/reject → Aufnahme → stack/split → equip/drop/move → Reload; Gewicht, Besitz, Währung, Mengen und Idempotenz stimmen; mehrere Items sowie minimierte Loot-Anzeige |
| P1 | Kenney-Visual- und Performanceabnahme | gleiche Mock-Szene/Kamera und Netzwerkbedingungen für Classic/2.5D, Radius 39 und 78; Screenshots, Latenz, Downloadbytes, Ladezeit, Reaktionszeit, Renderdauer; keine Asset-Uploads |
| P2 | Cube-Progression-Regelentscheidung | Der bestehende Vertrag gewährt Zugang durch Cube oder GM-Permanentfreigabe, aber keine Progressionsstufen. Nur bei neuer verbindlicher Regelanforderung erweitern |

## Kosten, Daten und Release-Status

- Es wurde keine Supabase-Testdatenbank oder kostenpflichtige Ressource angelegt.
- Keine Produktionsmigration, kein Produktions-Storage-Upload oder produktiver Schreibzugriff.
- Vercel-Preview für den geprüften PR-Commit `d8b3c27c48b37cd89f516a62f5e3a0a5fd036914` ist `READY`; `/api/apex?op=version` antwortet mit HTTP 200, `0.9.0`, Branch `feat/apex-09-closeout` und PR `48`. Keine Production-Bereitstellung, Promotion oder PR-Merge.
- Keine Migration in diesem Branch: Journal-Backlinks verwenden vorhandene Journalfelder; TS-Konfiguration ist build-only.
- **Freigabe:** APEX 0.9 noch nicht als vollständig finalabgenommen bezeichnen. Branch, Preview und aktuelle isolierte SQL-CI sind bereit; Rollenbrowserabnahme und die in der Matrix benannten P1-Funktions-/Visualnachweise bleiben offen.

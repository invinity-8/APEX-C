# APEX 0.9 – Implementierungsstatus und Handover

Stand: 2026-11-06  
Main: ccb08da73278502067ad94e21998b3ec019e59cd (PRs #44–#46 gemergt)  
PR #47: feat/apex-09-journal-references, offen; sein Konflikt betrifft dieses Dokument. Der folgende Status trennt main vom noch offenen PR.

## Implementiert und getestet

- **Character/Spells-Navigation (main, PR #44):** Character landet auf Overview; Spellbook ist aus der Character-Untermenüleiste entfernt und bleibt im Top-Level Spells. Doppelte Journal-Widgets sind entfernt; Journal hat einen Haupteinstieg.
- **Map Campaign Director (main, PR #45):** GM-Fokus auf veröffentlichte Szenen, unabhängig von Spielerzuweisungen; explizite Zuweisung/Transfers und Sanctuary. Player-Runtime gibt nur die für den Spieler autorisierte Szene aus.
- **Kenney 2.5D Vorschau (main, PR #46):** optionale Classic/2.5D-Darstellung für Forest-Szenen; feste Asset-Allowlist, serverseitige 60-Sekunden-Signaturen aus dem privaten Bucket und Rollen-/Szenenchecks. Classic bleibt Fallback.
- **CI für PRs #44–#46:** jeweilige GitHub-Workflows erfolgreich: Migration Guard, Gesamttests, TypeScript/Production-Build und isolierte Migration/RLS/Scene-Checks. Produktiver Deployment-Check wurde für PR-Jobs übersprungen.

## Integriert in PR #47, noch nicht in main

- **People/Places-Journals:** explizite Referenzseiten werden als Journal-Einträge der Kategorien People oder Places angelegt. Einfügen speichert nur [[ref:UUID]]. Der Titel wird nur aus zugänglichen Einträgen aufgelöst; nicht lesbare oder fehlende Einträge zeigen keine vertraulichen Titel. Einzelaufrufe nutzen JournalStore.get und dessen Sichtbarkeitsfilter.
- Backlinks werden aus aktuell geladenen Einträgen gebildet; ältere Seiten zählen erst nach „Load older entries“.
- Tests des früheren PR-#47-Kopfs 49e5eed bestanden den gesamten Workflow. Der neue Merge-Kandidat aus main muss nach Konfliktauflösung erneut geprüft werden.
- Noch nicht in main, bis PR #47 gemergt ist. Keine Migration erforderlich.

## Implementiert, aber nicht produktions- oder rollenbrowserverifiziert

- Merge #44–#46 hat die Änderungssets auf main gebracht; CI/Preview ist keine Produktions- oder GM-/Player-Abnahme.
- Die APEX Preview-Einstiegsseite lädt. Ein angemeldeter Kampagnenlauf wurde ausgelassen, weil die Preview auf reale Kampagnendaten zeigen könnte.
- 2.5D-Kartenrendering mit echter Forest-Szene, Screenshotvergleich und Messungen für Radius 39/78 sind nicht nachgewiesen.

## Teilweise implementiert

- **Scenes:** Bibliothek, vier Kategorien, Vorbereitung, Preview, Editor, Forest-Generator, Upload, Undo und Publishing-Basics sind vorhanden. Vollständige Draft/Save/Publish/Live-Trennung und direkte Map-Kontrollen für Fog, Events, Encounter und Loot fehlen.
- **Character/Rules:** Sheet, Import, History und Fähigkeiten existieren. Abgeleitete Werte und synchronisierte Ressourcen sind nicht über alle Ausrüstungs-/Leveländerungen vereinheitlicht.
- **Spellbook:** Top-Level und grundlegende Datenfelder sind da. Strukturierte Details, lizenzierte Referenzauflösung, Klassen-/Vorbereitungsregeln, Slots sowie abgesicherte Casting-Effekte fehlen.
- **Inventory/Equipment:** Kernfunktionen und Tests sind vorhanden; vielseitige Waffen, Encumbrance-Bewegungsfolgen, Legacy-Kompatibilität sowie durchgehende Roundtrips brauchen Abnahme.
- **Journal:** Speichern, Versionierung, Suche, Kategorien, Tags, Pins, Freigabe, Szenenverweis und Export sind in main. People/Places-Links hängen an PR #47. Charakter-/NPC-/Ingame-Kontinuitätsfelder fehlen.
- **Realtime/Permissions:** Serverautorität und SQL-/API-Tests bestehen; Reconnect, Rollenwechsel und Datenschutz wurden nicht komplett im Browser durchgespielt.

## Fehlend oder gezielt zurückgestellt

- **Fehlend:** Rollenbasierte Browser-/E2E-Abnahme als GM, normaler Player, Caster und Non-caster mit isolierter Testkampagne.
- **Fehlend:** identische Classic-/2.5D-Screenshots und Performancewerte (Netzwerkbytes, Ladezeit, Reaktionszeit, Renderdauer) für Radius 39 und 78.
- **Zurückgestellt:** vollständiges Spell-Regelwerk/klassenabhängige Vorbereitung, bis die lizenzierte Quelle und verbindliche Regelentscheidungen feststehen.
- **Zurückgestellt:** vollständige abgeleitete Character- und Weapon-Engine einschließlich Cube-Progression und aller temporären Effekte; erfordert ein gemeinsames Regelmodell und Regressionstests.
- **Zurückgestellt:** Journal-Referenzen für Charaktere, Szenen, Ingame-Daten und Backlinks über alle paginierten Einträge; PR #47 deckt People/Places und geladene Einträge ab.

## Priorisierte Restarbeit mit Abnahmekriterien

| Priorität | Arbeit | Abhängigkeit / Orte | Abnahmekriterium | Aufwand |
|---|---|---|---|---|
| P0 | PR #47 integrieren und Status-/Auditunterlagen reconciliieren | PR #47; docs/audits | Konflikt gelöst, latest main als Branch-Parent integriert, People/Places-Code erhalten, Branch-Workflow grün und PR mergebar | Klein |
| P0 | Rollenbasierte End-to-End-Abnahme | geschützte isolierte Preview, Map/Scenes/Character/Spells/Journal | GM, Player, Caster und Non-caster; Wechsel/Refresh/Reconnect; private Journals und fremde Szenen bleiben unsichtbar | Groß |
| P1 | Fog/Live-Scene Controls und Draft/Publish-Klarheit | CampaignMapDirector, SceneDirector, sceneRuntime | GM steuert Sichtbarkeit und passende Events/Loot/Encounter am Fokus; private Draft-Änderung ändert veröffentlichte Player-Szene erst nach Apply/Publish | Groß |
| P1 | 2.5D Visuelle/Performanceabnahme | SceneSurface, Kenney-API, isolierte Forest-Szene | Screenshotpaar gleicher Szene/Kamera; 39/78 Messwerte; Token-/Grid-/Movement-/Visibility unverändert; Classic-Fallback funktioniert | Mittel |
| P1 | Spell-/Character-Regelmodell | sheet.ts, abilities.ts, equipment.ts, Spellbook | lizenzierte Details; Klassenregel für Preparation; Slots/Ressourcen single-source; AC/Stats/Weapon changes propagieren und testen | Groß |
| P1 | Inventory/Equipment Konsistenz | inventory.ts, equipment.ts, Merchant, Loot | weapon/equipment/weight/currency/approval roundtrip; legacy items und movement encumbrance bleiben korrekt | Groß |
| P2 | Journal Continuity über People/Places hinaus | journals.ts, PlayerJournal.tsx | referenzierte Scene/Character/Datefelder; backlinks über pagination; Sharing/Privacy-Negativtests | Mittel |
| P2 | Events, Merchant, Loot und Reconnect Browserabnahme | GM panels, events, items, online sync | GM-Aktion erscheint nur bei berechtigtem Player; wiederholte Requests erzeugen keine Duplikate | Mittel |

## Produktionsdaten und Kosten

Read-only Abfrage im aktuellen Produktionsprojekt bestätigt schema_version 6, erwartete Migrationseinträge bis 20261106100000 und den privaten Storage-Bucket apex-asset-packs. Für Konfliktlösung und PR #47 wurde keine Migration, kein Produktionsschreibzugriff und keine Bucket-/Objektänderung ausgeführt. Kenney-Spriteabrufe nutzen existierende Storage-Bandbreite; es wurden keine Image Transformations oder zusätzliche Datenbanken eingerichtet.

## Releaseentscheidung

APEX 0.9 ist bereit für die **gezielte Finaltestphase**, aber nicht für eine abschließende Produktionsabnahme. Erst PR #47 integrieren, dann die oben genannten P0-Browserabläufe ausführen. Keine automatische Merge- oder Deploymentaktion.

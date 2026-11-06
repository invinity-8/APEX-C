# APEX 0.9 – Funktionsabgleich

Stand: 2026-11-06  
Geprüfter Stand: main nach Merge #44, #45 und #46 (Commit ccb08da73278502067ad94e21998b3ec019e59cd). Zusätzlich wurde der PR-#47-Branch mit den expliziten Journal-Referenzen verglichen.  
Methode: Code, Tests, Migrationsdateien, PR-Verläufe und read-only Produktionsabfragen. Rollen-Browserflows wurden nicht mit echten Kampagnenkonten ausgeführt.

## Kurzbefund

- Die Navigation zwischen Character und Spells ist in main korrigiert. Das Journal hat eine eigene Hauptnavigation; die doppelten Journal-Workspace-Einstiege sind entfernt.
- Der Map-Tab hat nun einen separaten GM-Fokus, der Spielerzuweisungen nicht automatisch verändert. Ausgewählte Transfers und Sanctuary sind eigene, serverautorisierte Aktionen.
- Die Kenney-Vorschau ist im Map-Renderer implementiert. Sie verwendet eine kleine Sprite-Auswahl aus dem existierenden privaten Bucket und kurzlebige signierte URLs. Ein angemeldeter Kartenlauf, Screenshotvergleich und Performancewerte sind noch nicht browserverifiziert.
- PR #47 ergänzt People-/Places-Referenzen in Journal-Einträgen. Die Links speichern IDs; sichtbare Titel werden nur aus für den Nutzer lesbaren Einträgen aufgelöst. Der PR bleibt bis zur Konfliktauflösung und Integration in main offen.
- Die Produktionsabfragen dieses Durchlaufs sind read-only: Schema-Version 6; die letzten registrierten Migrationen sind 20261104220752, 20261105120000 und 20261106100000. Bucket apex-asset-packs ist weiterhin privat. Keine Produktionsänderung wurde vorgenommen.

## Abgleichsmatrix

| Bereich | Status | Ist-Verhalten / Beleg | Verbleibende Arbeit und Abnahme |
|---|---|---|---|
| Authentifizierung | Implementiert und getestet | Serverseitige Session, Rollen aus Profil, CSRF und Berechtigungsprüfungen in auth.ts/api.ts; Tests vorhanden | GM-/Player-Browserlauf mit isolierten Testkonten; kein Zugriff auf echte Kampagne für Abnahmetests |
| Kampagnenverwaltung | Teilweise implementiert | Kampagnenstatus und Weltenverwaltung vorhanden; Szenen und Legacy-Arena laufen teils über getrennte Abläufe | Ein Kampagnen-Dashboard, das Welt, Szenenfokus und Sanctuary zeigt; Reload/Reconnect ohne falsche Zuweisung |
| Map / Szenennavigation | Implementiert und CI-getestet | PR #45: veröffentlichter GM-Fokus, Such-/Wechselkontrolle, Zuweisungen und explizite Sanctuary-Transfers; SceneRuntime begrenzt Spieler auf ihre Szene | Rollen-Browserlauf sowie Fog-/Events-/Loot-/Encounter-Kontrollen im fokussierten Map-Modus |
| Szenenbibliothek und Editor | Teilweise implementiert | Vier Kategorien, Bibliothek, Suche, Vorschau, Editor, Generator, Uploads und Undo vorhanden | Draft, gespeicherte Änderungen und veröffentlichte Live-Version in der UI eindeutig unterscheiden; Draft-Änderung darf Player-Ansicht nicht verändern |
| Sanctuary / Downtime | Implementiert, Map-Integration teilweise | Sanctuary-Einstellungen und Zuweisungs-API existieren | GM muss aus Map sehen können, wer in Sanctuary ist, und Szenenwechsel direkt auslösen; geprüfter Split-Party-Browserlauf |
| Character | Routing implementiert und CI-getestet; Regelmodell teilweise | PR #44: Character startet auf Overview; redundanter Spellbook-Untertab entfernt | Abgeleitete Werte und Ressourcenquelle vereinheitlichen; Equipment-/Leveländerungen müssen AC, Stats und Character-Ansicht konsistent aktualisieren |
| Spells | Teilweise; Detailmodell fehlt | Top-Level-Spells öffnet den Spellbook. Bestehende Felder enthalten grundlegende Spell-Daten | Strukturierte Schule, Zeit, Reichweite, Komponenten, Dauer, Konzentration, Ritual, Klassenregeln, Vorbereitung und Slots aus einer autoritativen, lizenzierten Quelle; unbekannte Beschreibungen klar markieren |
| Fähigkeiten / Effekte | Teilweise implementiert | Klassenfähigkeiten und unterstützte Effekte existieren getrennt von einem umfassenden Spell-/Character-Regelmodell | Nur dokumentierte Effekte wie Mage Armor mit Ablauf, Stackregeln und Ressourcenverbrauch integrieren; Regel- und Negativtests |
| Ressourcen | Teilweise implementiert | Ressourcen leben teils im GameState und teils im CharacterSheet | Eine autoritative Quelle pro Ressource; Änderungen müssen Widget, Character und Verbrauchspfad konsistent halten |
| Inventar | Kernpfade implementiert und getestet | PR #42: Items, Anfragen, Gewicht und Freigabepfade vorhanden | Legacy-Items, Carry-Movement-Penalties und tatsächliche Player-Interaktion durchspielen |
| Ausrüstung / Waffen | Teilweise implementiert | Equipment und Armory vorhanden; Tests für Ausrüstungsregeln | Waffenaktionen und vielseitige Waffen mit Charakterwerten/Inventar verbinden; AC-/Gewichts-/Auswirkungsregressionen testen |
| Handel / Merchant | Implementiert, End-to-End nicht verifiziert | Merchant-Regeln und UI vorhanden | Isolierter Kauf/Verkauf/Gold-/Gewichts-/Freigabe-Roundtrip mit Retry prüfen |
| Loot | Teilweise implementiert | Loot-Rolls und Party-Loot-Logik vorhanden | Mehrfachitem-Verteilung, Empfänger, Inventar/Currency-Übergang und Wiederverbindung browserseitig verifizieren |
| Journal | Grundfunktion implementiert; Referenzen in PR #47 | Hauptnavigation, private/GM/Party-Freigabe, Suche, Tags, Pins, Versionen und Export in main. PR #47 fügt explizite People/Places-Einträge, IDs, sichtbarkeitsgeprüfte Auflösung und Backlinks hinzu | PR #47 integrieren. Backlinks umfassen aktuell nur geladene Seiten; Continuity zu Szene/Charakter/Datum bleibt offen. Privacy und Save/Reopen im Browser testen |
| GM-Werkzeuge | Teilweise implementiert | GM-Panel, Player-Management, Events und Scene Director vorhanden | Map-Fokus, Sichtbarkeit, Events, Announcements, Loot und Encounter mit der aktiven Szene zusammenführen, ohne private Drafts zu veröffentlichen |
| Events / Ankündigungen | Implementiert, UI-Integration teilweise | Events und Announcements besitzen Komponenten und API-/Unit-Tests | Direkter Fokusbezug und Reconnect als GM und Player prüfen |
| Workspace-Widgets | Implementiert und getestet | Layout-/Widget-Logik vorhanden; Journal-Duplikate entfernt | Gespeicherte Layouts über Rollen- und App-Upgrade-Abnahme prüfen |
| Feedback | Implementiert, E2E offen | Reporter-, Inbox- und Statuspfade vorhanden | Reporter → GM-Triage → geteilte Antwort in Preview als getrennte Rollen abnehmen |
| Weltarchive | Implementiert, E2E offen | Archive-/Restore-Pfade und Migrationstests vorhanden | Restore in isolierter Kampagne mit Character- und Scene-Kontinuität abnehmen |
| Berechtigungen / Datenschutz | Implementiert und mit API-/SQL-Tests abgesichert | Spieler-Scene-Filter, Journal-Visibility-Store und RLS-/Scene-SQL-Checks vorhanden; PR #46 signiert nur feste Assetpfade nach Szenenprüfung | Gezielte Negativtests für geteilte/versteckte Journal-Referenzen und Rollenbrowserlauf |
| Multiplayer / Synchronisierung | Teilweise browserverifiziert | Versionierte Writes, Scene motion und Realtime-/Polling-Pfade vorhanden | GM/Player reconnecten; prüfen, dass Zuweisungen und veröffentlichter Stand erhalten bleiben und kleine Aktionen keine Refresh-Stürme auslösen |
| Kenney / 2.5D | Renderer implementiert und CI-getestet, Produktion nicht visuell abgenommen | PR #46: Classic/2.5D-Schalter, fixe Asset-Allowlist, private signed URLs, Zugriff auf veröffentlichte bzw. zugewiesene Szene | Angemeldete Preview, gleiche Kamera/Szene als Screenshotpaar; Ladezeit, Bytes, Eingabereaktion und Rendering bei Radius 39 und 78 messen |

## Produktions- und Migrationsstand (read-only)

- apex_schema_info meldet schema_version 6.
- Migrationseinträge enthalten 20261104220752 add_apex_agent_asset_pack_catalog, 20261105120000 apex_scene_foundation und 20261106100000 apex_asset_pack_storage_state.
- apex-asset-packs ist privat. Für diesen PR wurde weder die DB noch Storage verändert.
- Test-/Migrationsworkflow verwendet isoliertes Postgres; produktive Verifikation läuft nicht als PR-Job.

## Nicht als abgeschlossen werten

CI-Erfolg belegt Tests und Build des jeweiligen Commitstands, nicht echte Produktions- oder Rollen-Browserabnahme. Insbesondere bleiben Spell-Detailregeln, Draft/Live-Abnahme, Map-Operationskontrollen und Performance/Screenshotprüfung offen.

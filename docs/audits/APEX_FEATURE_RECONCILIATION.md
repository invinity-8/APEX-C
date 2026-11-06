# APEX-Funktionsabgleich

**Stand:** 2026-11-06  
**Geprüfter Ausgangspunkt:** GitHub `main`, nach Merge von PR #43 (Commit `61a4c9886f85db73bbc6f094269f5786c82dc18c`).  
**Prüfmethode:** Repository-Dateien, Releases/Handovers, PRs #41–43, Migrationsdateien, bestehende Vitest/API/SQL-Tests sowie read-only Abfragen gegen APEX MAIN. Dies ist eine evidenzbasierte Bestandsaufnahme, kein Ersatz für den noch ausstehenden Rollen-Browserlauf.

## Wichtigste Befunde

1. Die Navigation ließ den gespeicherten Charakter-Tab auch im Charakter-Hauptbereich gelten. Wer zuletzt den Spellbook-Tab nutzte, konnte daher beim Öffnen von **Character** erneut den Spellbook sehen. Die Character-Seite landet jetzt explizit auf **Overview**; der Spellbook-Untertab ist aus der Character-Navigation entfernt, und die Top-Level-Seite **Spells** öffnet ihn weiterhin.
2. Das Journal hatte bereits einen persistenten API-/DB-Workflow (Suche, Kategorien, Tags, Pin, Versionskonflikte, Export und private/GM/Party-Freigabe), war aber nur in einem Map-Workspace-Widget erreichbar. Es ist nun eine eigene Hauptnavigation. Die parallelen GM-/Spieler-Widgets wurden entfernt, damit es einen eindeutigen Einstieg gibt.
3. Die Szenenbibliothek und der 2D-Editor sind vorhanden, aber der Map-Tab ist noch nicht der vollständige Campaign Director aus APEX 0.9: ein eindeutiger GM-Fokus unabhängig von Spielerzuweisungen sowie ein direkter Map-zu-Map-Szenenwechsel fehlen als geschlossener Workflow. Die Szenenbibliothek verwaltet Spielerzuweisungen getrennt, zeigt private Vorschau und bietet Sanctuary-Transfer.
4. Das Spell-Modell ist weiterhin dünn: Name, Level, vorbereitet, Quelle und Notizen. Es gibt keine gemeinsamen strukturierten Details für Schule, Reichweite, Komponenten, Konzentration, Rituale oder Klassenregeln. #43 stellt die Seite bereit, erfüllt aber die Spell-Detail-/Vorbereitungszusagen nicht.
5. Die Kenney-Bibliothek ist vorhanden, wird aber nicht gerendert. Read-only Produktionsprüfung am Bucket `apex-asset-packs`: **6.557 Objekte**, Bucket privat; Stichproben zeigen Isometric-PNGs und FBX-Modelle. Die Live-Dateien werden durch diese Arbeit weder kopiert noch öffentlich gemacht. Eine sichere, autorisierte Asset-Auslieferung und ein klassischer/2.5D-Vergleich fehlen weiterhin.
6. Der frühere Schema-Alarm ist im aktuellen Datenbankstand nicht mehr vorhanden: `apex_schema_info.schema_version = 6`; die Migrationen `20261105120000` und `20261106100000` sind in `supabase_migrations.schema_migrations` registriert. Die Repository-Datei `supabase/remote_history.txt` war hinter diesem Ist-Stand. Dieser Branch ergänzt die beiden fehlenden Einträge; es wurde keine Migration ausgeführt.

## Abgleichsmatrix

| Bereich | Einstufung | Implementierung / Evidenz | Lücke, Schweregrad und erforderlicher Fix | Testabdeckung |
|---|---|---|---|---|
| Authentifizierung | Implementiert; Kernpfad verifiziert | `src/server/auth.ts`, `src/server/api.ts`, `src/online/useOnlineGame.ts`; serverseitige Session, CSRF/Origin und Rollen | Rollenbasierter Browserlauf (GM/Spieler) wiederholen; **Mittel** | Auth-/API-Tests; keine Browserabnahme in dieser Runde |
| Kampagnenverwaltung | Teilweise | `src/server/scenes.ts`, `src/server/sceneRuntime.ts`, `src/components/WorldPanel.tsx` | World, Szene, Legacy-Arena und aktuelle GM-Fokusszene in einem konsistenten Dashboard verbinden; **Hoch** | `tests/scenes.test.ts`, `tests/campaign08Api.test.ts` |
| Szenennavigation | Teilweise | `src/components/SceneDirector.tsx`, `src/components/PlayerScene.tsx`; getrennte Zuweisungen und private Player-Preview | Direkter Map-Switch und eigener GM-Fokus unabhängig von Spielerzuweisungen; **Hoch** | `tests/sceneRules08.test.ts`, `tests/scenes.test.ts`, Supabase scene SQL checks |
| Szeneneditor | Teilweise | `src/components/SceneMapEditor.tsx`, `src/campaign/maps.ts`; Terrain, Generator, Upload, Layer-/Marker-Metadaten, Undo | Draft, gespeicherter Entwurf und veröffentlichte/live Version durchgängig erklären und testen; Editoroberfläche auf Editor-Einstieg abstimmen; **Hoch** | `tests/forestGenerator.test.ts`, `tests/scenes.test.ts` |
| Sanctuary | Implementiert, Integration teilweise | `src/server/sanctuary.ts`, `src/components/SanctuarySettings.tsx` | Map-Kontrollzentrum muss Sanctuary-Zustand plus Wiederaufnahme/Wechsel direkt anbieten; **Mittel** | Scene travel SQL/API checks |
| Charakterseite | Teilweise; Routingfehler behoben | `src/App.tsx`, `src/components/CharacterPanel.tsx` | Freitext-Sheet ist kein regelberechnetes Charaktermodell; Attributes/Features und abgeleitete Werte mit Import abgleichen; **Hoch** | `tests/sheet.test.ts`, `tests/character07.test.ts` |
| Spellbook | Teilweise | `src/game/sheet.ts`, `src/components/CharacterPanel.tsx`; bisher nur grundlegende Spellfelder | Strukturierte, lizenzierte Details, Auflösung fehlender Beschreibung, Klassen-/Vorbereitungsregeln und Zauberplätze aus einer Quelle; **Hoch** | Sheet-Tests; keine Abdeckung für vollständige Casting-Regeln |
| Klassenfähigkeiten | Teilweise | `src/components/ClassAbilities.tsx`, `src/game/abilities.ts` | Bestehende Fähigkeitssysteme mit Sheet-Import und Spell/Resource-Modell abgleichen; **Mittel** | `tests/abilities07.test.ts`, `tests/abilitiesApi07.test.ts` |
| Ressourcen | Teilweise | Ressourcen in `GameState` und `CharacterSheet`; Widget in `ResourceOrbs.tsx` | Festlegen, welche Ressource autoritativ ist; Sheet-Ressourcen und Kampagnenressourcen dürfen nicht doppelt oder still auseinanderlaufen; **Hoch** | `tests/resources.test.ts`, `tests/sheet.test.ts` |
| Inventar | Implementiert, Tests vorhanden | `src/game/inventory.ts`, `src/components/InventoryPanel.tsx`; sichere Item-Requests aus #42 | Legacy-Fälle, Traglaststrafe und tatsächliche Browserinteraktion abschließen; **Mittel** | `tests/inventory06.test.ts`, `tests/weight07.test.ts`, `tests/itemRequests.test.ts` |
| Itemisierung / Ausrüstung | Teilweise | `src/game/items/*`, `src/game/equipment.ts`, `src/components/EquipmentPanel.tsx` | Waffeninteraktion und vielseitige Waffen durchgängige Spieler- und Regelpfade; **Hoch** | `tests/equipment.test.ts`, `tests/armory07.test.ts` |
| Handel / Merchant | Implementiert, End-to-End ungeprüft | `src/game/items/merchant.ts`, `src/components/Merchant.tsx` | Mit Inventory, Gewicht, Currency und GM-Approval browserseitig verifizieren; **Mittel** | `tests/merchant07.test.ts` |
| Loot-Verteilung | Teilweise | `src/game/items/partyLoot.ts`, `src/components/LootRolls.tsx`; #43 minimiert Roll-Dock | Vollständiger Mehr-Item-Ablauf/Animation und Inventarübergang; **Mittel** | `tests/partyLoot07.test.ts`, `tests/partyLootApi07.test.ts` |
| Journals | Backend vorhanden; Hauptnavigation ergänzt | `src/server/journals.ts`, `src/server/journalImages.ts`, `src/components/PlayerJournal.tsx` | Personen/Orte-Referenzen, Backlinks und Continuity-Felder fehlen; Sichtbarkeit noch je Rolle im Browser nachweisen; **Mittel** | `tests/journals.test.ts`, `tests/journalZip.test.ts` |
| GM-Werkzeuge | Teilweise | `src/components/GmPanel.tsx`, `src/components/PlayersPanel.tsx`, `src/components/SceneDirector.tsx` | Map-Operationskontrollen und Szene-Edits/Live-Status deutlicher integrieren; **Hoch** | Server-/API- und scene SQL checks |
| Events / Ankündigungen | Implementiert, live ungeprüft | `src/game/events.ts`, `src/components/GmEvents.tsx`, `src/components/AnnouncementOverlay.tsx` | GM- und Spieler-Browserablauf einschließlich Wiederverbindung bestätigen; **Mittel** | `tests/events.test.ts`, `tests/announcements07.test.ts` |
| Workspace-Widgets | Implementiert | `src/workspace/Workspace.tsx`, `src/workspace/layout.ts`, `src/workspace/WidgetTabs.tsx` | Rollenwechsel und Auflösung/Erhalt gespeicherter Layouts testen; redundantes Journal-Widget entfernt | `tests/workspace.test.ts`, `tests/workspace07.test.ts` |
| Feedback | Implementiert, Ende-zu-Ende ungeprüft | `src/components/Feedback.tsx`, `src/server/api.ts`, Migration `20261104090000` | Browserflow Reporter → GM-Triage wiederholen; **Niedrig** | API/Server-Tests |
| Weltarchive | Implementiert | `src/components/WorldPanel.tsx`, Migration `20261101202637` | Restore/Archiv/Characters continuity in isolierter Kampagne testen; **Mittel** | Welt-/Migrationstests |
| Berechtigungen | Implementiert mit Tests | `src/server/validate.ts`, `src/server/api.ts`, `src/game/visibility.ts` | Negative RLS-/player-scene/asset/journal Tests nach nächster Änderung erneut laufen lassen; **Hoch** | `supabase/tests/rls_check.sql`, `supabase/tests/scene_travel_check.sql`, `tests/visibility.test.ts` |
| Multiplayer-Synchronisierung | Implementiert, Produktionspfad nicht browserverifiziert | `src/online/useOnlineGame.ts`, `src/server/api.ts`, Supabase Realtime | Reconnect und kleiner UI-Update ohne volle Refresh-/Polling-Stürme messen; **Hoch** | Server-/stability tests; kein erfolgreicher Rollen-Browserlauf in dieser Runde |
| Asset library / Kenney 2.5D | Assetdaten verifiziert; Renderer geplant | Private Supabase Storage `apex-asset-packs`, `src/server/sceneAssets.ts` (nur Szenenbilder) | Manifest/Allowlist, server-signierte Assets, Sprite-Renderer, Classic-Schalter und Screenshot-/FPS-Messung fehlen; **Hoch** | Bucket-/Objektzählung read-only; noch keine Renderer-Tests |

## Verifizierte Produktionsdaten (read-only)

- APEX MAIN Projekt `xqkyaqxuoaxadpkcdhch`: Schema-Version **6**.
- Registrierte letzte Migrationen: `20261104220752 add_apex_agent_asset_pack_catalog`, `20261105120000 apex_scene_foundation`, `20261106100000 apex_asset_pack_storage_state`.
- Bucket `apex-asset-packs` ist **privat**; Anzahl: **6.557 Objekte**. Stichproben bestätigen Kenney-Isometric-PNGs und Kenney-Modell-Dateien; es wurden keine Objekte heruntergeladen oder verändert.
- Die Supabase-Speicheranleitung bestätigt, dass private Buckets RLS oder zeitlich begrenzte signierte URLs verlangen. APEX muss die Berechtigung serverseitig prüfen, bevor es Asset-URLs ausgibt.

## In diesem Branch umgesetzt

- Character-Seite startet ausdrücklich auf Overview; Spellbook-Tab aus Character-Navigation entfernt.
- Journal hat einen dedizierten Top-Level-Einstieg; doppelte Map-Widgets entfernt.
- `supabase/remote_history.txt` gleicht die zwei bereits im Produktionsverlauf sichtbaren Migrationen ab.

## Nicht als erledigt gewertet

Keine Browser-Rollenabnahme, kein echtes 2.5D-Rendering, kein Spell-Regelwerk, kein Map-GM-Fokus-Workflow, kein vollständiger Draft/Publish-Abnahmelauf. Diese Punkte erhalten erst nach Implementierung und Verifikation den Status „vollständig“.

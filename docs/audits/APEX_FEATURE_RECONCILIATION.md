# APEX 0.9 – Funktionsabgleich

Stand: 2026-11-06
Geprüfter Ausgangsstand: `main` / Production `df8090fad406677f26830952861c7b092f4beff0` (PRs #41–#47 gemergt).
Abschlussbranch: `feat/apex-09-closeout`, abgeleitet von diesem `main`.
Methode: Code- und Testabgleich, Migration Guard, vollständige lokale Tests, TypeScript, Produktionsbuild sowie read-only Health-/Deploymentprüfung. Keine Produktionsdaten wurden geschrieben. Der vorhandene Browser-Harness verwendet MemoryRepo; die Playwright-Abhängigkeit ist in dieser Arbeitsumgebung nicht vorhanden und der isolierte Browser konnte `localhost:5174` nicht erreichen. Daher ist kein GM-/Player-Browserlauf behauptet.

## Live- und Merge-Status

- PRs #41–#47 sind gemergt. PR #47 ist kein offener Merge-Kandidat; es wird kein Ersatz dafür eröffnet.
- Der auslösende Stand `df8090f` ist als Vercel-Production-Deployment `READY` bestätigt. `/api/apex?op=health` lieferte HTTP 200, `ok: true`, Schema 6, vollständige Migrationen und keine Fehler. Die bestätigten Migrationszeilen enden bei `20261106100000`; `apex-asset-packs` ist privat.
- Der zuvor abgewiesene Preview-Build war ein Vercel-Tageskontingentlimit (`api-deployments-free-per-day`), kein Datenbank- oder Migrationfehler.
- Im erfolgreichen Function-Build der Produktionsbasis meldete Vercel TS2688 für `node` und `vite/client`. Der Branch entfernt die globale `types`-Liste und referenziert Vite-Client-Typen nur im Client-Quellbaum. Der automatisch von GitHub/Vercel erzeugte Preview-Build dieses Commits ist `READY`; seine Function-Verarbeitung enthält keine TS2688-Meldungen. Production wurde nicht neu bereitgestellt.

## Akzeptanzmatrix

| Anforderung | Umsetzung im aktuellen Code | Prüfbeleg / Status | Verbleibendes Abnahmekriterium |
|---|---|---|---|
| Map-/Szenenfokus bleibt getrennt von Spielerzuweisungen und Sanctuary | Getrennte Aktionen und serverseitige Rechte-/Szenenprüfungen; unverändert aus gemergtem `main` | Unit-/API-Tests in Gesamtsuite bestanden; **Browser nicht geprüft** | GM und zwei Spieler wechseln Fokus, Zuweisung und Sanctuary getrennt; Reload/Reconnect bewahren jede Auswahl |
| Draft, Vorschau, Speichern, Veröffentlichen und Live-Szene sind unterscheidbar | Bibliothek markiert Draft/Published; Editor speichert Draft-Metadaten separat von `published_metadata`; Publish aktualisiert veröffentlichte Revision, ohne Spieler zu verschieben | `tests/scenes.test.ts`; **Browser nicht geprüft** | Draftänderung beeinflusst Player-Ausgabe nicht vor Publish; veröffentlichte Revision erscheint nach Apply/Reload bei berechtigten Spielern |
| Fog / Sichtbarkeit | Editor kann sichtbare Bereiche markieren; Publish erzeugt eine separate spielersichere Karte, private Quellkarte bleibt GM-only | SQL-/Scene-Checks im CI des gemergten Pakets; in diesem Branch keine DB-Migration; **Browser nicht geprüft** | Screenshot und API-Negativtest: private Quell-URL und verdeckte Pixel/Objekte sind für Spieler unzugänglich |
| Events, Loot und Encounter an aktive Szene binden | Diese Oberflächen/Serverpfade bestehen getrennt; keine vollständige Szene-zu-Event/Loot/Encounter-Zuordnung gefunden | Codeabgleich, kein End-to-End-Beleg | P1 offen: GM wählt fokussierte Szene, veröffentlicht passende Kontrolle, Player erhält nur erlaubte Inhalte; Retry/Reconnect ohne Duplikate |
| People/Places-Journalverweise und Privatsphäre | Marker speichert Ziel-ID; Titelauflösung nutzt zugriffskontrollierte Einzelleseoperationen | PR #47 gemergt; Journal-/API-Tests bestanden | Rollen-Browser-Negativtest für private, fremde und gelöschte Referenzen |
| Journal-Backlinks über Seiten hinweg | Neu: eigener Store/API-Pfad, Filterung nach Kampagne und sichtbaren Einträgen, UUID-sicheres Suchen, 50er Pagination in UI | Neue Regression in `tests/journals.test.ts`; vollständige Suite bestanden. **Produktive Supabase-Query nicht live ausgeführt** | Preview-/isolierte-DB-Abnahme mit >50 Rückverweisen und privaten Negativfällen |
| Zauberdetails, Vorbereitung und Casting | Spell-Objekt enthält Grundfelder (Name, Level, Prepared, Source, Notes); keine vollständigen strukturierten Detail-/Klassenregeln oder abgesicherte Mage-Armor-Cast-Aktion | Codeabgleich; aktuell kein entsprechender Regeltest | P1 offen: lizenzierte kanonische Quelle festlegen; Details, Klassen/Vorbereitung/Slots, Ressourcenverbrauch, Ablauf/Stackregeln und sichere Zauberaktion mit Positiv-/Negativtests |
| Character/Ressourcen/AC und Ausrüstung | Sheet, Ausrüstung, AC-/Weight-Ansichten und Ressourcen existieren, aber keine einheitliche Regelquelle über alle Änderungswege | Bestehende Unit-Tests; E2E nicht geprüft | P1 offen: eine Quelle pro Wert; Equipment-/Level-/Temporäreffekt-Roundtrips aktualisieren Character, AC und Ressourcen konsistent |
| Versatile-Griff | Basiswaffen enthalten Versatile-Eigenschaft und zweiten Schadenswürfeltext; kein Griffwechsel bzw. Auswirkung auf Kampfangriff in der Engine gefunden | Codeabgleich | P1 offen: 1-/2-Hand-Modus, Handbelegung und gewählter Würfel müssen in UI und servervalidiertem Angriff übereinstimmen |
| Überlast und Bewegung | Traglast/Encumbrance wird angezeigt. Die veröffentlichte Regel sagt ausdrücklich, Bewegung wird nicht automatisch blockiert; Speed-Folge bleibt GM-Entscheidung | `docs/game/INVENTORY_WEIGHT.md`; Gewichtstests; E2E nicht geprüft | Regelentscheidung im Produkt bestätigen. Bis dahin keine neue Bewegungssperre als angebliche bestehende Regel dokumentieren |
| Cube-Progression | Imperial Transmutation Cube entsperrt Zugang; dokumentierte Regel bietet Inventargegenstand oder GM-grantierten permanenten Zugriff, keine Stufenprogression | `docs/game/ITEMIZATION_BALANCE.md` §13 und Itemtests | Keine Code-Lücke gemäß aktuellem Paketvertrag. Falls Progression gemeint ist, braucht es eine konkrete freigegebene Regelquelle/Abnahmespezifikation |
| Inventar/Beute/Händler-Roundtrips | Anfragen, GM-Freigabe, Inventar, Gewicht, Items, Händler und Loot-Presentation sind implementiert; idempotente Commands existieren | Migrations-/Unit-Tests grün; Browser-Paket nicht gestartet | P1 Abnahme mit GM/Player: beantragen, editieren, approve/reject, aufnehmen, stacken, splitten, equip/drop/move/reload, Mehrfachloot und minimierte Anzeige; Mengen/Besitz/Retry prüfen |
| Kenney 2.5D | Optionaler Renderer, Classic-Fallback, feste Allowlist, private Storage und kurzlebige signierte URLs | Code-/CI-Beleg auf gemergtem Stand; Vercel Production healthy; **keine visuelle/Performanceabnahme** | Identische isolierte Forest-Szene/Kamera; Screenshots Classic/2.5D; Radius 39/78 mit Latenz, Bytes, Load-, Input- und Renderdauer protokollieren; keine Asset-Uploads |
| Vercel Function TypeScript TS2688 | Root-weite explizite Typnamensauflistung entfernt, Vite-Client-Referenz nach `src/vite-env.d.ts` verschoben | Lokaler TypeScript-/Production build grün; Vercel Preview `READY`, Function-Logs ohne TS2688 | Production wurde absichtlich nicht neu bereitgestellt; nach Owner-Merge kontrolliert über reguläre Release-Pipeline abnehmen |

## Lokale automatisierte Prüfung dieses Branches

- `pnpm run check:migrations`: bestanden; 12 Produktionsmigrationen registriert, keine pending Migration.
- `pnpm run test`: bestanden, 45 Dateien / 374 Tests.
- `pnpm run typecheck`: bestanden.
- `pnpm run build`: bestanden. Bestehende Warnungen: Vite-native-config Import-Erweiterungen und Client-Chunks über 500 kB.
- Isolierte Postgres-Migrations-/RLS-/Scene-Transaktionsprüfung: noch nicht lokal ausgeführt; muss der CI-Job nach Push übernehmen.
- Echter GM-/Player-Browserlauf: nicht bestanden/nicht gelaufen, weil der Harness-Playwright-Treiber fehlt und der verfügbare Browser die lokale Mock-URL nicht erreichen kann. Kein Ergebnis daraus wird als Abnahme gewertet.
- PR-CI Run `42261845098` (Commit `5c8bc77`): Migration Guard, Gesamttests, TypeScript/Build und isolierte Migration-/RLS-/Scene-Transaktionschecks bestanden. Der production-db-Deployment-Job ist korrekt übersprungen; es gab keinen Produktionsschreibzugriff.

## Abschlussentscheidung

Die Produktionsbasis ist gesund und PR #47 ist bereits Teil davon. Dieser Closeout behebt eine konkrete paginierte Journal-Lücke; der TS2688-Fix ist im Vercel Preview bestätigt. Die isolierten Migration-/RLS-/Scene-Prüfungen des PR-CI sind grün. APEX 0.9 ist **noch nicht für die abschließende Abnahme freigegeben**: Rollen-Browserabnahme und die oben benannten P1-Regel-/Szenenintegrationen bleiben offen. Es wurde keine neue Migration vorbereitet, da die Änderungen keine Datenbankschemaänderung benötigen.

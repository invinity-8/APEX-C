# APEX 0.9 – Implementierungsstatus und Handover

Stand: 2026-11-06
Produktionsbasis: `df8090fad406677f26830952861c7b092f4beff0`; PRs #41–#47 sind gemergt.
Abschlussbranch: `feat/apex-09-closeout`; PR #48 offen als Draft.
Keine Produktionsmigration, Daten-/Storageänderung, automatische Merge- oder Production-Deployment-Aktion durchgeführt.

## Implementiert und automatisiert geprüft

- **PR #47 Journalreferenzen:** People-/Places-Ziele werden als UUID-Referenzen gespeichert; die Zielauflösung läuft durch sichtbarkeitsgeprüfte Journal-Leseoperationen.
- **Journal-Backlinks (dieser Branch):** Rückverweise kommen nicht mehr nur aus der sichtbaren Journal-Liste. Neuer Server-/Store-Pfad filtert dieselbe Kampagne nach Benutzer- und Rollenfreigabe und liefert Seiten mit 50 Einträgen. UI erlaubt „Load older backlinks“. Invalid UUIDs und fehlende Seiten werden abgewiesen. Regressionstest ergänzt.
- **TypeScript-Konfiguration (dieser Branch):** globale `types`-Liste entfernt, Vite-Client-Typen via `src/vite-env.d.ts` auf den Client begrenzt. Lokaler TypeScript-/Produktionsbuild und GitHub-CI sind grün. Der jüngste verifizierte Vercel-Preview-Build ist Commit `d8a5a91aa50a6505de16452612a6f2b7131a9705`; sein Versionsendpunkt antwortete HTTP 200 für `0.9.0` und PR #48. Der aktuelle Head `2e0097139558036d0afd7dcaa05cb36fe44afdc1` konnte wegen Vercels kostenlosem täglichem Build-Limit nicht neu gebaut werden. Production wurde nicht neu bereitgestellt.
- **APEX-Version:** Frontend, API und Paketversion sind für den Releasekandidaten auf `0.9.0` angehoben; Versionssynchronität ist durch `tests/foundation.test.ts` abgesichert.
- **Versatile-Griff:** Handwechsel ist jetzt eine autorisierte `setWeaponGrip`-Aktion auf dem Charakter. Die serverseitige Regel akzeptiert nur eine ausgerüstete vielseitige Waffe mit gültigem Zweithand-Schadenswürfel; Zweihandgriff räumt den Nebenhandslot frei und die abgeleitete Angriffsübersicht zeigt den alternativen Würfel. Beim Zurückschalten wird Nebenhandausrüstung nicht automatisch wieder angelegt. Unit-/Validierungstests ergänzt; Browser-/Live-Roundtrip bleibt offen.
- **Mage Armor:** gezielte servervalidierte Cast-Aktion; Spell muss bekannt und vorbereitet sein, genau ein Level-1-Slot muss verfügbar sein und die Figur darf keine aktive Körperrüstung tragen. Der Server zieht einen Slot ab und speichert einen 8-Stunden-Effekt in der bestehenden Sheet-JSON-Spalte. Recast ersetzt den eigenen Effekt (kein Stapeln). Der Ausrüstungsweg markiert Rüstung anlegen; der Effekt endet dann und lebt nach Doffen nicht wieder auf. AC nutzt währenddessen Basis 13 + GE-Bonus; Schild-/Itemboni bleiben nachvollziehbar. Save/Import kann Effekte nicht erzeugen oder verlängern. Kein Schema-/Produktionsmigrationsschritt.
- **Belastung und Bewegung (dieser Branch):** gemeinsame Last-/Bewegungsberechnung berücksichtigt Präzisionsgewicht, Gold, Bag of Holding, aktive Ausrüstung und deren Traglast-/Geschwindigkeitsboni. Variant Encumbrance reduziert die effektive Geschwindigkeit um 10/20 ft. Der Server weist Bewegung in Arena und Szenenkarten oberhalb der Traglast sowie über dem verbleibenden Bewegungsbudget ab; die eigene Player-Ansicht zeigt Restbudget und Lastzustand. Regressionstests sichern Ablehnung und unveränderte Position ab. Browser-Roundtrip und produktiver API-Ablauf bleiben offen.
- **Map-Zuweisungen (dieser Branch):** Spielerzuweisungen bleiben auch ohne gesetzten GM-Szenenfokus sichtbar und bedienbar; Sanctuary, aktueller Fokus und andere Szenen werden klar unterschieden. UI-Regressionstest ergänzt.
- **Automatisierte Ergebnisse:** lokaler Lauf bestanden: Migration Guard (12 registrierte, keine pending), 46 Testdateien / 389 Tests, TypeScript und Produktionsbuild. PR-CI Run `42275483480` (Workflow 168) auf dem vorherigen PR-Head bestand Migration Guard, Tests, TypeScript/Build sowie isolierte Migration-/RLS-/Scene-Checks. Production-DB-Job wurde übersprungen. Der Vercel-Preview-Build des damaligen Heads scheiterte am kostenlosen Tageslimit; der geprüfte Preview bleibt auf dem vorherigen Commit `d8a5a91aa50a6505de16452612a6f2b7131a9705`.
- **Produktionsstatus der Ausgangsbasis:** read-only `/api/apex?op=health` HTTP 200 mit `ok: true`, schemaVersion 6, migrationsComplete true und leeren Missing-/Unknown-/Error-Listen; Vercel Deployment für `df8090f` meldete READY. Das belegt den Ausgangsstand, nicht die Änderungen dieses Branches.

## Bereits gemergte Funktionen – Code vorhanden; Browserabnahme offen

- **Character/Spells-Navigation (#44):** Character Overview und separater Spellbook-Einstieg, keine doppelte Journal-Navigation.
- **Map Campaign Director (#45):** GM-Fokus, Spielerzuweisung und Sanctuary-Transfer als getrennte Aktionen; Server prüft Szenenzugriff und Player-Szenenausgabe.
- **Kenney 2.5D (#46):** optionale Darstellung, Classic-Fallback, Allowlist, private Assets und kurze signierte URLs. Keine neue Assetkopie hochgeladen.
- **Szeneneditor:** Bibliothek, Draft, privater Preview, Speichern und Publish mit separatem `published_metadata`/`published_revision`. Veröffentlichte Karten können spielersichere abgeleitete Bilder erzeugen.
- **Inventar/Equipment/Loot/Händler:** Basisaktionen, Freigabeanfragen, Mengen-/Gewicht-/Besitzregeln, Loot und minimierbare Loot-Präsentation sind im Code und durch Unit-/API-/SQL-Prüfungen abgedeckt.

## Teilweise implementiert

- **Fog / Map-Kontrollen:** Sichtbare Kartenbereiche und GM-only Quellbilder existieren. Szenegebundene Event-, Loot- und Encounter-Kontrollen sind nicht in den Map-Fokus integriert.
- **Zauber / Charakter / Ressourcen:** Strukturierte Referenzdetails und Mage Armor sind implementiert; alte Saves bleiben kompatibel. Mage Armor hat Dauer, Slotverbrauch, AC-Quelle und Ende bei Rüstung. Klassen-/Preparation-Regeln, eine vollständige zentrale Slotquelle und weitere sichere Cast-Aktionen fehlen.
- **Ausrüstung:** AC-/Gewichtsregeln sowie servervalidierter Versatile-Griff und zugehöriger abgeleiteter Schadenswürfel sind implementiert. Es gibt weiterhin keinen vollständigen Angriffs-/Würfelwurf-Workflow, der Angriff, Ziel und Trefferauflösung verbindet.
- **Encumbrance-Bewegung:** Lastzustand und Variant-Speed-Penalties werden angezeigt und serverseitig durchgesetzt. Bewegung oberhalb der Traglast und des reduzierten Restbudgets wird für Arena- und Szenenkarten-Commands abgewiesen. Rollenbrowser-Roundtrip, UI-Synchronisierung nach Inventaränderungen und Produktions-API bleiben nicht verifiziert.
- **Journal-Kontinuität:** People/Places und Szenenreferenz/In-game-Date-Feld bestehen. Backlinks sind jetzt paginiert; referenzierte Charakter-/Szenenobjekte mit typisierten Feldern sind darüber hinaus nicht umgesetzt.

## Nicht verifiziert / blockiert

- **GM-/Player-Browserabnahme:** nicht durchgeführt. Der isolierte Harness (`vite.mock.config.ts`, MemoryRepo) ist vorhanden, aber `playwright` fehlt in dieser Arbeitsumgebung. Der Versionsendpunkt des geprüften Preview-Commits `d8a5a91aa50a6505de16452612a6f2b7131a9705` antwortete HTTP 200; das ersetzt keinen Rollen-/Kampagnenablauf und ist nicht der aktuelle Branch-Head. Keine Produktionsdaten wurden verwendet.
- **Isolierte DB-Prüfung:** lokal nicht ausgeführt; PR-CI Run `42270359126` hat Migrationen, RLS, Scene runtime/motion/travel und Post-deploy SQL gegen Wegwerf-Postgres erfolgreich geprüft.
- **Production:** keine neue Production-Bereitstellung. Der aktuelle Vercel-Preview wurde als Preview für den PR-Commit geprüft; er wurde nicht promoted.
- **Kenney visuell/Performance:** keine Classic-/2.5D-Screenshots und keine 39-/78-Radius-Metriken erhoben.
- **Live-Status:** die aktuellen Codeänderungen dieses Branches sind weder gemergt noch live; nur die oben benannte `df8090f`-Produktionsbasis ist live verifiziert.

## Priorisierte offene Abnahme- und Implementierungsaufgaben

| Priorität | Restpunkt | Abnahmekriterium |
|---|---|---|
| P0 | Isolierte Rollen-Browserabnahme nach Bereitstellung eines erreichbaren, kostenneutralen Playwright-/Browser-Testtreibers | GM, zwei Player, Caster und Non-caster; Scene-Draft/Publish/Assignment/Sanctuary; Journal private/GM/party; Berechtigungsablehnungen; Reconnect/Reload; keine doppelten Aktionen; Screenshots und Testdaten nur lokal isoliert |
| P1 | Reguläre Production-Abnahme nach Merge | Erst nach Owner-Merge und planmäßiger Release-Pipeline Produktions-Health und Function-Verarbeitung erneut kontrollieren; kein Production-Deployment wurde ausgeführt |
| P1 | Szenegebundene GM-Kontrollen | Fokus-Szene zeigt Fog, Events, Loot und Encounter; Draft bleibt privat; Apply/Publish ist explizit; Player erhält ausschließlich freigegebene Szene/Informationen |
| P1 | Zauber- und Character-Regelmodell | Lizenzierte kanonische Quelle sowie Klassen-/Vorbereitungsregeln festlegen; weitere Zauber sicher casten; Slotquelle, AC und Character-Ansicht über alle Änderungen konsistent halten; isolierte Browser-Roundtrips ergänzen |
| P1 | Versatile-Kampfgriff-Abnahme | Unit-/Parser-Regeln sind vorhanden; GM-/Player-Browser-Roundtrip mit konkurrierenden Änderungen, Reload und explizitem Wiederausrüsten des Schilds prüfen. Ein vollständiger Angriffs-/Trefferwurf-Workflow existiert außerhalb dieses 0.9-Korrekturschritts nicht. |
| P1 | Inventar-/Merchant-/Loot-Browser-Roundtrip | Antrag → Bearbeitung → approve/reject → Aufnahme → stack/split → equip/drop/move → Reload; Gewicht, Besitz, Währung, Mengen und Idempotenz stimmen; mehrere Items sowie minimierte Loot-Anzeige |
| P1 | Kenney-Visual- und Performanceabnahme | gleiche Mock-Szene/Kamera und Netzwerkbedingungen für Classic/2.5D, Radius 39 und 78; Screenshots, Latenz, Downloadbytes, Ladezeit, Reaktionszeit, Renderdauer; keine Asset-Uploads |
| P2 | Cube-Progression-Regelentscheidung | Der bestehende Vertrag gewährt Zugang durch Cube oder GM-Permanentfreigabe, aber keine Progressionsstufen. Nur bei neuer verbindlicher Regelanforderung erweitern |

## Kosten, Daten und Release-Status

- Es wurde keine Supabase-Testdatenbank oder kostenpflichtige Ressource angelegt.
- Keine Produktionsmigration, kein Produktions-Storage-Upload oder produktiver Schreibzugriff.
- Vercel-Preview des vorherigen Code-Commits `d8a5a91aa50a6505de16452612a6f2b7131a9705` ist `READY`; `/api/apex?op=version` antwortet mit HTTP 200, `0.9.0`, Branch `feat/apex-09-closeout` und PR `48`. Der aktuelle Head hat wegen des kostenlosen täglichen Build-Limits keinen eigenen Preview. Keine Production-Bereitstellung, Promotion oder PR-Merge.
- Keine Migration in diesem Branch: Journal-Backlinks verwenden vorhandene Journalfelder; TS-Konfiguration ist build-only.
- **Freigabe:** APEX 0.9 noch nicht als vollständig finalabgenommen bezeichnen. Branch, Preview und aktuelle isolierte SQL-CI sind bereit; Rollenbrowserabnahme und die in der Matrix benannten P1-Funktions-/Visualnachweise bleiben offen.

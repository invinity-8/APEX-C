# APEX – Implementierungsstatus

**Stand:** 2026-11-06  
**Branch:** `feat/apex-09-completion-reconciliation`  
**Basis:** aktuelles `main` nach PR #43  
**Lesart:** „Implementiert und verifiziert“ bezieht sich jeweils nur auf die unten genannte Evidenz. Ein grüner Unit-Test ist keine Produktions- oder Browserabnahme.

## Implementiert und verifiziert

- **Character/Spells-Routing:** Character öffnet jetzt explizit Overview; der volle Spellbook-Tab ist kein Tab in der Character-Seite mehr. Die Top-Level-Seite Spells setzt weiterhin den Spellbook-Starttab. Codeprüfung: `src/App.tsx`, `src/components/CharacterPanel.tsx`.
- **Journal-Navigation:** Online-Spieler und GM können Journal jetzt als eigene Hauptseite öffnen. Die doppelten Journal-Einstiege in GM- und Spieler-Workspace-Widgets wurden entfernt. Codeprüfung: `src/App.tsx`.
- **Produktions-Schema:** Read-only Datenbankabfrage zeigt Schema-Version 6. Migrationshistorie enthält `20261105120000` und `20261106100000`. Das Repository-Manifest enthielt beide noch nicht; dieser Branch gleicht `supabase/remote_history.txt` an, ohne Datenbank oder Migration auszuführen.
- **Kenney-Speicher:** Read-only Abfrage bestätigt privaten Bucket `apex-asset-packs` und 6.557 Objekte. Keine Objekte hochgeladen, verschoben oder geöffnet.

## Implementiert, aber noch nicht produktionsverifiziert

- Die drei vorangegangenen Änderungen aus PRs #41–43: Szenenbibliothek/Forest-Editor, Itemanfragen/Ausrüstung und Spellbook-/Loot-Basiseinstieg sind in `main`. Die PRs meldeten Tests und Builds erfolgreich; für #41–43 gab es jedoch keinen vollständigen rollenbasierten Browserlauf auf einer zugänglichen Preview.
- Die neuen Navigationsänderungen in diesem Branch bestehen den GitHub-Workflow-Build. Browserklicks als GM, Zauberwirker und Nichtzauberwirker sind noch offen; die Preview-URL leitet auf Vercel-Login um.

## Teilweise implementiert

- **Szenen:** vier Kategorien, Bibliothek, Entwürfe, Editor, Vorschau und Spielerzuweisungen existieren. PR #45 ergänzt einen GM-Fokus auf veröffentlichte Szenen, Tokenpositionen und explizite Split-Party-/Sanctuary-Transfers. Fog-/Encounter-/Loot-/Event-Bedienung direkt auf fokussierten Szenen und die Rollen-Browserabnahme stehen noch aus.
- **Spellbook:** eigene Top-Level-Route und Grundfelder existieren. Strukturierte Regeldetails, erlaubte Spell-Referenzen, Klassenregeln, vorbereitete Zauber und Casting-Effekte fehlen.
- **Charakter, Fähigkeiten und Ressourcen:** Sheets, Import, History und Fähigkeiten existieren. Es fehlt eine einheitliche Regelquelle für abgeleitete Werte und eine klare Synchronisierung zwischen Sheet-Ressourcen und Spielressourcen.
- **Inventar, Ausrüstung, Händler und Loot:** Kernpfade sind vorhanden und getestet. Vielseitige Waffen, Carry-Movement-Penalties, Legacy-Kompatibilität und vollständige Itemübergabe brauchen weitere Abnahme.
- **Journal:** Speichern, Versionierung, Suche, Kategorien, Tags, Pins, Teilen, Szenenbezug und Export existieren. Menschen-/Ortsregister, Verlinkungen/Backlinks sowie Komfort- und Browserabnahme fehlen.
- **Synchronisierung/Berechtigungen:** Serverautorität, gefilterte Spieleransicht, Scene-/Journal-Checks und SQL-Tests existieren. Reconnect-/Privacy-Abläufe wurden in dieser Runde nicht im Browser durchgespielt.

## Priorisierte offene Arbeit

| Priorität | Arbeit | Relevante Bereiche | Abhängigkeiten | Abnahmekriterien | Aufwand |
|---|---|---|---|---|---|
| P0 | Live-Kontrollen für fokussierte Szenen und Sichtbarkeits-/Fog-Workflow | `CampaignMapDirector.tsx`, `SceneSurface.tsx`, `sceneRuntime.ts` | Map-Fokus aus PR #45 | Fog-/Sichtbarkeitsregeln im GM-Szenenmodus vollständig steuerbar; Events/Announcements/Loot/Encounter bleiben mit fokussierter Szene verknüpft; Reconnect erhält Fokus und korrekte Spielerzuweisungen | Groß |
| P0 | Sichere Kenney-Asset-Auslieferung und erster 2.5D-Preview-Renderer | Supabase Storage, API, Map-Renderer | Private Allowlist/Manifest und serverseitige URL-Ausgabe; lizenzierte Sprites | gleiche Karte mit Classic/2.5D; Token/Hex/Fog/Movement unverändert; Browser-Screenshot und Messwerte bei Radius 39 und 78; Abbruch/Fallback bei Fehlern | Groß |
| P1 | Spell-Daten- und Klassenregeln vervollständigen | `sheet.ts`, `CharacterPanel.tsx`, `ClassAbilities.tsx` | Regelentscheidung, vertrauenswürdige lizenzierte Referenzdaten | Metadaten/Details und Vorbereitung basieren auf einer autoritativen Quelle; fehlende Beschreibung eindeutig markiert; keine erfundenen proprietären Texte | Groß |
| P1 | Abgeleitete Werte, Waffen, Effekte und Ressourcen vereinheitlichen | `sheet.ts`, `equipment.ts`, `commands.ts`, `ClassAbilities.tsx` | Regelmodell / Systemgrenzen | Level, Equipment, AC, Waffen, Slot-/Resource-Verbrauch und unterstützte temporäre Effekte propagieren konsistent; Konflikt-/Negativtests vorhanden | Groß |
| P1 | Journal-People/Places und Continuity | `journals.ts`, API, `PlayerJournal.tsx` | Additive Datentyp-/Migrationsentscheidung | explizite Referenzen verlinken Scene/Character/Person/Ort; keine automatische falsche Entity-Erzeugung; Privacy bleibt je Freigabe erhalten | Mittel |
| P1 | Szenenentwurf/live Publishing und Map/Editor-Trennung | `SceneMapEditor.tsx`, `SceneDirector.tsx`, scene API | Map-Fokusarbeit | Editoränderungen bleiben privat bis explizitem Apply/Publish; Live-Version und Draft sind klar erkennbar; GM Preview leakt nichts | Groß |
| P2 | Vollständige Handels-, Loot- und Migrations-/Legacy-Abnahme | Items, Merchant, Party Loot, tests | P0/P1 stabile Regelbasis | E2E Item/Gold/Roll/Approval/Inventory round-trip inkl. Retry und vorhandener Alt-Daten | Mittel |
| P2 | Produktweiter Browser- und Performance-Durchlauf | Alle Hauptseiten, Vercel Preview | Authentifizierbare Preview oder lokale Browserports | GM, Player, Caster, Non-caster; Reconnect; Radius 39/78; Screenshots, Netzwerklast und Render-/Interaction-Messungen | Mittel |

## Entfernt / nicht als implementiert gezählt

- Die doppelten **Journal-Workspace-Einstiege** wurden durch eine eindeutige Journal-Hauptnavigation ersetzt.
- Kenney-Assets gelten trotz ihres vorhandenen privaten Uploads nicht als integrierte Spielfunktion; kein Renderer-/Ladeerfolg wird behauptet.
- Nicht aufgeführte dekorative oder zukünftige Systeme werden hier nicht als produktiv abgeschlossen gewertet.

## Noch nicht ausgeführt

- Map-Fokus-API-Regressionen: **6/6 fokussierte Tests bestanden** (veröffentlichte Szene, Draft/Archiv/Legacy-Ablehnung, ungültige ID, Player-Privacy). Die Tests liefen gegen den Branch-Quelltext und das unveränderte Repo-Test-Harness.
- Vercel Preview für den aktuellen Map-Director-Commit ist `READY` (TypeScript und Production-Build bestanden). Der Browser leitet weiterhin zur Vercel-Loginseite um; kein GM-/Spieler-E2E und keine Screenshots.
- Der vollständige Supabase-Migrations-/RLS-Workflow wurde für PR #45 noch nicht ausgeführt; die „Production database deployed and secure“-Stufe läuft nur nach Push auf `main` oder manuellem Start. Kein Produktionsdeployment und keine Produktionsmigration.
- Keine Produktionsmigration, kein Storage-Schreibzugriff, kein Merge und kein Produktionsdeployment.


## PR #46 – Kenney 2.5D Preview

- **Implementiert und CI-verifiziert:** begrenzter Classic/2.5D-Schalter für generierte Forest-Szenen, private kurzlebige Kenney-Signaturen, Kampagnen-/Szenenautorisation und API-Negativtests. Details: `docs/audits/APEX_KENNEY_25D_PREVIEW.md`.
- **Preview:** Vercel Deployment ist `READY`; die APEX-Einstiegsseite lädt in der Browserprüfung.
- **Nicht browserverifiziert:** GM-/Spielerlogin, Kartenrendering im angemeldeten Zustand, Screenshotvergleich, Laden-/Eingabe-/Rendermessung für Radius 39 und 78. Die Preview-Anmeldung könnte die echte Kampagne erreichen; deshalb wurde sie nicht geöffnet.
- **Daten:** keine Migration, keine Produktions-DB-Änderung, keine Bucket- oder Objektänderung. Sprite-Abruf nutzt höchstens die bestehende Storage-Bandbreite; keine Bildtransformation.

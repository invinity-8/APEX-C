# APEX: vom Arena-Werkzeug zur szenenbasierten Spieloberfläche

Arbeitsauftrag vom 7. November 2026. Dieses Dokument ist die Umsetzungsspezifikation, keine Fertigmeldung.

## Leitidee und Arbeitsanweisung

Baue APEX als gemeinsamen 2D-Spieltisch. Scenes ist die Werkstatt und Bibliothek; Game ist der laufende Spieltisch. Die aktuelle veröffentlichte Karte erhält den größten zusammenhängenden Bildschirmbereich. Werkzeuge stehen daneben. Erhalte bestehende Charaktere, Gegenstände, Karten und Berechtigungen. Keine zweite parallele Kampf- oder Inventardatenhaltung einführen. Jede Online-Aktion serverseitig autorisieren und gegen veraltete Szenenrevisionen absichern. Arbeit in höchstens zwei fachlich zusammenhängende PRs bündeln.

## Bestandsaufnahme

- Zwei lokale Stände: APEX-C enthält umfangreiche ungespeicherte Änderungen; APEX-C-0.9-closeout war bei Sichtung sauber, Commit fa7e337. Freigabe: alle Änderungen aus APEX-C berücksichtigen; ältere Dateien nicht über neuere Implementierungen kopieren.
- SceneDirector, SceneMapEditor und SceneSurface bestehen bereits; sceneRuntime, sceneMotion und sceneTravel bilden serverseitige Szenenoperationen ab.
- SceneLiveControls enthält Szenenankündigungen und Encounter-Teilnehmer. Spielerinitiative beginnt aktuell pauschal bei 10. Das ist noch kein vollständiger automatischer Kampf.
- CharacterPanel besitzt bereits eine Spellbook-Ansicht; ihre Navigation wurde zugunsten einer eigenen Hauptseite entfernt.
- Gewichte werden intern in Gramm beziehungsweise Kilogramm verarbeitet. Die sichtbaren Traglastwerte und Inventarpositionen verwenden teilweise drei Nachkommastellen. Anzeige auf eine Stelle ändern, interne Rechengenauigkeit erhalten.
- Die Architektur hält vollständigen Spielzustand auf dem Server zurück und liefert gefilterte Spieleransichten. Sichtprüfung muss dieses Prinzip fortführen: CSS-Nebel allein schützt keine versteckten Gegner.

## PR 1: Game, Szenen und Begegnungen

1. Scenes bleibt Bibliothek, Editor und prozedurale Generierung. Game zeigt zentral die aktive veröffentlichte Karte. Szenenname, Veröffentlichungsstatus, Reise-/Spawnaktionen und Encounter-Werkzeuge in eine einklappbare Seitenleiste verschieben. Rechts eine kompakte Szenenliste mit Switch to Scene, ohne Navigation zum Editor.
2. GM-Vorschau, veröffentlichte Revision und Spielerzuordnung klar unterscheiden. Wechsel verwendet die veröffentlichte Revision, bestätigt Erfolg und aktualisiert alle betroffenen Clients. Fehler lassen die bisherige Szene intakt. Spieler gezielt oder gemeinsam herziehen.
3. Celestial, Welt, Gebiet und Battle Map erhalten explizite Fähigkeiten. Arena-Events, Shrinking, Rivals/Sides und Arena-Tagesregeln nur bei aktiver Arena ausführen und anzeigen; generische Szenenankündigungen bleiben verfügbar. Nicht anhand des Szenennamens entscheiden.
4. Zeit und Beleuchtung pro Szene speichern. Battle Maps erhalten manuelle Tag-/Nachtbeleuchtung ohne Arena-Zeitspur. Sichtweiten, Dunkelsicht, Lichtquellen und Sichtblocker modellieren. Licht durch Wände blockieren; Spieleransichten serverseitig filtern.
5. Einstieg als konfigurierbare Fläche, zunächst 4 x 4 Felder. Begehbare freie Zellen deterministisch verteilen; Überfüllung melden. Keine Figuren auf Wände oder übereinander setzen.
6. Exploration erlaubt freie Bewegung mit Kollisions- und Sichtprüfung. Gegnerkontakt oder GM-Aktion startet Encounter; genaue Triggerregeln explizit festlegen. Initiative mit Modifikatoren würfeln, Gleichstände stabil auflösen. Obere Portraitleiste zeigt Reihenfolge und aktiven Zug. GM steuert Gegner, Spieler eigene Figuren. Kampfende stellt Exploration wieder her.
7. Rechtsklick auf Ziel öffnet Aktionen; auch per Tastatur und Touch erreichbar. Nahkampf, Fernkampf und vorbereitete Zauber nach Reichweite, Sichtlinie, Ressourcen und Zug prüfen. Trefferwurf, Advantage/Disadvantage, kritische Treffer, Rettungswürfe und Schaden nachvollziehbar protokollieren. HP und Ressourcen atomar aktualisieren; wiederholte Requests dürfen keinen zweiten Schaden verursachen.
8. AoE-Vorschau für unterstützte Formen, Reichweite und betroffene Ziele. Vorschau ersetzt keine Serverprüfung. Nicht unterstützte Zauber klar als manuell abwickelbar kennzeichnen.
9. Vier editierbare Vorlagen: Wald, Waldkreuzung, Fluss/Furt und alte Ruine. Jede mit Spawnfläche, Sichtblockern, begehbaren Bereichen und optionalen Gegnerpositionen. Seed reproduzierbar speichern.

Abnahme: Mit GM und zwei Spielern eine Battle Map veröffentlichen, im Game wechseln, beide Spieler spawnen, getrennte Sicht und Licht testen, frei bewegen, Encounter starten, Initiative sehen, Angriffe in beide Richtungen abwickeln, Kampf beenden und Szene wechseln. Zusätzlich veraltete Revision, zwei gleichzeitige Aktionen, Verbindungsabbruch, unerlaubte Fremdsteuerung und versteckte Gegner prüfen.

## PR 2: Character, Journal und Bedienung

1. Hauptnavigation Character nennen; Spells ausschließlich als Character-Untertab. Bestehende gespeicherte Links kompatibel halten.
2. Haupttabs per Ziehen umordnen, Reihenfolge lokal pro Profil speichern. Tastaturalternative anbieten und bei neuen Tabs beziehungsweise Rollenwechseln gültige Liste herstellen.
3. Journal als lesbares Buch mit aktueller Seite, Titel, Text und Vor-/Zurückblättern. Suche und Kategorien in eine optionale Seitenleiste. Bestehende Einträge, Sichtbarkeit, Speichern und Konfliktbehandlung erhalten. Automatische Begriffserkennung ist nachgeordnet.
4. Traglast, Kapazität und angezeigte Positionsgewichte mit einer Nachkommastelle darstellen; Rundung niemals in die Regelberechnung übernehmen. Einheiten und Importpfade gesondert auf Faktor-1000-Fehler prüfen.
5. Beschreibungen für vorhandene Zauber aus bestätigten PDF-Inhalten oder einem passend lizenzierten Regelkatalog ergänzen. Regelversion, Quelle und Sprache speichern; Hausregeln und vorhandene Texte nicht überschreiben. Mehrdeutige Namen zur Prüfung vorlegen. Beschreibungen allein machen einen Zauber nicht automatisch ausführbar.

Abnahme: Character-Untertabs, persistierte Tabreihenfolge, Journal anlegen/bearbeiten/blättern/suchen, Besitzerrechte, Gewichte und Zauberbeschreibungen mit bestehenden Charakteren prüfen.

## Geplanter Spielablauf

In Scenes eine Vorlage wählen und bearbeiten. Spawnfläche, Beleuchtung, Wände und Gegner setzen, dann veröffentlichen. In Game rechts die Szene wählen und Spieler herziehen. Auf der Karte erkunden; bei Kampfbeginn erscheint die Initiative oben. Ziel auswählen und gültige Aktion wählen; Würfel und Schaden werden im Kampfprotokoll nachvollziehbar. Nach Kampfende frei weiterziehen. Charakterdaten und Zauber liegen unter Character, Notizen im Journal.

## Grafiken und noch benötigte Entscheidungen

Ein konsistenter Satz Top-down-2D-Assets ist für diesen Ausbau hilfreicher als zusätzliche 3D-Komplexität. Kenney Tiny Dungeon bietet CC0-Kacheln als technische Startbasis: https://kenney.nl/assets/tiny-dungeon . Der Pixelstil ist eine Option, keine vorweggenommene Stilentscheidung. Für einen gemalten Stil werden vier Referenzbilder und ein zusammenpassendes Terrain-/Objektpaket benötigt. Vorhandene 3D-Assets können später als einheitliche Draufsicht-Sprites gerendert werden.

Hilfreich sind: gewünschte Regelversion und Hausregeln; ein Beispiel-PDF mit den tatsächlich genutzten Zaubern; bevorzugte Sprache der Beschreibungen; Stilreferenzen; vorhandene Asset-Dateien mit Nutzungsrechten. Keine zusätzlichen Plugins sind für die ersten Navigations- und Anzeigeänderungen erforderlich.

## Fortschritt

### Umgesetzt (PR #49, gemergt)

Game-/Character-Beschriftung, Spellbook wieder im Character-Untertab, Gewichtsanzeige auf eine Nachkommastelle.

### Umgesetzt (Folge-PR: Game/Scenes-Trennung und Import Spells)

- **Zuweisungsfehler behoben.** Ursache: Ein Klick in der Szenenliste rief `setSelection(id)` und direkt danach `changeFocus()` auf, das Auswahl und angehakte Spieler wieder leerte. „Send selected to chosen scene“ blieb dadurch dauerhaft deaktiviert. Ausgewählte Szene, aktuelle GM-Szene und Spielerauswahl sind jetzt getrennter Zustand (`src/game/sceneDirector.ts`) und setzen sich nicht mehr gegenseitig zurück.
- **Nicht beigetretene Spieler.** Profile, die sich noch nie angemeldet haben, sind keine Kampagnenmitglieder; `apex_assign_scene` lehnt sie ab. Die Spielerliste meldet das jetzt (`joined`), die Oberfläche bietet sie nicht zur Zuweisung an und erklärt den Grund.
- **Game.** Die aktive Karte liegt zentral auf einer Kartenbühne mit Zoom (Stufen 25–300 %) und Höhenänderung durch Ziehen am unteren Rand (Pfeiltasten, Doppelklick = volle Höhe). Szenen, Spielerorte und Szenenwerkzeuge sind normale Workspace-Widgets, links oder rechts andockbar; Reihenfolge und Platzierung werden lokal gespeichert. Die Szenenliste zeigt veröffentlichte Szenen mit Vorschaubild. Ein Klick zeigt die Szene nur als Vorschau, erst „Switch Scene“ macht sie aktuell. Dabei wird gefragt, ob alle Spieler mitwechseln. Danach lassen sich einzelne Spieler der gewählten Szene oder dem Sanctuary zuweisen. Veraltete Revisionen, Netzwerkfehler (mit „Verify or retry“, gleiche Request-ID) und fehlende Spawnpunkte werden verständlich gemeldet.
- **Arena als Szene.** Die Arena ist ein normaler Listeneintrag, zugewiesen wird über den bestehenden Legacy-Arena-Datensatz. Arena-Widgets (Arena & Rules, Selection, Events, Rivals) erscheinen nur, solange die Arena gezeigt wird. Ihre Platzierung bleibt dabei erhalten. Entfernt wurden der Arena-Knopf, „Edit scene library“, die Live-Visibility-Liste und die 2,5D-Vorschau (nur die Oberfläche; der Server-Endpunkt bleibt unverändert und ungenutzt).
- **Scenes.** Nur noch Bibliothek und Editor. Spielerzuweisung, Spielervorschau, „Set Map focus“, Token-Platzierung und Weltreise wurden entfernt; Platzierung und Reise liegen jetzt im Game-Widget „Scene tools“. Der Kategoriefilter leert die Liste beim Wechsel und filtert zusätzlich clientseitig nach Kategorie, sodass keine Szenen einer anderen Kategorie sichtbar bleiben. Die aktive Kategorie ist deutlich hervorgehoben. Der PNG-Ablauf bleibt unverändert: Bild im Editor hochladen, veröffentlichen (erzeugt ein separates Spielerbild), in Game wechseln.
- **Import Spells** (Character → Spells). Liest aus demselben PDF ausschließlich Zauber: gedruckte Spell-Karten anhand der Textpositionen sowie die Aurora-Zauberliste für den Prepared-Status. Die Korrekturansicht zeigt neue Zauber, Änderungen und unsichere Felder. Bestehende nicht-leere Werte, etwa Hausregel-Beschreibungen, werden nur überschrieben, wenn der Nutzer das anhakt. Zauber ohne Karte (nur Listeneintrag) sind Opt-in und bekommen keinen erfundenen Text. Der Server (`importSpells`) baut den Bogen aus der gespeicherten Fassung neu und ersetzt nur die Zauberliste. Das geschieht versionsgeprüft und mit Backup; Zauber werden dabei nie gelöscht.

Keine Datenbankmigration, keine Änderung an gespeicherten Szenen oder Karten.

### Abnahmekriterien dieses Schritts

1. Klick auf eine Szene in Game zeigt sie mit Hinweis „Preview“; „Current scene“ bleibt unverändert.
2. „Switch Scene“ fragt „Switch and move all players / Switch only / Cancel“; nach Bestätigung ist die Szene aktuell und gegebenenfalls sind alle beigetretenen Spieler dort.
3. Einzelne Spieler lassen sich der gewählten Szene oder dem Sanctuary zuweisen; die angehakten Spieler bleiben beim Szenenwechsel ausgewählt.
4. Ein veralteter Stand (zweiter GM-Tab) wird mit 409 abgelehnt, ohne jemanden zu bewegen; die Liste lädt neu.
5. Die vier Kategorien in Scenes filtern sichtbar und korrekt; Scenes enthält keine Zuweisung.
6. Die Karte lässt sich zoomen und in der Höhe ziehen; Widgets lassen sich nach links und rechts verschieben, und das bleibt nach einem Reload erhalten.
7. Import Spells mit `sinna.pdf` erkennt die sieben Karten von Seite 5 mit allen Feldern und ändert nur die Zauberliste.

### Umgesetzt (Folge-PR: Arena-Engine für alle Szenen, Prepare-Limit)

- **Eine Engine für Battle- und Region-Maps.** Szenen nutzen jetzt dieselbe Technik wie die Arena: Hex-Kacheln mit den Arena-Geländearten, den gemalten Arena-Painter (TerrainCanvas), die Lichtebene, Arena-Tokenmarker, Hover-Infos, Zoom mit Mausrad und Zwei-Finger-Geste, Ziehen zum Verschieben, Tastatursteuerung und den goldenen Bewegungsbereich. Pan, Zoom und Hit-Test liegen in einem gemeinsamen Hook (`useHexViewport`), den Arena und Szenen teilen.
- **Speicherung ohne Migration.** Das Gelände liegt kompakt in den Szenen-Metadaten (`hex = { radius, terrain }`, ein Zeichen pro Hex). Koordinaten bleiben positive Pixel, deshalb funktionieren die bestehenden Revisions-, Platzierungs- und SQL-Grenzprüfungen unverändert.
- **Bewegung serverseitig nach Arena-Regeln.** Der Server berechnet den günstigsten Weg über passierbare Hexe; jedes betretene Hex kostet seine Arena-Geländekosten × Fuß bzw. Meilen pro Hex. Seen sind unpassierbar.
- **Editor (Scenes).** Gelände-Pinsel (klein/groß), Arena-Generator mit Stilen (Wildnis, Waldlichtung, Fluss mit Furt, Ruinen, Grasland) und Seed, Spawn/Orte/Beschriftungen auf Hex-Mittelpunkten, Radius 2–40.
- **Bild- und PDF-Import.** PNG, JPG und WebP sowie die erste PDF-Seite werden lokal im Browser gerendert und je Hex an fünf Punkten nach Farbe der nächstliegenden Arena-Geländeart zugeordnet. Nachbessern geht mit dem Pinsel. Hochgeladen wird dabei nichts.
- **Alte Karten.** Neue Battle- und Region-Szenen entstehen immer als Hex-Karten. Bestehende gezeichnete Karten zeigen im Editor „Convert to hex map“ (Bäume werden Wald, Felsen Hügel, Hindernisse Ruinen, Wasser bleibt See, Wände werden Gebirge, Spawn und Orte bleiben erhalten) oder „Replace with empty hex map“. Gespeichert wird erst auf Klick; Daten werden nicht automatisch gelöscht. Der Wald-Generator mit den Baumsymbolen wurde entfernt.
- **Prepare-Limit.** Import Spells liest „Spells to prepare“ aus dem PDF (sinna.pdf: 5) und kann es speichern. Das Spellbook zeigt „Prepared X / Y“. Spieler können das Limit nicht überschreiten und nicht selbst erhöhen; der Server lehnt das mit 422 ab. Der GM wird nur gewarnt und kann für Hausregeln überschreiten. Ein Bogen über dem Limit lässt sich immer reduzieren.

### Umgesetzt (Folge-PR: Szenen von der Arena entkoppelt, Sicht, Initiative)

- **Keine Arena-Kopplung mehr.** Bewegungsbudgets und Zeit gelten pro Szene; vorher waren sie kampagnenweit (`apex_scene_budgets`/`apex_scene_clocks`). Arena-Schleichen, Arena-Tag/Nacht und Arena-Bewegungspunkte wirken nicht mehr auf Szenen. Auf Szenen sind Arena-Widgets und die Arena-Uhr im Kopfbereich ausgeblendet. Migration `20261108120000_apex_scene_local_time` (Schema 7, nur additiv).
- **Feste Maßstäbe statt Regler.** Battle Map: 1 Hex = 5 ft. Gebietskarte: 1 Hex = 3 Meilen, Standardgröße wie die Arena (Radius 12, 469 Felder); bei Tempo 30 ft sind das 24 Meilen bzw. 8 Felder pro Tag (das entspricht den 8 Bewegungspunkten der Arena).
- **5-ft-Kacheln für Battle Maps.** Gras, Erdpfad, Steinboden, Holzboden, Unterholz (schwierig), Geröll (schwierig), seichtes Wasser (schwierig), tiefes Wasser, Baum, Felsblock, Wand – mit eigenem Painter im Draufsicht-Maßstab. Wände und Baumstämme blockieren Sicht und Bewegung, Felsblöcke nur Bewegung. Vorlagen: Waldlichtung, Bachfurt, Ruine, Dungeon, offenes Feld. Bisherige Battle Maps mit Übersichtsgelände lassen sich per Knopf umwandeln.
- **Sicht serverseitig.** Spieler erhalten nur sichtbare und bereits gesehene Hexe; unbekanntes Gelände verlässt den Server nicht.
  - Battle: Sichtlinie (kein Blick um Ecken), Licht hell (120 ft), dämmrig (60 ft) oder dunkel. Bei Dunkelheit zählen nur Dunkelsicht laut Charakterbogen, angrenzende Felder und Lichtquellen.
  - Gebiet: Tag 2 Hexe (+1 auf Hügeln, +2 auf Bergen), Nacht 1 Hex; Berge verdecken.
  - Gesehenes wird pro Spieler und Szene gespeichert: bei Bewegung, bei Ankunft und vor Licht- oder Zeitwechseln.
- **Tag/Nacht auf Gebietskarten.** Der GM schaltet „Begin night“ / „Begin day N“; Nacht verdunkelt die Karte wie in der Arena. Das Reisebudget gilt pro Szenentag.
- **Initiative auf Battle Maps.**
  - Beim Betreten einer Battle Map würfelt der Server für alle Ankommenden d20 + Initiative (Bogen, sonst GE-Modifikator); bei Gleichstand geht der höhere Modifikator vor.
  - Die Portraitleiste zeigt die Reihenfolge. Nur die aktive Figur bewegt sich, mit ihrem Tempo pro Zug; „End turn“ gibt an die nächste weiter.
  - Die Datenbank prüft die Zugreihenfolge erneut in derselben Transaktion.
  - Der GM sieht die Reihenfolge, kann „Next turn“, „End initiative“ (danach unbegrenzt freie Bewegung) und „Start initiative“ auslösen.

### Umgesetzt (Folge-PR: Kachelbibliothek, Farbschema, Gegner, Fackeln, Vorschauen)

- **Kachelbibliothek.**
  - Gebietskarten (3 mi pro Hex): 42 Kacheln, darunter Steppe, Ackerland, Savanne, Moor, Nadelwald, Dschungel, toter Wald, Klippen, Canyon, offenes Meer, Küste, Sumpf, Wüste, Dünen, Mesa, Salzebene, Oase, Tundra, Schneefeld, Gletscher, Vulkan, Lavafeld, Aschelande, Kristallfeld, Verderbtes Land, Dorf, Stadt, Burg, Brücke, Lager, Wachturm, Höhleneingang und Schrein.
  - Battle Maps (5 ft): 47 Kacheln in 8 Gruppen, darunter Sand, Schlamm, Schnee, Eis, Kopfstein, Marmor, Teppich, hohes Gras, Busch, Hecke, Kiefer, Baumstumpf, Leuchtpilze, Sumpfwasser, Holzbrücke, Höhlenwand, Grube, Stalagmit, Holzwand, Zaun, Tür, Säule, Treppe, Statue, Tisch, Kisten, Fässer, Bett, Altar, Lagerfeuer, Kohlebecken, Lava, Spinnennetz, Falle und Magiekreis.
  - Jede Kachel legt Bewegungskosten, Sichtblockade und gegebenenfalls Licht fest (Lagerfeuer und Kohlebecken 20 ft, Lava, Pilze, Kristalle). Gezeichnet wird mit einem allgemeinen Kachel-Painter in beiden Maßstäben.
- **Farbschema pro Karte.** Im Editor rechts: Voreinstellungen (Mesa, Wüste, Tundra, Sumpf, Vulkan, Herbst, Underdark, Feywild), eigene Farben (2–6) und Stärke. Die Kacheln werden per Gradient-Map umgefärbt, und zwar vor der Nebelabdunklung, sodass erinnerte Felder grau bleiben.
- **4×4-Einstieg.** Ankommende Figuren werden auf die 16 nächsten freien, begehbaren Felder um den Spawn gestellt. Zwei Figuren stehen nie auf demselben Hex; ein voller Bereich wird gemeldet.
- **Verbündete und Gegner sichtbar.** Spieler sehen andere Charaktere und Gegner nur in Sicht; die HP der Gegner sieht nur der GM, Spieler sehen „bloodied“.
- **Fackeln.** Spieler schalten ihr Licht selbst an und aus, ohne Gegenstandsprüfung. Das Licht leuchtet 40 ft aus, ist für alle sichtbar und wird durch Wände blockiert. Dunkelsicht gilt zusätzlich.
- **Generische Gegner (SRD 5.1).** 12 Typen: Goblin, Bandit, Bandit archer, Wolf, Skeleton, Zombie, Orc, Cultist, Giant spider, Brown bear, Thug, Ogre.
  - Der GM platziert, bewegt und entfernt Gegner, ändert ihre HP und lässt sie angreifen; der Schaden geht auf den Charakterbogen.
  - Neue Gegner würfeln in eine laufende Initiative; besiegte fallen heraus.
- **Angriffe.**
  - Spieler wählen einen Angriff aus dem Charakterbogen und klicken einen Gegner an: eigener Zug, ein Angriff pro Zug, Reichweite bzw. Fernkampfreichweite und Sichtlinie werden geprüft.
  - Gewürfelt wird d20 + Bonus gegen die AC; eine natürliche 20 verdoppelt die Schadenswürfel, eine natürliche 1 verfehlt.
  - Alles erscheint im Kampfprotokoll.
  - Vorteil/Nachteil, Rettungswürfe, Zauber und AoE bleiben vorerst manuell.
- **Alte Encounter-Steuerung zusammengeführt.** Auf Battle Maps wird Initiative nur noch über Serverwürfe gestartet; die alte Steuerung dient zum Anpassen (Werte, NPC ohne Figur, Sichtbarkeit).
- **Vorschaubilder.** Bibliothek und Game-Liste zeigen eine Minikarte des aktuellen Entwurfs mit Farbschema, ohne Upload.
- **Welt- und Himmelskarten als Bilder.** PNG/JPG hochladen; die Karte übernimmt das Seitenverhältnis und das ganze Bild wird für Spieler freigegeben. Orte sind standardmäßig sichtbar und lassen sich anklicken (Name und Beschreibung). Ein versteckter Spawn wird beim Veröffentlichen ergänzt; Hex-Werkzeuge entfallen.

### Offene Folgeaufgaben (Kampf, Sicht, Zeit)

Grundlage ab jetzt: Alle Battle- und Region-Szenen laufen auf Hex-Kacheln mit Arena-Wegfindung. Sicht, 4×4-Spawn, Reichweite und AoE können deshalb auf Hex-Distanzen aufsetzen. Vorhandene Bausteine: Encounter-Tracker pro Szene (`sceneEncounter*`, Initiative manuell, sortiert, versionsgeprüft), Bewegung mit Runden-/Stundenbudget und Wand-/Terrainprüfung (`sceneMotion`), Hex-Sicht der Arena (`visibility.ts`), serverseitige Schadens-/Heilungs- und Mage-Armor-Regeln am Charakterbogen. Es fehlen:

1. ~~Szenenzeit und Licht~~ – umgesetzt (siehe oben).
2. ~~Sichtweite, Dunkelsicht, Lichtquellen~~ – umgesetzt für Gelände. Offen: Gegnerfiguren und Verbündete nur bei Sicht übertragen (Gegner-Tokens gibt es noch nicht), getragene Fackeln der Spieler.
3. ~~4 × 4-Einstiegsbereich~~ – umgesetzt.
3a. **(alt) 4 × 4-Einstiegsbereich.** Spawn als Fläche, deterministische Verteilung auf freie, begehbare Zellen; Überfüllung wird gemeldet. *Abnahme:* Vier Spieler landen auf vier verschiedenen freien Feldern, nie auf Wänden.
4. **Encounter-Ablauf.** Initiative, Portraitleiste, Zugrecht für Bewegung und Kampfende sind umgesetzt. Offen: Gegner als Figuren auf der Karte mit GM-Zügen; Aktionen/Angriffe im Zug. *Abnahme:* Ein Spieler kann außerhalb seines Zuges nicht angreifen.
5. **Angriffe und Schaden.** Ziel-Kontextmenü (auch per Tastatur/Touch), Reichweiten- und Sichtlinienprüfung, Trefferwurf mit Advantage/Disadvantage, kritische Treffer, Rettungswürfe, atomare HP-Änderung mit Request-ID (keine Doppelschäden), nachvollziehbares Kampfprotokoll. *Abnahme:* Ein wiederholter Request erzeugt keinen zweiten Schaden; das Protokoll zeigt Würfe und Modifikatoren.
6. **AoE-Vorschau.** Kegel/Würfel/Kugel/Linie mit betroffenen Zielen; die Vorschau ersetzt keine Serverprüfung. Nicht unterstützte Zauber werden als „manuell abwickeln“ markiert. *Abnahme:* Thunderwave (15-ft-Würfel) markiert die richtigen Felder.
7. **Manuelle Hausregeln.** Jede nicht automatisierte Wirkung lässt sich vom GM manuell abwickeln (HP, Zustände, Ressourcen), protokolliert.

## Bestätigte Regelbasis

SRD 2014 / 5.1 als Grundgerüst, kombiniert mit dem bestehenden PoE-inspirierten Itemsystem. UA- und Hausregelerweiterungen sind erwünscht. Datenmodell und Oberfläche sollen zusätzliche Fähigkeiten erlauben; nicht automatisierte Effekte müssen manuell durch den GM abwickelbar bleiben. Keine automatische Umstellung auf 2024.

Die lokale Typprüfung der ersten Navigations- und Anzeigeänderungen wurde erfolgreich ausgeführt.

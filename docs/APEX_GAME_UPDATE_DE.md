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
2. ~~Sichtweite, Dunkelsicht, Lichtquellen~~ – umgesetzt inklusive Gegner und Verbündete nur in Sicht sowie getragener Fackeln.
3. ~~4 × 4-Einstiegsbereich~~ – umgesetzt (16 freie Felder um den Spawn, keine Stapelung, Überfüllung wird gemeldet).
4. ~~Encounter-Ablauf~~ – umgesetzt (Initiative, Zugrecht, Gegnerfiguren mit GM-Zügen, ein Angriff pro Zug). Offen: Bewegungsbudget für Gegner (der GM setzt sie frei), Bonusaktionen/Reaktionen.
5. **Angriffe und Schaden – teilweise.** Umgesetzt: Waffenangriffe aus dem Bogen gegen Gegner, Gegnerangriffe gegen Charaktere, Reichweite/Sichtlinie, Krit/natürliche 1, Kampfprotokoll. Offen: Request-ID gegen doppelte Würfe bei Netzwerk-Wiederholung (Spieler sind durch „ein Angriff pro Zug“ geschützt, GM-Gegnerangriffe noch nicht), Advantage/Disadvantage, Rettungswürfe, Zauberangriffe, Widerstände, Kontextmenü per Rechtsklick. Ursprünglich geplant: Ziel-Kontextmenü (auch per Tastatur/Touch), Reichweiten- und Sichtlinienprüfung, Trefferwurf mit Advantage/Disadvantage, kritische Treffer, Rettungswürfe, atomare HP-Änderung mit Request-ID (keine Doppelschäden), nachvollziehbares Kampfprotokoll. *Abnahme:* Ein wiederholter Request erzeugt keinen zweiten Schaden; das Protokoll zeigt Würfe und Modifikatoren.
6. **AoE-Vorschau.** Kegel/Würfel/Kugel/Linie mit betroffenen Zielen; die Vorschau ersetzt keine Serverprüfung. Nicht unterstützte Zauber werden als „manuell abwickeln“ markiert. *Abnahme:* Thunderwave (15-ft-Würfel) markiert die richtigen Felder.
7. **Manuelle Hausregeln.** Jede nicht automatisierte Wirkung lässt sich vom GM manuell abwickeln (HP, Zustände, Ressourcen), protokolliert.

## Bestätigte Regelbasis

SRD 2014 / 5.1 als Grundgerüst, kombiniert mit dem bestehenden PoE-inspirierten Itemsystem. UA- und Hausregelerweiterungen sind erwünscht. Datenmodell und Oberfläche sollen zusätzliche Fähigkeiten erlauben; nicht automatisierte Effekte müssen manuell durch den GM abwickelbar bleiben. Keine automatische Umstellung auf 2024.

Die lokale Typprüfung der ersten Navigations- und Anzeigeänderungen wurde erfolgreich ausgeführt.


## APEX 1.0 – Itemization

- **Keine Equipped-Kiste mehr.** „Getragen“ ist ausschließlich, was auf der Puppe in einem Slot steckt. Das Inventar zeigt einen Bereich **Getragen** mit genau diesen Items, Container zeigen getragene Items nie doppelt. Alte Spielstände: Die Kiste wird beim nächsten Inventarbefehl aufgelöst, ihre Items gehen in den vorherigen Container zurück.
- **Rechtsklick** rüstet aus bzw. legt ab. Ziehen auf „Getragen“ rüstet aus, Ziehen in einen Container legt ab.
- **Hover-Vergleich:** Badge ▲ Upgrade / ▼ Downgrade / ◆ Trade-off / ＝ Gleich. Beim Hover sieht man jede Zahl, die sich gegenüber dem aktuellen Slot ändert.
- **Globale Werte:** AC, Speed, Initiative, Max-HP, Attribute und Resistenzen kommen aus einer gemeinsamen Berechnung. Charakterbogen, Party-Widget, Szenenkampf (Gegner greifen gegen die echte AC an, ausgerüstete Waffen sind als Angriff wählbar) und Szenenbewegung nutzen sie.
- **Resistenzen** mit Elementsymbolen, Punkten und % Schadensreduktion.
- **Rüstungsteile Armour/Evasion:** Körper, Kopf, Hände und Füße jeweils leicht/mittel/schwer, in drei Stufen (Drop-Level 1/8/16). Leicht gibt mehr Evasion (Dex zählt), schwer mehr Armour. Jede Kombination landet bei höchstens 18 AC, Mixen ist also Stil, Gewicht und Stealth. SRD-Rüstungen bleiben komplette Anzüge.
- **Neue Schilde:** Buckler +1, Scutum +3 (STR 15, schwer, Stealth-Nachteil).
- **Mods:** Attributsboni auf allen Slots (+1 ab ilvl 10, +2 ab ilvl 24, max +2, nie über 20). Sie wirken auf AC, Angriffe und Initiative. Mod-Tiers skalieren mit dem Item-Level, nicht mit der Basis, deshalb können gute Mods auch auf schlechten Basen landen.
- **Encumbrance prozentual:** ab 50 % Last −25 % Speed, ab 75 % −50 %, über 100 % keine Bewegung (GM kann auf SRD umstellen).
- **Icons** je Basis (Waffenfamilie, Rüstungsslot und Gewichtsklasse, Schmuck …). Die Farbe zeigt die Gewichtsklasse, der Rahmen die Seltenheit.

Details und Tabellen: `docs/game/ITEMIZATION_BALANCE.md` §17.

## APEX 1.1 – Kampf auf der Battlemap

**GM**
- **Kommandoleiste über der Karte:** Figur anklicken (Charakter, Gegner oder Verbündeter) oder einen Eintrag in der Initiative-Liste. Danach gibt es *Bewegen* (Feld anklicken), *Angreifen* (Ziel anklicken; Reichweite, Range und Sichtlinie prüft der Server), Standardaktionen, Bonusaktion, HP ±, Entfernen und *Zug beenden*.
- **Sichtmodi:** Gesamtsicht, Spielersicht kumuliert (Charaktere + Verbündete), Gegnersicht kumuliert, Sicht der ausgewählten Figur. Nicht sichtbare Felder werden grau.
- **Verbündete:** NPC-Vorlagen lassen sich „als Verbündeter“ platzieren (blau). Sie kämpfen auf Seite der Gruppe und können Gegner angreifen.
- **Charaktere bewegen:** Der GM kann sie nach den Bewegungsregeln bewegen (auch außerhalb ihres Zugs) oder wie bisher frei platzieren.
- **Initiative-Liste:** zeigt ●/◌ für Aktion, Bonusaktion und Reaktion.

**Spieler**
- **Leiste:** Aktion / Bonusaktion / Reaktion als Chips, Bewegungsbalken (Rest/Gesamt, mit Dash verdoppelt).
- **Standardaktionen:** Dash, Disengage, Dodge, Help, Hide, Ready, Search, Use an object, optional „als Bonusaktion“ (z. B. Cunning Action), dazu „andere Bonusaktion“.
- **Gegner anklicken** öffnet ein Ziel-Menü: alle Angriffe (ausgerüstete Waffen und Bogen-Angriffe) mit Reichweite und Hinweis „außer Reichweite“, außerdem die vorbereiteten Zauber und Cantrips.
- **Zauber:** Slot-Wahl inklusive Upcast. Der Slot wird serverseitig abgezogen. Spell-Attack-Zauber würfeln gegen AC. Bei Rettungswurf-Zaubern werden DC und Schaden (voll/halb) gewürfelt und geloggt, der GM wendet sie an. Bonusaktions- und Reaktionszauber verbrauchen die passende Ressource. Cantrips skalieren mit Stufe 5/11/17.
- **Extra Attack:** Mehrere Angriffe pro Attack-Aktion (aus „Extra Attack“ bzw. Kämpferstufe 11/20).

**Gelegenheitsangriffe (Reaktionen)**
- Wer ohne Disengage die Reichweite eines feindlichen Wesens verlässt, löst ein Angebot für dessen Reaktion aus. Gegner/Verbündete fragt der GM, Charaktere ihr Spieler.
- *Angreifen* würfelt einen Nahkampfangriff und verbraucht die Reaktion. Die Reaktion lädt sich zu Beginn des eigenen Zugs wieder auf.
- Prüfung: Reichweite am Start- und Zielfeld. Ein Pfad, der nur an einem Gegner vorbeistreift, wird nicht erkannt; das ruft der GM von Hand aus.

**Noch offen:** Vor- und Nachteil (z. B. Dodge wird nur angezeigt), Flächenschaden auf mehrere Ziele, automatische Rettungswürfe der Gegner, Ready-Trigger, Konzentration, Bewegungsbudget der NPCs.

## APEX 1.2 – Battlemap: Zugablauf, Gegner-Bibliothek, Zielen

**Zugablauf**
- **Nur wer dran ist, handelt**, auch beim GM. Der GM kann weiterhin HP ändern, Figuren *platzieren* (Korrektur) und die Initiative steuern.
- **Spielerblöcke:** Stehen Spieler direkt hintereinander in der Initiative (z. B. Gegner · Sinna · Aster · Gegner), handeln sie gleichzeitig. Jeder beendet seinen Teil, der Block endet, wenn alle fertig sind. „Nächster Zug“ des GM beendet den ganzen Block.
- **Gegner haben ein Budget:** Bewegung pro Zug nach ihrem Speed (Dash verdoppelt), Angriffe pro Attack-Aktion nach Multiattack.
- **Initiative als Porträtleiste** über der Karte, auch für den GM. Klick wählt die Figur aus.

**Automatisch beim Zugwechsel**
- **Spieler:** Die Bewegungsreichweite leuchtet auf, die Kamera fährt zur eigenen Figur.
- **GM:**
  - Die Figur am Zug wird automatisch ausgewählt, die Kamera fährt hin, die Reichweite leuchtet.
  - Bei NPCs wird deren Sicht aktiv: hell ist, was die Figur sieht, grau, was ihre Seite sieht, dunkel, was niemand ihrer Seite sieht.
  - Umschalten auf Gesamt-, Party- und Gegnersicht bleibt möglich.

**Bewegung**
- Beim Hovern zeigt die Karte den **Pfad** mit Kosten (gold = erreichbar, rot = zu weit).
- **Rechtsklick** auf ein Feld bewegt dorthin (Spieler: eigene Figur; GM: ausgewählte Figur am Zug).
- **Gelegenheitsangriffe halten die Bewegung an:** Die Figur bleibt auf dem letzten Feld in Reichweite stehen. Erst nach „Angreifen“ oder „Auslassen“ läuft sie automatisch weiter. Geprüft wird der ganze Pfad, auch wenn er nur an einem Gegner vorbeiführt.
- Figuren **gleiten** entlang ihres Pfads, statt zu springen.

**Zielen und Angreifen**
- **„Ready“-Leiste** (Spieler): Waffe oder Zauber wählen.
  - Fernkampf und Zauber: Beim Hovern zeigt eine weiße Linie die Sichtlinie (rot ohne Sicht oder außer Reichweite), dazu die Reichweite als helle Fläche.
  - Flächenzauber (Fireball, Burning Hands …): Hovern zeigt die betroffenen Felder, **Rechtsklick** auf ein Feld castet dort.
  - Slot-Wahl inklusive Upcast.
- **Rechtsklick auf einen Gegner** öffnet das Angriffsmenü: Waffen von Waffenset I, **Waffenset II** (wechselt die Waffe automatisch), Sheet-Angriffe und Zauber.
- **Flächeneffekte werden aufgelöst:** Schaden wird einmal gewürfelt, jede Figur in der Fläche würfelt ihren Rettungswurf (NPC aus dem Stat-Block, Charaktere aus dem Bogen). Bei Erfolg halber Schaden, er wird direkt abgezogen. Wände blockieren die Fläche.
- **GM:** Angriff des NPC im Kommandofeld wählen, dann Rechtsklick auf das Ziel. Flächenfähigkeiten (z. B. „Burning howl“) mit Nutzungen pro Begegnung zielen ebenfalls per Rechtsklick.

**Enemy Library (neuer Tab)**
- Stat-Blocks der SRD-Basisgegner (vereinfacht): AC, HP, Speed, Attribute, Rettungswürfe, Sinne, Angriffe (Nah, Fern, Zauber), Multiattack, Flächenfähigkeiten, Merkmale.
- Eigene Gegner anlegen, SRD-Gegner für die Kampagne anpassen und **Elites** erstellen (Name + Titel, z. B. „Grak the White“). Elites tragen einen **goldenen Drachenrahmen** auf der Karte und in der Bibliothek.
- Beispiel-Elite: *Orc Bloodcaller* mit Zauberangriff und Kegel-Flächenfähigkeit.

**Datenbank:** Migration `20261109120000_apex_scene_turn_blocks` (Schema 8). Nur die Bewegungsfunktion ändert sich (Spielerblöcke dürfen gleichzeitig ziehen); keine Tabellen, keine Daten.

**Noch offen:**
- Vorteil/Nachteil.
- Konzentration und Dauerzauber.
- Flächenzauber mit Angriffswurf (z. B. Scorching Ray mit mehreren Strahlen auf verschiedene Ziele).
- Elite-Fähigkeiten über Schaden hinaus (Buffs, Bedingungen).
- Weitere Reaktionen (Shield, Ready-Trigger).

## APEX 1.3 – Zustände, Zauber, Reaktionen, Klassenfähigkeiten

**Zustände und Buffs** (`src/game/combatEffects.ts`)
- Alle SRD-Zustände wirken mechanisch:
  - *blinded, poisoned, frightened, restrained, prone*: eigene Angriffe mit Nachteil
  - *blinded, restrained, paralyzed, stunned, unconscious*: Angriffe gegen sie mit Vorteil
  - *prone*: Vorteil aus 5 ft, Nachteil aus größerer Entfernung
  - *paralyzed, unconscious*: Nahkampftreffer aus 5 ft sind automatisch kritisch
  - *incapacitated*: keine Aktionen und keine Reaktionen
  - *grappled, restrained u. a.*: Speed 0
- Der GM setzt und entfernt Zustände im Kommandofeld. Spieler können „Stand up“ (prone beenden).
- Zustände und Buffs stehen unter den Figuren auf der Karte.

**Vorteil/Nachteil**
- Automatisch aus Zuständen, Dodge, Fernkampf auf große Distanz und Fernkampf mit einem Gegner in 5 ft.
- Dazu eine manuelle Wahl (GM-Entscheidung). Vorteil und Nachteil heben sich auf.
- Der Wurf zeigt beide d20 und die Gründe im Log.

**Konzentration**
- Ein Konzentrationszauber pro Figur; ein neuer beendet den alten samt seiner Effekte.
- Bei Schaden wird automatisch ein Konstitutionswurf gemacht (DC 10 oder halber Schaden).

**Zauber** (`src/game/spellEffects.ts`)
- **Zauberbuch im Kampf:** alle bekannten Zauber nach Grad, mit Slots, Beschreibung und „Ready“. Nicht vorbereitete Zauber sind ausgegraut.
- **Mehrere Ziele:** Bless, Bane, Hold Person, Invisibility … (Anzahl mit Upcast) sowie Strahlen und Geschosse (Scorching Ray, Magic Missile trifft automatisch, Eldritch Blast nach Stufe). Ziele wählst du per Rechtsklick (dasselbe Ziel auch mehrfach), dann „Cast“.
- **Buffs und Debuffs:** Bless/Bane (±1d4 auf Angriffe), Shield of Faith (+2 AC), Hunter's Mark/Hex (+1d6 bei eigenen Treffern), Blur.
- **Zustandszauber mit Rettungswurf:** Hold Person/Monster (paralyzed), Faerie Fire (Angriffe mit Vorteil), Web und Entangle (restrained), Command, Tasha's Hideous Laughter.
- **Heilzauber:** Ready, dann Rechtsklick auf Verbündete oder dich selbst; Upcast wird erkannt.

**Reaktionen**
- **Shield:** Wird ein Charakter getroffen, der Shield vorbereitet hat, einen Slot und die Reaktion frei hat, wartet der Schaden. Der Spieler entscheidet; mit +5 AC kann der Treffer zum Fehlschlag werden. Shield hält bis zum Beginn des eigenen nächsten Zugs.
- **Ready:** Angriff in der Ready-Leiste wählen, Auslöser eintragen, „Ready“ (kostet die Aktion). Wenn der Auslöser eintritt: Rechtsklick auf das Ziel, „Release readied attack“ (kostet die Reaktion). Gilt bis zum nächsten eigenen Zug.

**Klassenfähigkeiten** (`src/game/classFeatures.ts`, erkannt aus Klasse/Stufe und Fähigkeiten im Bogen; Nutzungen als Ressourcen im Bogen)
- **Action Surge:** eine zusätzliche Aktion in diesem Zug.
- **Second Wind:** 1d10 + Kämpferstufe HP.
- **Rage:** 10 Runden Resistenz gegen physischen Schaden, +2/+3/+4 Nahkampfschaden.
- **Wild Shape:** Bestie wählen. Angriffe, AC, HP und Speed der Bestie gelten im Kampf; kein Zaubern; Zurückverwandeln als Bonusaktion.
- **Lay on Hands:** Heilung aus dem Pool.
- **Bardic Inspiration:** Würfel auf den nächsten Angriff eines Verbündeten.
- **Sneak Attack:** automatisch einmal pro Zug bei Finesse- oder Fernkampfwaffe mit Vorteil oder einem Verbündeten am Ziel.
- **Divine Smite:** Slot im Angriffsmenü wählen; er wird nur bei einem Treffer verbraucht (+1d8 gegen Untote und Unholde).

**Elite-Fähigkeiten**
- Stat-Blocks können **Unterstützungsfähigkeiten** haben (z. B. *Blood war cry*: Verbündete in 30 ft +2 auf Treffer bis zum nächsten Zug der Elite).
- **Flächen mit Zustand** bei misslungenem Rettungswurf (z. B. *Grasping roots*: restrained). Der Orc Bloodcaller hat beides.

**Noch offen:**
- Rettungswürfe mit Vorteil/Nachteil aus Zuständen (z. B. paralyzed scheitert automatisch an STR/DEX) – der GM entscheidet.
- Dauer in Minuten außerhalb der Initiative.
- Weitere Reaktionen (Counterspell, Hellish Rebuke, Uncanny Dodge) und weitere Klassen (Ki, Channel Divinity, Metamagic).

## APEX 1.4 – Spielerblöcke, Spell-Listen, Standardangriff, Schleichen, Flanking

- **Spielerblöcke:** Jeder beendet seinen eigenen Teil; der Zug geht erst weiter, wenn alle fertig sind. „End turn“ des GM bei einer ausgewählten Figur beendet nur deren Teil, „Next turn“ im Initiativebereich den ganzen Block.
- **Spell-Listen:**
  - Importierte Zauber ohne Details (typisch für Aurora-PDFs) bekommen die Spielmechanik der SRD-5.1-Zauber, nur Zahlen, keine Texte: Reichweite, Wirkzeit, Angriff/Rettungswurf, Schaden, Fläche, Upcast, Heilung.
  - Damit funktionieren z. B. Fire Bolt, Produce Flame, Sacred Flame, Healing Word, Thunderwave, Fireball.
  - Der GM bekommt für eine ausgewählte Spielerfigur **dasselbe Kampf-Panel** wie der Spieler (Zauberbuch, Ready-Leiste, Fähigkeiten, Rechtsklick-Regeln) inklusive Bewegungsradius.
- **Fernkampf:** Reichweiten wie „120 ft“ wurden bisher als Nahkampf gelesen – behoben. Lange Reichweite (z. B. 80/320) ist erlaubt, mit Nachteil.
- **Standardangriff per Rechtsklick:**
  - Der in der Ready-Leiste gewählte Angriff ist der Standardangriff; er wird pro Gerät gemerkt.
  - Rechtsklick auf einen Gegner greift sofort an. Ist er außer Nahkampfreichweite, läuft die Figur den günstigsten Weg in Reichweite (wenn die Bewegung reicht) und greift dann an.
  - Ein vorbereiteter Zauber wird per Rechtsklick auf den Gegner gewirkt. Ohne Standardangriff öffnet sich das Menü.
  - Für NPCs gilt dasselbe mit dem gewählten Angriff.
- **Schleichen/Verstecken:**
  - „🥷 Sneak“ (außerhalb der Initiative frei) bzw. „Hide“ (Aktion; Bonusaktion mit Cunning Action oder Nimble Escape): Stealth-Wurf. „Party sneak“ des GM lässt alle würfeln.
  - Gegner sehen versteckte Figuren nur, wenn ihre passive Wahrnehmung den Stealth-Wert erreicht – serverseitig in Spielersicht und GM-Sichten.
  - „Search“ ist ein aktiver Wahrnehmungswurf.
  - Angreifen oder Zaubern deckt auf. Versteckt gibt es Vorteil, gegen Versteckte Nachteil.
  - Auf der Karte erscheint 🥷 unter der Figur.
- **Sneak Attack:** Schurken sehen im Angriffsmenü, ob Sneak Attack möglich ist (versteckt, unsichtbar, Flanking, Verbündeter am Ziel …) und können ihn an- oder abwählen. Der Server prüft die Bedingungen.
- **Flanking (Hex):** Steht ein Verbündeter genau gegenüber auf der anderen Seite des Ziels und sind beide angrenzend, gibt es Vorteil auf Nahkampfangriffe – für Spieler und Gegner.

## APEX 1.5 – Sicht-Vorschau, Buffs auf Verbündete, neues Kampf-Panel

- **Sicht-Vorschau:** Wer am Zug ist und über ein Hex fährt, sieht Linien von **diesem Hex** zu allen Gegnern, die man von dort sehen würde. Angezeigt werden die Entfernung und unten „👁 n in sight · m blocked“.
  - **Weiß:** in Reichweite des Angriffs oder Zaubers in der Hand.
  - **Gold gestrichelt:** sichtbar, aber zu weit.
  - Fährt man über einen Gegner, erscheint wie bisher die Linie von der eigenen Figur zum Ziel.
  - Gilt für Spieler, für den GM bei Spielerfiguren und bei NPCs (deren Gegner sind die Gruppe).
- **Buffs und Heilung auf Verbündete und sich selbst:**
  - Rechtsklick auf sich selbst oder einen Verbündeten wirkt einen unterstützenden Zauber auf ihn. Zauber für ein einzelnes Ziel wirken sofort.
  - Schadenszauber lassen sich nicht auf Freunde wirken.
  - Im Zauberbuch gibt es bei Unterstützungszaubern „cast on…“ (dich selbst oder einen Verbündeten).
  - Im Zielmenü eines Gegners stehen keine Buffs mehr.
  - Neu mit Spielmechanik (SRD-5.1-Zahlen, keine Texte):
    - **Mage Armor:** AC 13 + Dex, falls höher.
    - **Barkskin:** AC mindestens 16.
    - **Longstrider:** +10 ft.
    - **Haste:** +2 AC, doppelte Geschwindigkeit.
    - **Stoneskin:** Resistenz gegen physischen Schaden.
    - **Greater Invisibility.**
    - **Divine Favor:** +1d4 auf Waffentreffer.
    - **False Life, Armor of Agathys, Heroism:** temporäre TP auf dem Bogen.
    - **Lesser Restoration:** beendet blinded, deafened, paralyzed oder poisoned.
    - **Cure Wounds, Healing Word, Mass Healing Word, Mass Cure Wounds, Prayer of Healing:** mit Zielanzahl.
  - AC- und Tempo-Effekte zählen für Angriffe, für die Bewegung im Zug und für die Bewegungsvorschau von NPCs.
- **Kampf-Panel neu gestaltet:**
  - **Aktion, Bonusaktion, Reaktion:** ● Aktion, ◆ Bonus und ↺ Reaktion als leuchtende Marker, durchgestrichen wenn verbraucht.
  - **Bewegung:** Leiste mit 👣.
  - **Zauberplätze:** Rauten je Grad (I ◆◆◆◇), gefüllt = übrig.
  - **Aktionen als Kacheln:**
    - Attack, Cast spell, Dash, Disengage, Dodge, Hide/Sneak, Search, Help, Use object, Ready, Bonus mode und Other bonus.
    - Eine grüne Ecke steht für Aktion, eine gelbe Raute für Bonusaktion.
    - Aktive Zustände wie Dashing leuchten gold.
  - **Klassenfähigkeiten:** eigene Kacheln mit Restanzahl.
  - **„In hand“-Leiste:** Waffen mit Trefferbonus, Zauber mit Grad (∞, I, II, …). Unterstützungszauber sind grün mit ✚.
    - Ein Zauber in der Hand bekommt eine eigene Zeile mit Slotwahl und Anleitung.
  - **Zauberbuch:**
    - Reiter je Grad mit Slots und Karten mit Tags (Attack, Save, Heal/Buff, Fläche, Concentration, Bonus action).
    - „In hand“, „Cast on yourself“ oder „cast on…“ direkt auf der Karte.
    - Filter „prepared only“.

**Noch offen:**
- **Aid:** Erhöhung der maximalen TP nicht automatisiert.
- **Haste:** Zusatzaktion nicht automatisiert.
- **Heroism:** Temp-TP gibt es nur beim Wirken, nicht jede Runde.
- **NPC-Ziele:** Temp-TP auf NPCs notiert der GM.

## APEX 1.6 – Kampf-Feedback, Porträts, Lebensleisten, Handy

- **Animationen auf der Karte** für Spieler und GM:
  - **Fernkampf und Zauber:** eine farbige Schliere vom Angreifer zum Ziel.
  - **Nahkampftreffer:** ein Hieb.
  - **Am Ziel:** ein Aufblitzen und eine aufsteigende Zahl.
    - Schaden in der Farbe des Elements, z. B. Feuer orange, Kälte hellblau, Blitz gelb, nekrotisch violett.
    - „CRIT“ groß und golden.
    - „Miss“ und „Resisted“ grau.
    - Heilung grün mit Funken.
  - **Buffs und Debuffs:** ein Ring und ihr Name.
  - **Flächenzauber:** Die getroffenen Hexes blitzen in der Elementfarbe auf; jede getroffene Figur zeigt ihren Schaden.
  - Gilt auch für Shield, Second Wind, Lay on Hands, Rage und Bardic Inspiration.
  - Spieler sehen nur Effekte zwischen Figuren, die sie sehen. Nach einem Neuladen wird kein alter Kampf erneut abgespielt.
  - Bei „Bewegung reduzieren“ im System gibt es nur ein kurzes Einblenden.
- **Porträts:** Hochgeladene Charakterporträts erscheinen in den Figuren auf der Battlemap (zusätzlich zur Initiative-Leiste).
- **Lebensleisten:**
  - Charaktere der Gruppe haben unter der Figur eine Leiste: grün, unter der Hälfte orange, unter einem Viertel rot. Temporäre TP erscheinen als blauer Abschnitt.
  - Der GM sieht sie auch bei Gegnern und Verbündeten.
  - In Wild Shape zählen die TP der Tierform.
- **Zustands-Icons** über der Figur: ◎ Konzentration (pulsiert), 💫 stunned, ⤓ prone, ⛓ restrained, ☠ poisoned, 🥷 versteckt, ✨ Bless, ⏩ Haste und weitere. Schlechte Zustände sind rot umrandet, Buffs gold. Der Tooltip nennt den Namen.
- **Neue Regeln:**
  - **Haste:** eine Zusatzaktion pro Zug – ein Waffenangriff, Dash, Disengage, Hide oder Use an Object. Im Panel als blauer Marker „Haste“.
  - **Aid:** +5 TP-Maximum und aktuelle TP, +5 pro höherem Grad, bis zu 3 Ziele. Nicht stapelbar. Endet Aid (GM entfernt den Effekt), sinkt das Maximum wieder.
  - **Heroism:** temporäre TP in Höhe des Zaubermodifikators beim Wirken und zu Beginn jedes Zugs des Ziels.
  - **Temporäre TP für Gegner:** werden zuerst verbraucht und erscheinen für den GM in der Lebensleiste.
- **Handy:**
  - Tippen zeigt die Vorschau (Pfad, Sicht, Fläche); **gedrückt halten** wirkt wie ein Rechtsklick (bewegen, angreifen, zaubern).
  - Auf schmalen Bildschirmen kommt die Karte direkt nach Initiative und Zugleiste, das Kampf-Panel darunter. Vorher war sie unter dem Panel abgeschnitten.
- **Behoben:** Rechtsklick auf eine Figur mit einem Flächenzauber in der Hand (Feuerball auf den Ork) zielt jetzt dorthin, statt das Menü zu öffnen.

**Noch offen:**
- Haste: Lethargie nach dem Ende.
- Lebensleisten anderer Charaktere sind für Spieler sichtbar (Gruppe), die von Gegnern nur für den GM.

## APEX 1.7 – Druidin: Wild Shape, Shillelagh, Thunderwave

- **Wild Shape freischalten:** Wild Shape gibt es regulär ab Druidenstufe 2. Hat der Bogen eine Ressource „Wild Shape“ (oder die Fähigkeit), geht es auch früher. Das werte ich als GM-Entscheidung; es gelten die Grenzen von Stufe 2 (CR ¼, kein Fliegen/Schwimmen).
- **In Tierform:**
  - **Auf der Karte:** Die Figur zeigt das Tier-Icon (🐺, 🐻, 🐈 …) mit grünem Ring; die Lebensleiste zeigt die TP der Tierform.
  - **Im Kampf-Panel:** Ein grünes Banner zeigt die Tierform; Zauber sind gesperrt.
  - **Werte:** Es gelten Angriffe, Rüstungsklasse und Tempo der Tierform. Angriffe und TP werden sofort neu geladen, auch beim GM.
- **Zurückverwandeln bei 0 TP:** Fallen die TP der Tierform auf 0, verwandelt sich die Druidin zurück. Der Rest des Schadens geht auf ihre TP, das Log meldet es, und auf der Karte erscheint „Wolf → normal form“.
- **Shillelagh:** wird auf sich selbst gewirkt (Bonusaktion, 10 Runden). Solange es wirkt, trifft der Kampfstab bzw. die Keule mit dem Zauberangriffsbonus (sonst Übung + Weisheit) und macht 1W8 + Weisheit magischen Wuchtschaden, z. B. „Quarterstaff (Shillelagh) +6“.
- **Thunderwave und andere „Self (…)“-Flächen:** Der Würfel liegt immer direkt neben der Figur und zeigt in Richtung der Maus. „Self (10-foot radius)“ liegt um die Figur herum.
- **Fehlende Zauberwerte:** Steht kein Zauberangriff oder Rettungswurf-SG im Bogen, werden sie aus Klasse, Attribut und Übungsbonus berechnet.

## APEX 1.8 – 3D-Battlemap, Stufe 1: Höhen und 3D-Ansicht

- **Höhen pro Hex** in Stufen zu 5 ft (0–175 ft):
  - Gespeichert mit der Karte (`hex.heights`). Ältere Karten sind flach und bleiben unverändert; es gibt keine Migration.
  - Für Spieler werden unbekannte Hexes ohne Höhe übertragen.
- **Editor:** Neues Werkzeug „⛰ Height“ für Battle-Maps.
  - Stufe per Regler, ±, oder Schnellwahl 0/5/10/20/30 ft wählen und Hexes anklicken oder überstreichen. Ein großer Pinsel ist möglich.
  - „Flatten all“ macht die Karte wieder flach.
- **2D-Karte:**
  - Höheres Gelände ist heller.
  - Stufen (5 ft Unterschied) sind gestrichelte helle Kanten, Klippen (10 ft und mehr) dicke dunkle Kanten.
  - Der GM sieht die Höhe als ▲-Angabe, alle sehen sie im Hover-Tooltip.
- **Regeln:**
  - **Bewegung:** Eine Stufe hinauf kostet 5 ft extra, hinunter nichts. Klippen (zwei und mehr Stufen) sind für Gehende nicht passierbar. Das gilt für Pfad-Vorschau, Reichweite, Server-Bewegung, Gegnerbewegung und das „Hinlaufen und angreifen“.
  - **Sichtlinie:** Augen eine Stufe über dem Boden. Gelände, das höher ist als die Linie zwischen zwei Figuren, blockiert. Eine Stufe blockiert nicht, ein Hügel oder eine Klippe schon. Von oben sieht man darüber hinweg.
  - Das gilt für Sicht/Nebel, Angriffsreichweite, Flächen und die Sicht-Vorschau.
- **3D-Ansicht:**
  - Knopf „⛰ 3D“ oben rechts auf der Battlemap, für Spieler und GM. Die Wahl wird pro Gerät gemerkt.
  - **Gelände:** Hexes als Säulen in ihrer Höhe mit Felswänden; Mauern, Bäume und Felsen stehen als Objekte; Lichtquellen leuchten. Die Szene folgt der Tageszeit.
  - **Figuren:** stehen als Aufsteller mit Porträt bzw. Icon, Namen, Lebensleiste und Zustands-Icons, die Tierform mit Tier-Icon.
  - **Steuerung:**
    - Mittlere Maustaste gedrückt halten: drehen (links/rechts) und kippen (hoch/runter); alternativ Shift + linke Maustaste.
    - Linke Maustaste ziehen: verschieben. Mausrad: zoomen.
    - Tastatur: Q/E drehen, R/F kippen, Pfeiltasten verschieben, 0 zentriert.
  - **Bedienung wie in 2D:** Hover mit Info, goldene Pfad-Vorschau, Bewegungsbereich, Flächen-Vorschau, Rechtsklick zum Bewegen, Angreifen und Zaubern. Die Kamera folgt dem aktiven Zug.
  - three.js wird erst beim Umschalten geladen (≈150 KB gzip); die 2D-Karte bleibt so schnell wie bisher.

**Stufe 2 (geplant):**
- Fliegen und Höhe von Figuren (Fluggeschwindigkeit aus Bogen und Stat-Block, in der Luft stehen bleiben, Absturz).
- Shift + Mausrad wählt die Ebene in der Luft.
- 3D-Abstände für Reichweite und Gelegenheitsangriffe.
- Feuerball als Kugel mit verschiebbarem Mittelpunkt.
- Animationen auch in 3D.
- Klettern mit Klettergeschwindigkeit (Sinna hat 30 ft) und Fallschaden.

## APEX 1.9 – Kampf-Layout, Aktionsleiste, 3D Stufe 2 (Fliegen, Klettern, Fallen)

**Layout (Spieler und GM)**
- **Karte:** Die Battlemap steht groß in der Mitte. Die Initiative-Leiste liegt oben über der Karte.
- **Aktionsleiste im Stil von Baldur's Gate** unten über der Karte:
  - Aktion ●, Bonus ◆, Reaktion ↺ (bei Haste zusätzlich ein Haste-Marker), Bewegung und Zauberplätze I/II/III als Rauten.
  - 14 Schnell-Slots: Angriffe, Zauber (mit Grad ∞/I/II/III …), Standardaktionen und Klassenfähigkeiten.
  - Slots belegen: per Ziehen aus dem Panel (Aktions-Kacheln, „In hand“, Zauberbuch-Karten, Fähigkeiten). Innerhalb der Leiste durch Ziehen tauschen, Rechtsklick leert einen Slot. Gespeichert pro Charakter und Gerät.
  - Tasten 1–9 lösen die ersten neun Slots aus.
  - Großer „End turn“-Knopf rechts.
  - Reaktions-Abfragen (Gelegenheitsangriff, Shield) und die Anleitung zum Zauber in der Hand erscheinen direkt über der Leiste.
- **Detail-Panel:** Zielmenü, Zauberbuch, Effekte, Fähigkeiten, Kampflog und GM-Werkzeuge.
  - Position über die Knöpfe oben links auf der Karte: links ◧, unten ⬓, rechts ◨, oder ausblenden □ für nur Karte. Gespeichert pro Gerät.
  - Auf schmalen Bildschirmen liegt das Panel unten.

**3D Stufe 2**
- **Fliegen:**
  - Wer eine Fluggeschwindigkeit hat, kann in die Luft und dort bleiben. Quellen:
    - Bogen „Speed (flying)“;
    - Tierform;
    - Stat-Block (neu: Riesenfledermaus und Blutfalke mit 60 ft Fliegen);
    - Zauber **Fly** (60 ft, Konzentration).
  - **Shift + Mausrad** wählt die Zielhöhe (in 2D und 3D, 0–120 ft). Oben rechts steht „⇕ Aim 20 ft“; mit × geht es zurück auf den Boden.
  - Rechtsklick bewegt auf diese Höhe. Höhe kostet Bewegung wie Strecke. Im Flug gilt die Fluggeschwindigkeit, schwieriges Gelände und Klippen zählen nicht, Mauern schon.
  - Zwei Figuren dürfen auf demselben Hex stehen, wenn sie in verschiedener Höhe sind.
  - **Anzeige:** In 2D tragen Fliegende eine „↑ 20 ft“-Plakette und einen Schatten. In 3D schweben sie mit Schatten und Höhenlinie; die Zielhöhe ist ein leuchtendes Hex in der Luft.
- **Abstände in 3D:** Es zählt der größere Wert aus waagerechtem und senkrechtem Abstand. Das gilt für Nahkampf-Reichweite, Fernkampf- und Zauberreichweite sowie Gelegenheitsangriffe. Ein Biss erreicht keine Fledermaus in 20 ft Höhe, eine Armbrust schon.
- **Sichtlinie:** Fliegende schauen aus ihrer Höhe und werden dort gesehen.
- **Feuerball in der Höhe:**
  - Mit Shift + Mausrad liegt der Mittelpunkt der Kugel in der Luft. Getroffen wird nur, wer auch senkrecht innerhalb des Radius ist.
  - Kegel, Würfel und Linien reichen ihre Größe über die Höhe des Ursprungs hinaus.
- **Klettern:** Mit Klettergeschwindigkeit (z. B. Sinna, 30 ft) sind Klippen begehbar, rauf und runter ohne Aufpreis. Ohne Klettergeschwindigkeit bleiben sie gesperrt.
- **Fallen:**
  - Wer fliegt und liegend, kampfunfähig oder auf Tempo 0 gesetzt wird, fällt. Das gilt auch, wenn der Fly-Zauber endet, z. B. durch Konzentrationsverlust.
  - Schaden: 1W6 pro 10 ft (höchstens 20W6), danach liegt die Figur. Steht im Log, auf dem Bogen und als Animation.
- **3D-Optik:**
  - Höhere Auflösung (mindestens 1,5-faches Supersampling), filmisches Tonemapping, schärfere Schatten.
  - Bodentextur, Felswände mit Schichtung.
  - Gras mit vielen sich im Wind wiegenden Halmen; Bäume mit schwankenden Kronen; schimmerndes Wasser.
- **Kampf-Animationen in 3D:**
  - Schlieren mit leuchtendem Geschoss, Treffer-Blitz, aufsteigende Schadenszahlen.
  - Bei Flächenzaubern leuchten die Hexes auf, und eine Feuerkugel wächst.

**Offen / nächste Runde**
- Szenario-Presets: mehr Vorlagen mit Seed.
- Encounter-Generator: Lager, Hinterhalt, Belagerung; Challenge Rating nach Gruppengröße; danach feintunen.
- 3D: Klicken auf Figuren in der Luft ist in 3D etwas fummelig; dafür ein Zielmenü in der Leiste.
- Fallen bei Klippen ohne Flug („hinunterspringen“), Schieben und Stoßen.

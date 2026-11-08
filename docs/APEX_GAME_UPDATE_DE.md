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

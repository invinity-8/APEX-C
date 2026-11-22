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

## APEX 2.0 – 3D-Figuren, echter Maßstab, Kachel-Strukturen, Zielliste, Stoßen, Szenarien, Encounter-Generator

**Figuren in 3D**
- **Aufsteller:** Charaktere mit Porträt stehen als Aufsteller wie beim Tabletop: das Porträt in einer goldgerahmten Karte auf einem runden Sockel. Die Karte dreht sich zur Kamera.
- **Miniaturen:** Alle anderen (vor allem Gegner) bekommen eine kleine Miniatur nach Bauart und Größe aus dem Stat-Block:
  - Bauart: Humanoid (Gegner mit Klinge), Untoter (bleich), Vierbeiner, Flieger (schlagende Flügel), Spinne;
  - Größe: Tiny bis Gargantuan;
  - Elite mit Goldkranz, Druiden in Tierform als Tier.
- **Name und Lebensleiste** sitzen kompakt über der Figur. Gefallene liegen.
- **Ausbau später:** hochgeladene 3D-Modelle (GLB) wären möglich, als eigene Ausbaustufe.

**Echter Maßstab**
- Eine 5-ft-Stufe ist so hoch wie ein Hex breit. Figuren sind etwa 6 ft groß.
- Bäume sind etwa 22 ft hoch, Kiefern noch höher; Mauern 10 ft; Gras knöchel- bis kniehoch.
- Fliegende schweben in echter Höhe.

**3D-Strukturen für alle Kacheln**
- **Natur:** Bäume, Kiefern, Büsche, Hecken, Baumstümpfe, Felsen, Geröll, Stalagmiten.
- **Bauten:** Palisaden, Zäune, Türen, Säulen, Statuen, Treppen.
- **Einrichtung:** Tische, Kisten, Fässer, Betten, Altar.
- **Licht und Gefahren:** Lagerfeuer und Kohlebecken mit flackernder Flamme, leuchtende Pilze, Spinnennetze, Fallen mit Stacheln, Magiekreis.
- **Boden und Wasser:** Schilf im Sumpf, Brücke, Sanddünen, Schneehügel.
- **Bodentexturen je Familie:** Gras, Erde, Steinplatten, Dielen, Kopfsteinpflaster, Marmor, Teppich, Sand/Schnee/Eis.
- Die Klippenwände behalten ihre Felsfarbe.

**Sichtlinie in 3D**
- Wie in 2D: Über einem Hex zeigen Linien zu allen Gegnern, die man von dort sehen würde, mit Entfernung und „👁 n in sight“.
- Weiß heißt in Reichweite, gold gestrichelt zu weit.
- Über einem Gegner erscheint die Linie von der eigenen Figur zu ihm.

**Zielliste in der Aktionsleiste**
- Über der Leiste stehen die sichtbaren Gegner (bei Unterstützungszaubern die Verbündeten), nächster zuerst, mit Entfernung in 3D, ↑ für Fliegende und einem Punkt für „in Reichweite“.
- Ein Klick wirkt wie ein Rechtsklick auf die Figur: angreifen (inklusive Hinlaufen) oder zaubern. So trifft man auch Fliegende in 3D bequem.

**GM-Leiste für Gegner**
- Wählt der GM einen Gegner oder Verbündeten, erscheint dessen Leiste über der Karte:
  - Aktionspunkte und Werte;
  - Angriffe (der gewählte ist der Standard für Rechtsklick und Zielliste);
  - Flächenfähigkeiten, Kriegsrufe, Dash, Disengage, Dodge, Hide;
  - Stoßen (Wegstoßen/Umwerfen), dann Ziel in der Liste wählen;
  - End turn.

**Herunterspringen und Stoßen**
- **Herunterspringen:** Gehende dürfen Klippen hinunterspringen; die Wegberechnung nimmt eine Treppe, wenn möglich. Ab 10 ft gibt es Fallschaden (1W6 pro 10 ft), danach liegt die Figur.
- **Stoßen (5e-Shove):**
  - Ersetzt einen Angriff.
  - Stärke (Athletik) gegen Athletik oder Akrobatik des Ziels.
  - Das Ziel darf höchstens eine Größe größer sein und muss in 5 ft sein (in 3D).
  - Bei Erfolg wird es 5 ft weggestoßen oder umgeworfen:
    - über eine Klippe oder in eine Grube: Fallschaden;
    - in der Luft umgeworfen: Absturz.
  - Für Spieler im Zielmenü („✋ Push 5 ft“, „⤓ Knock prone“), für den GM in der Gegnerleiste.

**Szenario-Vorlagen (Editor, mit Seed neu würfelbar)**
- **Neu:** Banditenlager, Höhle, Hochlandpass, Dorfplatz, Sumpf, Tempelruine, Schlucht mit Brücke, Wüstenoase, Winterwald mit gefrorenem See.
  - **Banditenlager:** Palisade, Tore mit Kohlebecken, Lagerfeuer, Zelte.
  - **Höhle:** Stalagmiten, Pilze, Gruben, unebener Boden.
  - **Hochlandpass:** zwei Plateaus (15 und 25 ft) mit Treppen und Klippen.
  - **Dorfplatz:** Häuser mit Türen, Brunnen, Zäune.
  - **Sumpf:** Moor, Schilf, Baumstümpfe.
  - **Tempelruine:** Säulenreihen, erhöhte Altar-Empore mit Statuen.
  - **Schlucht mit Brücke:** tiefe Schlucht, Holzbrücke, hohe Ufer.
- **Bisher:** Waldlichtung, Bach mit Furt, Ruine, Dungeon, offenes Feld.

**Encounter-Generator (GM, im Seitenpanel)**
- Eingaben:
  - **Thema:** Kultisten, Ork-Kriegsbande, Banditen, Goblin-Plünderer, ruhelose Tote, wilde Tiere. Eigene Bibliotheks-Gegner, die zum Thema passen, kommen dazu.
  - **Situation:** Lager, Hinterhalt, Belagerung, Patrouille, Bau.
  - **Schwierigkeit:** easy bis deadly.
  - **Gruppe:** Größe und Stufe.
- **Generate:** Füllt das XP-Budget nach den DMG-Schwellen inklusive Gruppen-Multiplikator; ab „medium“ mit Anführer. „🎲 Reroll“ würfelt neu.
- **Vorschau:** zeigt XP, angepasste XP und die tatsächliche Schwierigkeit. Einträge lassen sich entfernen oder aus der Bibliothek hinzufügen, die Bewertung rechnet mit.
- **Platzieren nach Situation:**
  - **Lager:** um das Lagerfeuer bzw. die Mitte.
  - **Hinterhalt:** 20–35 ft um die Gruppe, bevorzugt in Deckung, alle versteckt mit gewürfeltem Stealth.
  - **Belagerung:** vom gegenüberliegenden Rand, Fernkämpfer auf der höchsten Stelle.
  - **Patrouille:** als Trupp in etwa 40 ft.
  - **Bau:** auf der fernen Kartenseite.

## APEX 2.1 – Low-Poly-Figuren, Asset-Bibliothek, Stadt- und Land-Layouts, Gegnergruppen, Tempo

**Tempo („crispy und schnell“)**
- **GM-Aktualisierung:** Der Server schickt die unveränderten Arena-Hexe nicht mehr bei jeder Aktualisierung mit (Signatur-Abgleich). Eine GM-Aktualisierung schrumpft von etwa 296 KB auf etwa 18 KB.
- **Start:** Seiten abseits der Karte werden erst bei Bedarf geladen (Charakter, Inventar, Arsenal, Gegnerbibliothek, Szenen). Das beim Start geladene JavaScript sinkt von 1116 KB auf 925 KB (gzip 332 → 293 KB), obwohl alle Neuerungen dieser Runde dazugekommen sind. three.js und der Figuren-Baukasten werden erst mit der 3D-Ansicht oder dem Figuren-Editor geladen.
- **3D-Qualität:** Umschalter „low / medium / high“ oben rechts in der 3D-Karte. Die Wahl wird pro Gerät gespeichert; schwache Geräte starten automatisch mit „low“.
  - **low:** Auflösung 1×, keine Schatten, kein Gras, Bild nur bei Änderungen.
  - **medium:** etwas schärfer, Schatten, weniger Grashalme, höchstens 30 Bilder pro Sekunde.
  - **high:** wie bisher.
- **Weniger Rechenlast:**
  - Schatten werden nur neu berechnet, wenn sich Gelände oder Figuren ändern.
  - Alle festen Requisiten einer Karte und alle Teile einer Figur werden je Material zu einem Objekt zusammengefasst.
  - Klicks werten nur noch den Boden aus.
- **Messwerte:** Im Testbrowser (Software-Grafik) stieg die 3D-Bildrate von 4 auf etwa 58 Bilder pro Sekunde bei „medium“.

**Low-Poly-Figuren und Figuren-Editor**
- **Stil:** Kantige, flach schattierte Miniaturen im Brettspiel-Stil mit großem Kopf und kurzen Gliedern.
- **Teile-Baukasten:** 215 Teile in 22 Plätzen:
  - **Körper:** Abstammung (Mensch, Zwerg, Elf, Halbling, Gnom, Ork, Goblin, Tiefling, Drachengeborener, Echsenmensch, Skelett, Zombie, Oger) und Statur.
  - **Kopf und Gesicht:** Kopfform, Augen, Brauen, Nase, Mund, Ohren, Hörner, Haare, Bart.
  - **Kleidung:** Kopfbedeckung, Oberkörper (Tunika bis Plattenpanzer), Schultern, Gürtel, Beine, Schuhe, Umhang.
  - **Ausrüstung:** Rücken (Rucksack, Köcher, Banner, Flügel …), Haupthand mit 25 Waffen und Instrumenten, Nebenhand (Schilde, Buch, Laterne, Kugel, Heiliges Symbol …).
  - **Details:** zum Beispiel Kriegsbemalung, Narbe, Monokel, Pfeife.
- **Farben:** 7 Farbplätze (Haut, Haar, Haupt- und Akzentfarbe, Leder, Metall, Augen), jeweils mit Farbfeldern oder frei wählbar.
- **Vorlagen:** 36 Stück, darunter Helden wie Kämpfer, Magier, Schurke, Kleriker, Paladin oder Barde, NPCs wie Bandit, Kultist, Wache, Ritter, Pirat oder Händler und Monster wie Ork, Goblin, Skelett, Zombie, Oger oder Echsenmensch. Dazu kommt ein Würfel für zufällige Figuren.
- **Spieler:** Character → Appearance → „3D figure“.
  - Die Live-Vorschau lässt sich drehen.
  - Teile wechselt man mit ◀ ▶ oder direkt per Klick.
  - Speichern setzt die Figur auf die 3D-Karte.
  - Ohne gespeicherte Figur bekommt jeder Held eine Heldenvorlage in seiner Tokenfarbe. Ein hochgeladenes Porträt bleibt ein Aufsteller, bis eine Figur gespeichert ist.
- **Spielleiter:** Gegnerbibliothek → Kreatur → „🧍 3D figure“ legt das Aussehen eines Werteblocks fest.
- **Automatische NPC-Figuren:** Menschenähnliche Gegner ohne festes Aussehen erhalten automatisch die passende Vorlage nach Name oder Typ, und zwar pro Figur in einer anderen Variante. Fünf Banditen haben also fünf verschiedene Gesichter, Frisuren und Waffen. Tiere und Bestien behalten ihre Modelle.
- **Speicherung:** Rein kosmetisch. Das Aussehen hängt am Charakter (`setAppearance` mit `figure`, serverseitig geprüft) und ist für alle sichtbar wie die Farben.

**3D-Asset-Bibliothek (57 neue Kacheln, jetzt 104)**
- **Hof und Dorf:** Weizenfeld, Gemüsebeet, Blumenwiese, Heuhaufen, Brunnen, Wagen, Holzstapel, Vogelscheuche, Tränke, Bienenstöcke, Trockenmauer, Kate (Reet), Scheune, Windmühle, Zelt, Wegweiser, Grabsteine, Schlafsack, Übungspuppe.
- **Natur:** Obstbaum, Birke, toter Baum, umgestürzter Stamm, verstreute Steine, Kristalle, Seerosenteich.
- **Stadt:** Steinhaus, Fachwerkhaus, Laden mit Markise, Stadtmauer mit Zinnen, Rundturm, Torhaus, Marktstand, Brunnen mit Fontäne, Straßenlaterne, Bank, Blumenkübel, Kanal, Gullideckel, Bannermast, Steg, Ruderboot.
- **Innenräume und Gruft:** Tresen, Bücherregal, Truhe, Kamin, Esse mit Amboss, Waffenständer, Thron, Sarkophag, Knochen, Käfig, Urnen, Leiter, Wegschrein, Totem.
- **Gebäude:** Jedes Gebäude-Hex ist ein Wandblock mit sechseckigem Dach. Mehrere bemalte Hexe ergeben ein Haus mit lebendiger Dachlandschaft (Reet, rote Ziegel, Schiefer).

**Layouts für Land und Stadt (11 neue Vorlagen, mit Seed)**
- **Land:**
  - Gehöft (Felder mit Zaun, Scheune, Heu, Brunnen);
  - Weiler an einer Kreuzung;
  - ummauerter Obstgarten;
  - Friedhof mit Kapelle;
  - Herrenhaus mit Garten.
- **Stadt:**
  - Marktplatz mit Fontäne und Ständen;
  - Gassen mit Kanal und Brücken;
  - Hafen mit Stegen;
  - Stadtmauer mit Türmen, Tor und Belagerungslager.
- **Innen:** Taverne (Schankraum, Kamin, Zimmer) und Gruft.

**Farbstil und Stimmung**
- **Neue Farbpaletten:** 10 Stück.
  - Land: Frühlingswiese, Erntegold, Bilderbuch, graues Moor.
  - Stadt: Sandstein, Schiefer und Ruß, Königsviertel, Küste.
  - Dazu: Mondnacht, Asche.
- **Paletten in 3D:** Sie färben jetzt auch die 3D-Karte (Boden, Requisiten, Gras) wie in 2D.
- **3D-Stimmung pro Karte:** im Editor unter „Colour scheme“. Zur Wahl stehen heller Tag, goldene Stunde, bedeckt, Dämmerung, Nacht, Nebel, Bilderbuch (kräftig) und Düster (verflucht). Ohne Auswahl folgt das Licht der Tageszeit.

**Gegnergruppen und Spawnpunkte (die „Dreier-Kombination“)**
- **Gruppen:** 15 fertige Gruppen, zum Beispiel Kultistenzelle, Banditenbande, Hinterhalt, Ork-Kriegstrupp, Goblins mit Oger, ruhelose Tote, Skelettwache, Wolfsrudel, Spinnennest und Bär mit Falken.
- **Eigene Gruppen:** Gegnerbibliothek → „Groups“ mit 1–12 Kreaturen aus der Bibliothek, Symbol, Farbe, GM-Notiz und XP.
- **Im Szeneneditor:** Werkzeug „⚔ Enemy groups“. Eine Gruppe auf die Karte ziehen, oder antippen und dann ein Hex anklicken. Das ergibt einen versteckten Spawnpunkt.
- **Automatisch setzen:** „Place matching groups“ setzt passende Gruppen zum gewählten Layout (etwa Kultisten auf dem Markt, Untote auf dem Friedhof), weit weg vom Ankunftspunkt der Gruppe.
- **Kombination:** Layout × Farbpalette/Stimmung × Gegnergruppe ergibt in drei Klicks ein fertiges Szenario.
- **Im Spiel:** „⚔ Enemy groups on this map“ in den Kampfwerkzeugen.
  - „Spawn“ setzt die Gruppe auf die freien Hexe am Marker; „Spawn all“ setzt alle.
  - Jede Kreatur würfelt Initiative und hat ihr eigenes Aussehen.
  - Die Marker sieht nur der Spielleiter, in 3D als rote Fahne.

**Tests:** 539 Tests grün. Neu:
- Figuren-Baukasten (Validierung, Varianten, Speichern und Rechte);
- Asset-Bibliothek und Layouts (alle Größen und Seeds gültig und begehbar);
- Gruppen (Validierung, Platzierung, Composer, Spawnen über die API, Marker nie bei Spielern).

## APEX 2.2 – Frisuren, Kreaturen-Baukasten, Reittiere und Flügel, 3D im Szeneneditor

**Frisuren und Bärte neu modelliert**
- **Haarschale:** Jede Frisur besteht aus einer Haarschale, die der Kopfform folgt. Sie ist entlang eines echten Haaransatzes geschnitten (Stirn, Schläfen, über den Ohren, Nacken).
- **Strähnen:** Darauf liegen geformte, kantige Strähnen für Pony, Seitenpartien, Mähnen, Kämme und Zöpfe.
- **Neue Frisuren:** 12 Stück, zusammen jetzt 28. Neu sind Zurückgekämmt, Undercut, Afro, Dreads, Vokuhila, Zottelig, Wallend, Tonsur, Einzelzopf, Kamm, Pagenkopf und Seitenscheitel.
- **Kopfbedeckungen:** Unter Mützen und Helmen schaut das Haar unter der Krempe hervor. Kapuzen verdecken den Scheitel; lange Haare bleiben sichtbar.
- **Bärte:** Vollbärte sind eine Kieferschale mit Strähnen. Langer, gegabelter und geflochtener Bart sowie Schnurrbärte sind geformt.

**Kreaturen-Baukasten (76 Modelle)**
- **Tiere:** Wolf, Hund, Hyäne, Bär, Eisbär, Keiler, Hirsch, Ziege/Widder, Ochse/Stier, Löwe, Panther, Tiger, Riesenratte, Krokodil, Riesenechse, Elefant, Mammut, Affe, Frosch, Hai, Fisch, Würgeschlange, Kobra, Riesenspinne, Skorpion, Käfer, Krabbe, Tausendfüßer, Adler, Eule, Rabe, Geier, Fledermaus.
- **Reittiere:** Pferd, Kriegsross mit Rossharnisch, Pony/Maultier, Kamel, Worg, Reitechse, Pegasus, Einhorn, Nachtmahr, Greif, Hippogreif, Roc.
- **Monstrositäten:** Eulenbär, Basilisk, Mantikor, Hydra, Purpurwurm, Mimic, Rostmonster, Minotaurus, Yeti.
- **Drachen:** Drache in zwölf Farben (rot, blau, grün, schwarz, weiß, gold, silber, bronze, kupfer, messing, Schatten, Feen), Wyvern, Drake.
- **Aberrationen:** Beholder, Aboleth, Otyugh, Gibbering Mouther, Oktopus/Kraken-Brut.
- **Elementare und Schleime:** Feuer-, Wasser-, Luft- und Erdelementar, Schleim/Pudding, Gallertwürfel, Irrlicht.
- **Konstrukte und Pflanzen:** Golem (Stein, Eisen, Lehm, Fleisch), Gargyl, Treant, Schlurfender Hügel.
- **Geister und Unholde:** Geist/Gespenst/Schreckgespenst, großer Dämon/Teufel, Höllenhund.
- **Flügel:** Sie schlagen in der 3D-Karte (Federn, Hautflügel, Insektenflügel); am Boden nur leicht.
- **Automatisch:** Name und Typ des Werteblocks wählen das Modell. „Young Red Dragon“ wird ein roter Drache, „Gelatinous Cube“ ein Würfel, ein Werteblock vom Typ Aberration ein Gibbering Mouther. Humanoide behalten ihre Figuren.
- **Tierform:** Die Tierform der Druiden zeigt das passende Tier.
- **Spielleiter:** Gegnerbibliothek → „🧍 3D figure“ → „Creature model“ legt ein Modell (bei Drachen mit Farbe) für einen Werteblock fest, mit Live-Vorschau. Die Wahl wird serverseitig geprüft.

**Reittiere und Flügel für Helden**
- **Reittier:** Neuer Platz „Mount“ im Figuren-Editor mit 14 Reittieren, vom Pferd bis zum Wyvern. Die Figur sitzt im Sattel, geflügelte Reittiere schlagen mit den Flügeln.
- **Flügel auf dem Rücken:** Federflügel, Fledermausflügel, Feenflügel und Drachenflügel.
- Rein kosmetisch, ohne Regelwirkung.

**3D im Szeneneditor**
- **Umschalter:** ⛰ 3D / ⬢ 2D oben rechts in der Editor-Karte, pro Gerät gespeichert.
- **Malen in 3D:** Ein Klick malt das Hex mit der gewählten Kachel oder Höhe; der große Pinsel malt die Nachbarn mit.
- **Marker in 3D:** Spawn, Orte, Licht und Gegnergruppen werden per Klick gesetzt.
- **Anzeige:** Spawn (grün), Orte (gold) und Gegnergruppen (rote Fahne) sind in 3D zu sehen.

**Tests:** 543 Tests grün. Neu ist `creatures22`:
- Alle Modelle, Frisuren, Bärte, Rückenteile und Reittiere bauen fehlerfrei; Listen und Baukasten sind synchron.
- Gängige Monsternamen landen beim richtigen Modell.
- Die Kreaturwahl wird validiert.
- Alte Figuren ohne Reittier bleiben gültig.

## APEX 2.3 – Frauen und Männer, Leerlauf-Animationen, Licht, Relief, Bestiarium 2.0

**Sechs Körpertypen**
- **Neuer Platz „Body“:** Frau oder Mann, dazu die Statur schlank, muskulös oder kräftig. Im Figuren-Editor stehen sechs Schnellwahl-Knöpfe. Ältere Staturen bleiben gültig.
- **Frauen:** Taille, breitere Hüften, Brust, schmalere Schultern, feinere Glieder und schlankerer Hals, dazu Wimpern und getönte Lippen.
- **Muskulös:** kräftige Schultern und dickere Arme.
- **Heldinnen:** zehn neue Vorlagen (Schildmaid, Zauberin, Jägerin, Priesterin, Walküre, Hexe, Schurkin, Druidin, Mönchin, Paladinin).
- **NPCs:** Banditen, Wachen, Kultisten und andere sind in etwa der Hälfte der Fälle Frauen, mit passenden Frisuren und ohne Bart.

**Leerlauf-Animationen** (ab Qualität „medium“)
- **Atmen:** Alle Figuren atmen und verlagern leicht das Gewicht.
- **Hinsehen:** Figuren drehen sich langsam zum nächsten Gegner und behalten die Richtung. Helden und NPCs drehen zusätzlich den Kopf.
- **Ruhen:** Tiere, Monster und Drachen legen sich hin und falten die Flügel, solange kein Gegner näher als 25 ft ist. Kommt jemand heran, stehen sie auf und schauen ihn an.

**Licht**
- **Lichtquellen:** Lagerfeuer, Kohlebecken, Kamine, Essen, Lava, Straßenlaternen, Kristalle, Leuchtpilze und Magiekreise leuchten ihre Umgebung aus. Feuer flackert.
- **„high“:** Bloom auf Glühendem (Flammen, Magie, erleuchtete Fenster) und weiche Schatten.
- **Neue Stufe „ultra“:** zusätzlich Umgebungsverdeckung (GTAO) für tiefe Ecken und Kontaktschatten.
- **Markierungen:** Mit Bloom und Umgebungsverdeckung erscheinen Reichweite und Pfad als klare Hex-Ränder.

**Relief**
- **Höhenstile:** Acht Stile (sanfte Hügel, wellige Höhen, Terrassen, Tal, Grat, Schlucht, Plateaus, Klippen) mit Stärke 1–5 und Seed. Im Szeneneditor unter „Relief (heights)“.
- **Regeln:**
  - Wasser liegt in den Senken, Häuser stehen eben.
  - Hänge bleiben begehbar, also höchstens eine Stufe pro Hex. Terrassen und Klippen bilden absichtlich Steilwände.
- **Layouts:** Ländliche Vorlagen sowie Wald, Fluss, Sumpf, Winter, Ruinen und Lager bekommen automatisch ein passendes Relief. Stadtplätze bleiben eben.

**Bestiarium 2.0 (136 Modelle)**
- **Neu:** 60 Modelle.
  - **Hof- und Kleintiere:** Hase, Schaf, Kuh, Schwein, Huhn, Ente/Gans, Schwan, Katze, Fuchs, Dachs, Eichhörnchen, Igel, Esel, Zebra, Lama, Bison, Nashorn, Nilpferd, Giraffe, Schildkröte, Schnecke, Schmetterling.
  - **Magische Tiere:** Displacer Beast, Blinkhund, Winterwolf, Geisterwolf und Geisterhirsch, Wolpertinger, Mondhase, Kitsune, Feuerfuchs, Cockatrice, Phönix, Donnervogel, Kerberos, Chimäre.
  - **Monster:** Bulette, Ankheg, Aaskriecher, Umber Hulk, Roper, Darkmantle, Seeschlange, Riesenqualle, Krake.
  - **Aberrationen:** Grell, Intellect Devourer, Flumph, Gazer, Nothic, Cloaker, Slaad.
  - **Pflanzen:** Myconid, Leuchtpilz-Riese, fleischfressende Pflanze.
  - **Untote:** Knochendrache, Skelettross.
  - **Bosse:** Weltenschildkröte, Himmelswal, Obsidian-Koloss.
- **Varianten:** männlich, weiblich und jung, zum Beispiel Bär, Bärin und Bärenjunges. Die Löwin hat keine Mähne, die Hirschkuh kein Geweih, die Kuh kleine Hörner; Jungtiere haben große Köpfe, kurze Beine und keine Hörner.
  - Wählbar im Creature Picker, oder automatisch aus Namen wie „cub“, „lamb“, „Lioness“, „Bärin“ oder „Kalb“.
- **Zuordnung:** Deutsche Namen und Synonyme werden erkannt (Hase, Schaf, Bärin, Roter Drache …). Ausnahmen werden zuerst geprüft: Eine Wolfsspinne ist eine Spinne, Werwölfe bleiben menschenähnliche Figuren.
- **Lebendige Biome:** Tiergruppen als Kartenmarker (Art und Anzahl), rein dekorativ und auch für Spieler sichtbar.
  - In 3D grasen, hüpfen, picken oder streifen die Tiere umher, Vögel und Fledermäuse kreisen am Himmel. Kommt eine Figur zu nahe, weichen sie aus.
  - Im Editor setzt das Werkzeug „🐾 Animals“ eine Gruppe. Beim Generieren kommen passende Tiere dazu: Schafe, Hühner und Kühe auf dem Gehöft, Krähen und Fledermäuse auf dem Friedhof, Frösche und Irrlichter im Sumpf.

**Tests:** 549 Tests grün.
- **Neu:** Relief (`relief23`) und Bestiarium (`bestiary23`), außerdem Körpertypen.
- **Korrektur:** Der Wild-Shape-Test (`battle17`) berücksichtigt jetzt kritische Treffer; er schlug zuvor zufällig etwa jeden sechsten Lauf fehl.

## APEX 2.4 – Gegnerbibliothek, Flug, Schleichen, Gesichter, Journal

**Enemy Library: 150 eingebaute Kreaturen**
- **Neu:** 135 Stat-Blöcke zusätzlich zu den bisherigen 15, passend zu den 3D-Modellen.
  - Tiere und Reittiere, Monstrositäten, Drachen (Wyrmlinge bis erwachsener roter Drache, Wyvern, Knochendrache), Riesen, Schleime, Elementare, Konstrukte, Pflanzen, Untote, Unholde, Aberrationen und weitere Humanoide (Wache, Veteran, Ritter, Magier, Priester, Assassine, Hobgoblin, Bugbear, Kobold, Gnoll …).
- **Zahlen:** SRD 5.1, vereinfacht wie bisher (RK, TP, Bewegung inkl. Fliegen/Klettern, Attribute, HG, Hauptangriffe, Flächenfähigkeiten wie Odem mit Rettungswurf und SG).
  - Eigenschaften sind kurze eigene Zusammenfassungen. Es wurden keine Beschreibungen übernommen.
  - Kreaturen ohne SRD-Vorlage (Schaf, Kuh, Bulle, Löwin, Knochendrache, Grell, Nothic, fleischfressende Pflanze, Pirat) sind als „APEX“ markiert.
- **Modelle:** Jede Kreatur bekommt automatisch das passende 3D-Modell, z. B. Wyrmlinge als junge Drachen in ihrer Farbe. Menschenähnliche Untote (Ghul, Mumie, Skelett …) nutzen den Figurenbaukasten.
- **Game → Add Enemy:** Statt der Auswahlliste gibt es eine immer sichtbare Liste mit Suche.
  - Suche nach Name, Typ, „cr 2“ oder „fly“; Filter nach Kreaturtyp; sortiert nach HG.
  - Die gewählte Kreatur wird mit Größe, Typ, Bewegung und Angriffen angezeigt.

**Fliegen**
- **Sicht aus der Höhe:** Wer fliegt, schaut über Bäume und Mauern hinweg. Hindernisse verdecken die Sicht nur bis 15 ft über ihrem Boden.
  - Bei hellem und dämmrigem Licht wächst die Sichtweite mit der Flughöhe (+5 ft pro 5 ft Höhe). Gilt für Spieler-, Gruppen- und Gegnersicht sowie für die Sichtlinien-Vorschau in 3D.
- **Reichweite in 3D:** Für fliegende Figuren zeigt die 3D-Karte die erreichbaren Punkte als gestufte Glaskuppel rund um die Figur.
  - Waagerechter Weg plus Steigen oder Sinken muss in die verbleibende Bewegung passen, wie auf dem Server.
  - Mit Shift + Mausrad die Zielhöhe wählen. Der Pfad steigt bzw. sinkt sichtbar zur Zielhöhe und wird rot, wenn er zu weit ist.

**Schleichen**
- **Charakterbogen:** Sneak und Wild Shape sind aus dem Charakterbogen entfernt. Sie werden nur noch im Game-Tab benutzt.
  - Der Bogen zeigt den Wild-Shape-Zustand weiter an, und Font of Magic bleibt dort.
- **Ducken:** Schleichende (versteckte) Figuren gehen in 3D in die Hocke.
- **Wahrnehmungsringe:** Solange jemand schleicht, zeigt die 3D-Karte um jeden wachen Gegner einen Ring. Das ist eine APEX-Tischhilfe, keine neue Regel.
  - **Radius:** 5 ft × passive Wahrnehmung, höchstens bis zur Sichtweite (hell 120 ft, dämmrig 60 ft, dunkel Dunkelsicht bzw. 10 ft).
  - **Rot:** Der Gegner würde den Stealth-Wert eines Schleichenden erreichen, sobald er ihn sieht.
  - **Gestrichelt gold:** Der Wurf schlägt seine passive Wahrnehmung.
  - Eine Legende erklärt die Farben.
- **GM-Hinweise:** Über Gegnern erscheint „❗“, wenn einer einen Schleichenden im Radius und in Sicht entdecken würde.
  - „❓“ mit Pfeil zeigt ein Geräusch aus dieser Richtung: im Radius, aber hinter Deckung oder knapp (1–4) über seiner passiven Wahrnehmung.
  - Die Battle Command listet alle Hinweise mit „Reveal“. Aufgedeckt wird nichts automatisch; die Regeln bleiben SRD.

**Boden und Wasser**
- **Boden:** Die Oberflächentextur läuft jetzt in Weltkoordinaten über die Hexfelder, ohne Wiederholung pro Feld.
  - Ab „medium“ gibt ein Bump-Map Relief (Steine, Fugen, Erdklumpen). Großflächige Farbschattierungen brechen gleichförmige Flächen auf.
  - Regeltechnisch bleibt alles eben.
- **Wasser:** Zwei Wellenmuster ziehen langsam über die Oberfläche.

**Figuren: Gesichter und Haare**
- **Augen:** fünf neue Formen (Mandel, rund, Katze, Schlupflid, strahlend), mit Weiß, Iris, Pupille und Lichtpunkt. Auch die einfachen Punktaugen haben jetzt einen Lichtpunkt.
- **Gesicht:**
  - Neue Brauen (gebogen, hochgezogen, Monobraue, gespalten), Nasen (klein, Stups, lang, schief, Adler) und Münder (Schmunzeln, Schmollmund, Lippen, Zähne, Fauchen).
  - Neues Teil „Face sculpt“: Wangenknochen, kantiges oder weiches Kinn, Grübchen, Falten, Eyeliner, Lippenstift, Nasenring, Schönheitsfleck, Gesichtstattoo, Wangennarbe, hager, pausbäckig.
  - Jedes menschenähnliche Gesicht hat jetzt Kinn und Wangen.
- **Haare:**
  - Acht neue Frisuren: wellig, Pixie, Seitenscheitel, Cornrows, hoher Zopf, Space Buns, Half-up, Mähne.
  - Alle Frisuren sind voller: Haarschale weiter außen, breitere Strähnen.
- **Kopfbedeckung:** Unter Kappe, Helm, Hut, Kapuze oder Turban verschwinden die Haare nicht mehr. Ein Pony schaut unter der Krempe hervor, an den Seiten hängen Strähnen, lange Haare fallen über den Rücken.
- **Varianten:** Die zufälligen Varianten der NPC-Vorlagen nutzen die neuen Formen.

**Journal als Buch**
- **Doppelseite:**
  - **Links das Inhaltsverzeichnis:** Einträge mit Punktlinie und Datum, Suche, weitere Filter, Personen und Orte.
  - **Rechts die aufgeschlagene Seite:** Lesen mit Initiale, Metazeile, Bild und Rückverweisen, oder Schreiben auf liniertem Papier.
- **Lesezeichen:** Kapitelbänder am Buchrand filtern nach Kategorie.
- **Funktionen:** Alle bisherigen Funktionen bleiben erhalten (Teilen, Anheften, Personen und Orte verlinken, Bild, Export).
- **Mobil:** Auf dem Handy stehen die Seiten untereinander.

**Scenes-Tab**
- **Kopfzeile:** Name, Status und Aktionen (Duplizieren, Archivieren, ← Library) in einer Zeile. Karte und Werkzeuge kommen direkt danach.
- **Einstellungen:** Name, übergeordnete Szene, Standard-Atmosphäre und Standard-Hintergrund liegen eingeklappt unter der Karte („⚙ Scene settings“).
- **Kachelpalette:** kompakter und scrollbar.

**Tests:** 560 Tests grün.
- **Neu:** `bestiary24` (Stat-Blöcke gültig, eindeutige IDs, Modelle; Flugsicht), `stealth24` (Radien, ❗/❓, Richtung) und `faces24` (alle Gesichtsteile, Haare unter jeder Kopfbedeckung).

## APEX 2.5 – Weltzeit, Wetter, Horizont, weicher Boden, Bewegungshilfen

**Kamera und Bedienung**
- **WASD:** schiebt die Kamera in 3D (gedrückt halten, gleitend) und in 2D, solange die Maus über der Karte ist oder die Karte den Fokus hat. In Eingabefeldern greift WASD nicht.
- **Doppelklick auf eine Figur:** zentriert die Kamera auf sie, auch auf Gegner und außerhalb ihres Zuges (2D und 3D).
- **Laufanimation in 3D:** Spieler und Gegner laufen (oder fliegen) sichtbar ihren Pfad entlang, mit Blick in Laufrichtung.
- **Mauszeiger:** ein vergoldeter Zeiger im Stil einer Gladius-Spitze mit Lorbeer; über Knöpfen mit kleinem Stern.

**Was ein Rechtsklick tut**
- **Symbol am Mauszeiger:** zeigt, was ein Rechtsklick jetzt auslösen würde:
  - 👣 laufen (mit Fuß-Angabe), 🗡️ Nahkampf, 🏹 Fernkampf, ✨ Zauber oder Flächenfähigkeit;
  - 👣🗡️ hinlaufen und angreifen, ☰ Aktion wählen, ⛔ geht nicht (außer Reichweite, kein Weg).
  - Gilt für Spieler und für den GM (Charaktere und Gegner).
- **Pfadfarben:** weiß, so weit die Bewegung reicht; orange, wo nur ein Dash hinkommt; rot darüber hinaus (2D und 3D).
- **Zu weit:** Ein Rechtsklick über die Bewegung hinaus öffnet eine Auswahl. Ein zweiter Rechtsklick nimmt den ersten Eintrag, Esc bricht ab.
  - „Dash (Aktion) und hin“.
  - „Dash als Bonusaktion“ (mit Cunning Action).
  - „So weit wie möglich“.
  - Reicht auch ein Dash nicht, gibt es „mit Dash so weit wie möglich“.
- **GM:** Ausgewählte Gegner zeigen dieselben Pfade, Symbole und Dash-Auswahl. Die Gegnerleiste hat jetzt eine Bewegungsleiste wie die Spieler (mit Dash-Markierung).

**Sicht**
- **Dunkelsicht:** Charaktere sehen im Dunkeln mit Darkvision aus dem Bogen, sonst aus der Abstammung (Zwerg, Elf, Halbork, Gnom, Tiefling … 60 ft; Drow 120 ft) oder aus der Wild-Shape-Form. Gegner nutzen die Sinne ihres Stat-Blocks.
- **Blindsicht:** Blindsight, Tremorsense und Truesight wirken ohne Licht.
- **Dämmerlicht:** Dunkelsicht reicht bei Dämmerlicht weiter als die üblichen 60 ft.
- **Nebel:** begrenzt die Sicht auf 30 ft (Blindsicht ausgenommen).

**Zeit, Wetter, Jahreszeit**
- **Zifferblatt (GM, Game-Tab → „Time, season and weather“):** gezeichnete Tag/Nacht-Scheibe; die Sonne bzw. den Mond ziehen, um die Uhrzeit zu stellen.
  - **Zeit laufen lassen:** ▶ Run, in Echtzeit (×1) oder schneller (×6, ×60, ×360).
  - **Springen:** „Skip to dawn“ (nächster Morgen, z. B. nach dem Lagern), „Skip to 4 am“, Mittag, Abend, +1 h.
- **Kampagnenweit:** Uhrzeit und Jahreszeit gelten für alle Szenen.
  - **Licht:** Das Licht einer Szene folgt der Uhrzeit (7–18 Uhr hell, Morgen- und Abenddämmerung dämmrig, nachts dunkel), außer der GM stellt es von Hand. Der Haken „follows the time of day“ schaltet zurück.
  - **Spieler:** sehen eine kleine Uhr auf der Karte.
- **Wetter pro Szene:** klar, Schäfchenwolken, bewölkt, dunkle Wolken, Regen, Nebel, Schnee. In 3D gibt es ziehende Wolken, fallenden Regen und Schnee, und Himmel und Licht passen sich an.
- **Jahreszeit:** Frühling (frisches Grün), Sommer, Herbst (Laub orange-rot), Winter (fahl, etwas Reif).
  - **Schneeregler:** legt zusätzlich Schnee auf Boden und Bäume.
  - **Wirkung:** Gilt für jede Karte, auch für generierte Wälder, ohne sie im Szeneneditor zu ändern.

**3D-Welt**
- **Himmel:** Farbverlauf nach Uhrzeit, Sterne in klaren Nächten, Sonne und Mond wandern.
- **Horizont je Szene:** passend zur Karte (Gebirge, Waldhügel, Sumpf, Dünen, Schneegipfel, Stadtumland, Küste, Höhlenwände), mit Luftperspektive.
- **Umland:** Hinter dem Kartenrand läuft das Land in einem Kranz aus Hexfeldern weiter, mit den Farben des Randes und auslaufender Höhe. Danach folgt eine Ebene mit vereinzelten Bäumen. Die Karte schwebt nicht mehr als Insel.
- **Unbekannte Felder:** liegen auf der gemittelten Höhe ihrer Nachbarn statt als Abgrund, in einer ruhigen Kartenfarbe (tagsüber Pergament-Ocker, in der Dämmerung aschgrau, nachts dunkel).

**Weicher Boden**
- **Durchgehende Oberfläche:** Die Ecken eines Feldes nehmen die mittlere Höhe der begehbaren Nachbarn an. Hänge fließen ineinander, Wiesen wellen sich leicht.
- **Kanten:** Felswände gibt es nur noch an Klippen (mehr als 5 ft), an Mauern und am äußersten Rand.
- **Markierungen:** Reichweite und Hover legen sich auf die Oberfläche.
- **Regeln:** Jedes Feld behält seine Höhe in der Mitte; dort stehen Figuren und Objekte.
- **Höhen in 1-ft-Schritten:** Zusätzlich zur Stufe (5 ft) kann ein Feld 0–4 ft höher liegen.
  - **Regeln:** Bis 2 ft Unterschied läuft man frei, 3–5 ft aufwärts zählt als Klettern (doppelte Kosten), mehr ist eine Klippe. Ab 10 ft nach unten gibt es Fallschaden.
  - **Generator:** Das Relief erzeugt automatisch Rampen in 1-ft-Schritten (Terrassen und Felsspitzen bleiben Stufen).
  - **Szeneneditor:** „〰 Smooth slopes“ glättet eine vorhandene Karte. Bestehende Karten bleiben unverändert, bis man das auslöst.

**Tests:** 569 Tests grün.
- **Neu:** `senses25` (Dunkelsicht, Blindsicht, Abstammung) und `world25` (Weltzeit, Nebelsicht, Dash-Auswahl, 1-ft-Stufen).

## APEX 2.6 – Flugdistanz, Haare, Wetter-Kombinationen, Klettern und Springen, Licht, Touch

**Fliegen schräg**
- **Kosten:** Ein Flug kostet die schräge Strecke durch die Luft, √(quer² + hoch/runter²), auf ganze Fuß gerundet, statt quer + hoch/runter. Beispiel: 30 ft quer und 40 ft hoch kosten 50 ft.
- **Reichweite:** Die 3D-Reichweite ist dadurch eine echte Kugel um die Figur.

**Haare**
- **Strähnen:** dicker und breiter.
- **Volumen:** Über der Kopfhaut liegt eine Lage abgerundeter Büschel (mit dunklerer Tiefe), lange Haare haben hinten Volumen bis über die Schultern.
- **Lesbarkeit:** Das wirkt deutlich voller und ist auch aus der Kartenentfernung erkennbar.

**Wetter kombinierbar**
- **Aufbau:** ein Himmel (klar, Schäfchenwolken, bewölkt, dunkle Wolken) plus beliebig Regen, Nebel und Schnee, z. B. dunkle Wolken mit Regen und Nebel.
- **Bedienung:** Im Zifferblatt sind Regen, Nebel und Schnee Schalter. Ältere Szenen mit einem einzelnen Wetter werden weiter gelesen.

**Performance**
- **Regen und Schnee:** fallen auf der Grafikkarte; der Prozessor rechnet pro Bild keine Partikel mehr. Auf „low“ und „medium“ gibt es weniger Partikel.
- **Neuberechnung:** Markierungen, Reichweite und die Schleich-Prüfung werden nur noch neu berechnet, wenn sich ihre Eingaben ändern (nicht bei jedem Neuzeichnen der Seite).

**Aktionsleiste**
- **Verbrauchte Aktionen:** Im eigenen Zug verschwinden Knöpfe, deren Aktion oder Bonusaktion verbraucht ist, statt ausgegraut zu bleiben. Gilt für Spieler und für die Gegnerleiste des GM. Angriffe bleiben, solange der Angriff noch weitere Angriffe erlaubt.
- **Widgets-Knopf entfernt:** Der schwebende „☰ Widgets (… hidden)“-Knopf über der Karte ist weg. Er lag über dem 2D/3D-Knopf, der jetzt immer erreichbar ist. Früher geschlossene Widgets kommen automatisch zurück.

**Klettern und Springen (Athletik)**
- **Klippen ohne Klettergeschwindigkeit:** Man kann hinaufklettern (Kosten: doppelte Höhe). Athletik-Wurf SG 10, über 15 ft SG 15. Misslingt er, bleibt die Figur am Fuß der Klippe stehen.
- **Kletterbegabte (Klettergeschwindigkeit):** klettern Klippen ohne Wurf und können durch Bäume und an Wänden klettern (wie schwieriges Gelände).
- **Sprünge über Lava, Grube/Abgrund oder tiefes Wasser:** bis 10 ft Breite, Athletik SG 10 (5 ft) bzw. SG 15 (10 ft). Breiter geht nicht, und man kann eine Bewegung nicht in der Gefahr beenden.
  - **Misslingt der Sprung, landet man darin:** Lava 4d10 Feuer (APEX-Wert), Grube 2d6 Fallschaden und liegend, tiefes Wasser ohne Schaden.
- **Würfe:** würfelt der Server beim Ziehen, mit Athletik vom Charakterbogen bzw. Stärke des Gegners. Sie stehen im Kampflog.
- **Anzeige:** Das Symbol am Mauszeiger zeigt 🧗 bzw. 🤸 mit dem nötigen SG.

**Licht**
- **Fackeln in 3D:** Getragene Lichter erscheinen jetzt auch in 3D: eine Flamme an der Figur und warmes Licht drumherum, nachts stärker.
- **Gegner mit Licht:** Gegner können ein Licht tragen. Standard: Humanoide und Riesen ohne Dunkelsicht tragen eines, Tiere und Kreaturen mit Dunkelsicht nicht.
  - **GM:** schaltet es in der Gegnerleiste um („Carry light“ / „Light out“).
  - **Sicht:** Gegnerlicht erhellt die Umgebung auch für die Sicht der Spieler.

**3D-Kamera**
- **Touch:** zwei Finger zoomen (auseinander/zusammen), drehen (verdrehen) und neigen (gemeinsam hoch/runter); ein Finger schiebt.
- **Kein Boden mehr durchsichtig:** Die Kamera folgt dem Gelände unter ihrem Ziel und taucht nie unter die Oberfläche.

**Tests:** 576 Tests grün.
- **Neu:** `climb26` (Klippen, Bäume, Lava-Sprünge, Würfe) und Ergänzungen in `world25` (Flugkosten, Gegnerlicht, Wetter-Kombination).

## APEX 2.7 – Gegner-KI und neue Kampfschauplätze

**Gegner-KI**
- **Schalter pro Szene:** Im Kampfkommando schaltet der GM „🤖 Enemy AI“ ein oder aus. Ist sie an, spielen die Gegner ihre Züge selbst: bewegen, angreifen, Flächenfähigkeiten und Kriegsschreie einsetzen, Spurt, Ausweichen, Rückzug. Jeder Schritt läuft über dieselben Regeln wie ein Zug von Hand.
- **Taktik pro Kreatur:** Jede Kreatur hat eine Taktik. Sie wird aus dem Werteblock vorbelegt und ist in der Gegnerleiste änderbar:
  - **Rudel:** gemeinsam, flankieren.
  - **Schläger:** auf den Nächsten, frontal.
  - **Plänkler:** schießen und Abstand halten.
  - **Zauberer:** hinten bleiben, Flächen auf Gruppen.
  - **Lauerer:** auf Verwundete und Einzelne.
  - **Wächter:** hält seinen Posten.
  - **Unterstützer:** erst Kriegsschrei, dann Kampf.
  - **Soldat:** diszipliniert, Fokusfeuer.
  - **Hirnlos:** auf den Nächsten, flieht nie.
- **Charakter (Stimmung):** aggressiv, vorsichtig, neugierig (beobachtet erst), feige (flieht bei Verlusten, verweigert Reaktionen) oder defensiv.
- **Übernehmen:** Mit dem Häkchen „AI“ steuert der GM eine einzelne Kreatur trotz eingeschalteter KI selbst.

**Neue Kampfschauplätze (Szenenvorlagen „Site · …“)**
- **Die 14 Orte:**
  - Steinbrücke über einem Fluss
  - Schlucht zwischen Klippen (Steinschlag, ein Aufstieg)
  - verlassener Handelsposten
  - Kreuzung mit Wegschrein
  - verfallener Wachturm
  - Mineneingang in einer Felswand
  - altes Schlachtfeld (Gräben, Pfähle, Knochen)
  - Steinkreis auf einem Hügel
  - Schiffswrack am Strand
  - Lavafeld mit Basaltwegen
  - Wasserfall mit Becken und Bach
  - überfallene Karawane
  - Seeufer mit Steg und Hütte
  - Spinnennest
- **Prüfung:** Jeder Ort ist für 3 Größen und mehrere Zufallswerte getestet: gültig, reproduzierbar, begehbar, die Kartenränder sind vom Start aus erreichbar.

**Noch offen aus der 2.7-Anfrage:**
- **Zufallsbegegnung:** der Assistent „Create random encounter“ im Game-Tab (Stil, Gruppengröße und Stufe → Vorschlag, Gegner wählen, Quest-NPCs aus der Bibliothek).
- **Ton:** Soundeffekte und Musik.

## APEX 2.8 – Alle Modelle auch als Frau

**Figuren-Editor**
- **Neuer Schalter über den Vorlagen:** „As preset / ♂ Man / ♀ Woman“.
- **Jede Vorlage gibt es in beiden Versionen:** Helden, NPCs und Monster.
  - Beispiele für die Frau: Magierin, Ritterin, Oger-Frau, Untote …
  - Die Heldinnen gibt es auch als Mann.
- **Umschalten:** Nach einer gewählten Vorlage zieht der Schalter dieselbe Figur sofort um: gleiche Ausrüstung und Farben, kein Bart, passende Frisur. Vorlagen, die immer Männer waren (Magier, Ritter, Adliger, Schmied …), haben eigene Akzente für die Frau. Beispiele: die Magierin mit langem Haar, die Adlige im Kleid.

**Gegnerbibliothek**
- **Wahl pro Kreatur:** „Auto · ♂ Male · ♀ Female · ⚥ Mixed“.
- **Wirkung:** Gilt für menschliche Figuren und für Tier- und Monstermodelle.
  - **Female:** z. B. Löwin ohne Mähne, Hirschkuh ohne Geweih, Henne, Minotaurin und Dämonin mit kürzeren Hörnern.
  - **Mixed:** Jede Figur wird für sich zufällig Mann oder Frau.
- **Gespeicherte Figur:** Eine gespeicherte Figur wird zur Frau bzw. zum Mann ihrer selbst.
- **Auto:** verhält sich wie bisher.

**Auf der Karte**
- **Pro einzelner Figur:** In der Gegnerleiste stellt der GM die Figur auf ♂ oder ♀ um, oder zurück auf die Wahl der Bibliothek.

**Bestehende Figuren**
- **Unverändert:** Bestehende automatische Figuren sehen unverändert aus. Das ist gegen den alten Stand geprüft.

**Tests:** 593 Tests grün.
- **Neu:** `ai27` (KI), `sites27` (Schauplätze), `female28` (Figuren, Bibliothek, Karte, Server).

## APEX 2.9 – Moral und Charakter der Gegner, Zufallsbegegnungen, lebendige Gegner, Reaktionen, Inventar in 3D, Ton

**Charakter und Moral der Gegner** (Gegnerbibliothek → „🧠 Personality“)
- **Sieben Regler (0–10):**
  - Loyalität
  - Opportunismus
  - Gier
  - Wildheit
  - Gnade
  - Ehre
  - Inspiration (Führung): ab 6 ist die Kreatur ein **Anführer**.
- **Lichtscheu:** Tiere, die Fackeln und Feuer fernhalten.
- **Kategorien** aus Werteblock und Art, änderbar:
  - **Truppe** (Goblins, Banditen, Orks, Kultisten, Soldaten): braucht Gruppe und Anführer.
  - **Rudel** (Wölfe, Hyänen): mutig nur in der Überzahl.
  - **Horde** (Zombies, Skelette, Konstrukte, Schleime): keine Moral, kommt immer.
  - **Raubtier** (Bären, Spinnen, Monster): flieht schwer verletzt.
  - **Stolz** (Drachen, Riesen, Aberrationen): nur echte Gefahr bewegt es.
- **Kampfmüdigkeit (verborgen):** Zu Beginn jedes KI-Zugs prüft die Kreatur, was sie erschüttert hat:
  - gefallene Kameraden
  - gefallener Anführer
  - erste schwere Wunde
  - Sicht zur Gruppe verloren
  - Unterzahl (Rudel)
  - Fackel vor der Nase (lichtscheu)
- **Moralwurf:** W20 + Weisheitsrettung + Anführerbonus + Charakter gegen SG 10–13 + Müdigkeit.
  - **Misslingt er:** Die Müdigkeit steigt.
  - **Bruchpunkt** (3, mehr für Loyale, Ehrenhafte, Wilde): Die Kreatur **bricht** und flieht.
  - **Eingekesselt:** Wer klug genug, nicht wild und gnädig, gierig oder opportunistisch ist, **ergibt sich** (🏳).
- **Anführer:**
  - **Rückhalt:** Wer sie sieht, würfelt besser.
  - **⚑ Sammeln (Bonusaktion):** Kameraden, die sie innerhalb von 30 ft sieht, verlieren Müdigkeit; Gebrochene kehren zurück.
  - **KI:** Sie tut das von selbst, die Wackelnden zuerst.
- **Zielwahl nach Charakter:**
  - **Opportunisten und Wilde:** gehen auf Verwundete und Einzelne.
  - **Ehrenhafte:** suchen den Stärksten.
  - **Gnädige:** lassen Fliehende ziehen (keine Gelegenheitsangriffe).
- **Sichtbarkeit:**
  - **Spieler:** sehen nur Flucht 🏃 und Kapitulation 🏳.
  - **GM:** sieht in der Gegnerleiste „standhaft / erschüttert x/3 / gebrochen“ und die Moralwürfe im KI-Protokoll.
  - **Neuer Kampf:** Ein neuer Kampf beginnt mit frischen Nerven.

**🎲 Create random encounter** (Game-Tab, Szenenliste, großer goldener Knopf)
- **Eingaben:** Schauplatz (oder „passend“), Gegner-Bande (15 Banden, oder „passend zum Schauplatz“), Situation, Gruppengröße, Stufe, Schwierigkeit.
- **Vorschlag:** Karte als Vorschau, Gegner mit XP-Bewertung nach DMG. Mit „Andere Karte“ / „Neuer Vorschlag“ neu würfeln.
- **Bearbeiten:** Gegner entfernen oder aus der Bibliothek hinzufügen.
- **Quest-Charaktere:** aus der Bibliothek, mit Namen, auf Seite der Gruppe (steht neben ihr) oder dagegen.
- **„⚔ Begegnung erstellen“:** Die Szene wird angelegt, veröffentlicht und bestückt.

**Lebendige Gegner**
- **Eigenes Aussehen:** Jede neu platzierte Kreatur hat ihr eigenes Fell bzw. ihre eigenen Schuppen:
  - Farben pro Art, z. B. Spinnen, Wölfe, Bären, Großkatzen, Huftiere, Rinder, Schafwolle, Amphibien, Reptilien, Vögel, Ungeziefer.
  - Muster: Streifen, Flecken, Bänder, Sprenkel, dunkler Sattel, Schuppenglanz.
- **Farbschema der Karte:** färbt mit (Tarnung), z. B. ockerfarbene Spinnen in der Mesa, weiße Wölfe in der Tundra.
- **Beschreibende Namen** statt Nummern, z. B. „Gestreifte ockerfarbene Riesenspinne“, „Grauer Wolf“, „Einäugiger Bandit“, „Vernarbter Banditenhauptmann“.
- **Bestehende Kreaturen** behalten Namen und Aussehen.

**Initiative-Leiste**
- **Bilder statt Kürzel:** jede Kreatur in ihrem eigenen Fell bzw. Gesicht. Keine Namen mehr unter den Porträts, Name und Initiative stehen im Tooltip. Die Porträts sind größer.
- **Keine Überlappung mehr:** Die Leiste sitzt zwischen Layout-Knöpfen und 2D/3D-Schalter.
- **Symbole:** Auf der 2D-Karte und in der Zielleiste stehen Symbole statt „SP“/„CU“, z. B. 🕷 🐺 👺 👹 🕯 🧟.

**Hover über Figuren**
- **Anzeige:** Trefferpunkte, Rüstungsklasse mit allen Effekten (z. B. 🔷 Magierrüstung → RK 15), Wildgestalt und alle Zustände und Buffs der Figur. In 2D und 3D.

**Reaktionen wie in Baldur's Gate 3** (Kampfleiste → „⚙ Reactions“)
- **Pro Charakter**, für Gelegenheitsangriff und Schild:
  - „Fragen“
  - „Immer – automatisch“
  - „Nie“ (wird gar nicht angeboten)
  - bei Zaubern zusätzlich „nur fragen, solange ich einen Slot habe / zwei Slots habe“

**Inventar im Charakter**
- **Neuer Ort:** Das Inventar ist jetzt ein Reiter im Charakter, kein eigener Hauptreiter mehr.
- **Ansicht:** Neben den Slots dreht sich die 3D-Figur; umschaltbar auf die Stoffpuppe.
- **„⚔ Angelegte Ausrüstung / ✨ Aussehen“:** Die Figur trägt hier und auf der Kampfkarte die angelegte Rüstung, Helm, Stiefel, Umhang, Waffen und Schild. Alternativ zeigt sie das Wunsch-Aussehen aus „Appearance“, das die Grundlage bleibt (Körper, Gesicht, Haare, Kleidung).

**Ton** (🔊 in der Kopfzeile)
- **Effekte:** Schwertschwung, Treffer, kritischer Treffer, Fehlschlag, Bogen, Biss, Knurren, Zauber je Element (Feuer, Frost, Blitz, Donner, Strahlen, Nekrotisch, Säure, Psychisch, Arkan), Heilung, Buffs. Sie klingen bei jedem Kampfereignis.
- **Musik:** Taverne, Kampf, Erkundung, Verlies, dazu eine leise Menü-Atmosphäre. „Auto“ folgt dem Spiel (Kampf, Karte, Menüs).
- **Einstellungen:** Effekte und Musik einzeln an/aus, Lautstärke, Titelliste.
- **Technik:** Alles wird im Browser erzeugt, ohne Audiodateien.

**Tests:** 619 Tests grün.
- **Neu:** `morale29`, `randomEncounter29`, `individual29`, `hover29`, `reactions29`, `gear29`.

## APEX 2.10 – Baukasten für Kreaturen und Figuren, neue Monster, Porträts, Geräusche

**Bugfix: dunkles Rechteck über den Figuren (3D)**
- **Ursache:** Die Umgebungsverdeckung (Qualität „ultra“) hat Namensschilder und schwebende Zahlen als feste Flächen mitgerechnet und dadurch einen halbtransparenten dunklen Kasten darüber gelegt.
- **Behebung:** Der Effekt lässt Schilder, Zahlen und durchsichtige Overlays jetzt aus.
- **Prüfstand:** Die Ursache ist im Code eindeutig. In meinem Testbrowser ließ sich das Rechteck vorher nicht zuverlässig nachstellen. Nach dem Fix ist auf „ultra“ kein Kasten zu sehen. Bitte auf eurem Gerät gegenprüfen.

**Der Baukasten** (`kit3d.ts`)
- **Grundformen, aus denen jetzt alle Modelle gebaut sind:**
  - weiche Röhren entlang einer Kurve (Körper, Hälse, Schwänze) mit beliebigem Querschnitt
  - Gliedmaßen mit Gelenken und Muskelschwung
  - Pfoten mit Zehen und Krallen, Hufe (auch gespalten), Vogelfüße mit Krallen
  - Hände mit Fingern und Daumen, die sich um etwas schließen
  - Krallen, Hörner (gebogen, gedreht, gerillt), Stoßzähne
  - Ohren (spitz, rund, Schlapp-, Hasen-, Flossenohren), Augen mit Iris und Pupille (rund, Schlitz, Ziegenpupille) oder leuchtend
  - Mähnen und Krausen, Zahnreihen, Schwänze (Quaste, buschig, Keule, Stachel, Schwanzflosse, Teufelsspitze), Tentakel mit Saugnäpfen, Stachel- und Plattenkämme
  - Flügel: Federn, Fledermaus- bzw. Drachenhaut, Insektenflügel
- **Muster für Fell und Haut:** Tigerstreifen, Zebrastreifen, Giraffennetz und Kuhflecken neu, dazu wie bisher Streifen, Tupfen, Bänder, Sprenkel und Sattel.
- **Einheitlich:** Alles ist skalierbar und frei einfärbbar.

**Kreaturen neu gebaut** (`beasts3d.ts`, `monsters3d.ts`, `creatures3d.ts`)
- **Vierbeiner-Bauplan:**
  - Eine Art ist ein Parametersatz: Körperlänge, Beinlänge, Brust, Hals, Kopf, Schnauze, Füße, Ohren, Schwanz, Hörner, Mähne und Muster.
  - Rumpf mit Taille und tiefer Brust, Schulter- und Schenkelmuskeln.
  - Vorderbeine mit Ellbogen und Handgelenk, Hinterbeine mit Knie und Sprunggelenk.
  - Echte Köpfe mit Schädel, Wangen, Schnauze, Nase und Unterkiefer; Pferde haben lange Gesichter.
- **Beispiele:**
  - Katze (getigert, mit Schnurrhaaren)
  - Hund (Schlappohren)
  - Wolf (Halskrause)
  - **dreiköpfiger Wachhund** (neu, riesig, braun) neben dem dämonischen Höllen-Kerberos
- **Weitere Baupläne:**
  - Vögel mit eiförmigem Körper, Hakenschnabel, Eulengesicht, Kamm, Schwanzfächer
  - Schlangen als ein durchgehender Körper mit Bauchschuppen, Kobra-Haube, Wurmmaul
  - Spinnen, Skorpione, Krabben, Käfer und Tausendfüßer mit Gliederbeinen
  - Drachen, Wyvern und Drachen ohne Flügel mit Bauchplatten und Rückenkamm
  - Zweibeinige Monster mit echten Händen; Köpfe für Affe, Stier, Troll, Oger, Bestie, Imp, Geier, Frosch, Helm
- **Flügel:** Am Boden liegen sie gefaltet am Körper. In der Luft breiten sie sich aus und schlagen.
- **Einzelstücke neu modelliert:**
  - Betrachter, Geister, Elementare, Golems, Schleime, Gallertwürfel
  - Baumhirt, Sumpfhügel, Aboleth, Otyugh, Krake, Mimic, Frosch, Fische
  - Hydra mit fünf Hälsen, Schildkröte mit Schuppenpanzer, Schnecke, Pilzwesen, fleischfressende Pflanze
  - Grell, Hirnfresser, Cloaker, Wal, Qualle, Roper, Fledermaus, Schmetterling
- **Neue Modelle** für Monster, die bisher ein unpassendes bekamen:
  - Imp und Quasit (statt großem Dämon)
  - Dornenteufel, Vrock (Geierdämon)
  - Troll, Oger (mit Keule), Ettin (zwei Köpfe); bisher erschienen sie als Menschenfiguren
  - Pseudodrache, belebte Rüstung, Wiesel, Säbelzahnkatze, Skelett-Schlachtross
- **Untote bleiben Figuren:** Zombies, Skelette, Ghule, Mumien und Wights bleiben Menschenfiguren; auch ein „Oger-Zombie“ wird kein lebender Oger.
- **Fell der Individuen:** Artmuster bleiben erhalten (Tiger gestreift, Kuh gefleckt). Tiger und Zebra haben feste Farben.
- **Bestehende Szenen:** Modell-IDs, Farben und gespeicherte Szenen bleiben gültig, keine Migration.

**Helden- und NPC-Figuren** (`lowpoly.ts`)
- **Körper aus dem Baukasten:**
  - weiche Beine mit Knie, Arme mit Ellbogen, Muskelschwung (kräftige Figuren stärker)
  - **Hände mit Fingern und Daumen**, die sich um Waffe, Schild oder Stab schließen
  - geformte Schuhe und Stiefel statt Kästen
  - ein Rumpf mit Taille und Brust; Frauen mit Hüfte, Taille und Brust
  - runde Köpfe, runde Schnauzen bei Drachenblütigen und Echsenmenschen, runder Kiefer bei Orks und Ogern
  - Schwänze (Tiefling-Spitze, Echsenschwanz)
- **Alles Bisherige bleibt:** Kleidung, Gesichter, Haare, Kopfbedeckungen, Ausrüstung und gespeicherte Figuren behalten ihre Optionen.

**Porträts** (Initiative-Leiste)
- **Licht:** warmes Haupt-, kühles Füll- und Kantenlicht, das die Silhouette betont.
- **Schärfe:** doppelte Auflösung.
- **Ausschnitt:** Figuren als Kopf und Schultern, Kreaturen auf Kopf und Vorderkörper statt des ganzen Tiers.

**Geräusche** (🔊)
- **Aufnahmen:** Kenneys „RPG Audio“ (CC0, kenney.nl), 28 Dateien, 168 KB, in `public/audio/kenney` mit Lizenzdatei.
- **Wo sie klingen:**
  - Klingenschwung bei jedem Nahkampfangriff
  - Schnitt bei Klingen, Axthieb bei Äxten, Hämmern und Keulen
  - Schritte, wenn Figuren in 3D laufen
  - Stoff und Gürtel beim Anlegen von Ausrüstung
  - Ablegen und Umpacken von Gegenständen
  - Münzen beim Handeln und Beute-Würfeln
  - Blättern im Tagebuch
  - eine Tür beim Szenenwechsel
- **Rückfall:** Bis die Aufnahmen geladen sind, oder falls ein Browser sie nicht abspielt, klingt der synthetische Ton.
- **Musik:** unverändert. howler.js war nicht nötig, Web Audio reicht.

**Leistung**
- **Mehr Detail:** Die Modelle sind deutlich detaillierter als vorher, im Median etwa 12 000 Dreiecke, das aufwendigste (Chimäre) etwa 30 000.
- **Messung:** In meinem Testbrowser (Software-Grafik) lief eine Kampfszene mit 13 Figuren flüssig. Auf echten Handys habe ich das **nicht** gemessen.

**Tests:** 632 Tests grün.
- **Neu:** `creatures210`. Er prüft Baukasten, Muster, alle Kreaturen und Figuren, Flügel gefaltet und ausgebreitet, Modellzuordnung der Monster, Artmuster unter individuellem Fell und die neuen Geräusche.

## APEX 2.11 – Grafik-Überarbeitung („Rome meets magic“), neue Titelseite, der Obelisk

**Ziel der Grafik-Runde:** weg vom niedlichen Kugelkopf-Stil hin zu einem ernsteren Ton zwischen Rom und Magie, mit etwas Path of Exile und Diablo 3.

**Oberflächen** (`surface3d.ts`)
- **Materialien statt glatter Farbe:** Jedes Teil hat ein prozedurales Material mit Relief, Farbschwankung und Rauheit, ganz ohne Texturdateien:
  - Stoff, Leder, Metall (gehämmert, zerkratzt), Kettenhemd
  - Haut, Schuppen, Fell, Chitin, Stein, Holz, Knochen, Haar
- **Kein Flimmern:** Das Muster blendet aus, wenn es kleiner als ein Pixel wird.
- **Kombinierbar:** Fellzeichnungen (Tiger, Zebra …) liegen über dem Material.

**Helden und NPCs** (`hero3d.ts`, `head3d.ts`, `gear3d.ts`, `hair3d.ts`)
- **Erwachsene Proportionen:** Der Kopf ist etwa ein Siebtel der Körpergröße. Völker unterscheiden sich in Größe, Breite, Beinlänge, Kopf und Haltung.
- **Modellierte Köpfe:** Jeder Kopf ist ein einziges glattes Modell statt eines Kugelhaufens:
  - Schädel, Brauenbogen, Augenhöhlen, Nasenrücken und -spitze, Wangenknochen, Lippen, Kinn, Kiefer
  - Die Augen liegen in den Höhlen unter einem schweren Oberlid; die Brauen liegen auf dem Brauenbogen.
  - Statt des gemalten Grinsens gibt es eine feine Lippenlinie.
  - Ergebnis: ernste, neutrale Gesichter. Licht und Schatten formen das Gesicht.
- **Haare und Bärte:**
  - Sie liegen jetzt auf der Kopfform auf.
  - Strähnen sind glatte, blattförmige Locken statt spitzer Kegel; Haarschalen sind glatt statt facettiert.
  - Unter Helmen zeigt sich ein Haaransatz, Kapuzen rahmen das Gesicht.
- **Ausrüstung in römischem Stil mit Magie:**
  - Rüstungen: Lorica segmentata (Platte), Hamata (Kette), Squamata (Schuppen), Lederpanzer mit Pteruges
  - Helme: Galea mit Wangenklappen und Kamm, korinthischer Helm
  - Waffen und Schild: Scutum, Gladius, Spatha, Hasta
  - Kleidung: Feldherrenmantel mit Fibel, fallende Roben, Lorbeerkranz
  - magisches Werkzeug: Stäbe mit Kristall, Orb, Sonnenscheibe, Schädel
- **Alte Figuren bleiben gültig:** Alle bisherigen Optionen und gespeicherten Figuren funktionieren weiter, ohne Migration.

**Monster:** Tieraugen statt Cartoon-Augen mit weißem Rand; Materialien je Art (Federn, Schuppen, Chitin, Stein, Rinde, Fell).

**Bild im 3D-Kampf** (Qualität „hoch“ und „ultra“)
- **Farbkorrektur:** weniger Sättigung, kühle Schatten, warme Lichter, mehr Kontrast, Vignette.
- **Kantenlicht:** ein kühles Gegenlicht zeichnet die Umrisse der Figuren.

**Porträts:** Menschen-Figuren erscheinen in der Initiative-Leiste als Büste (Kopf und Schultern), damit die Gesichter zu sehen sind.

**Kartentexturen:** Bewusst nicht verändert, wie besprochen.

**Titelseite: „Welcome to APEX – Rome meets magic“**
- **Bild:** ein vollflächiges Abendbild mit Kolonnaden, zerbrochenem Aquädukt und einem Obelisken mit leuchtenden Runen über einem Zauberkreis; aufsteigende Glut (ruht, wenn das Gerät reduzierte Bewegung wünscht).
- **Drei Säulen:** die Kampagne, der Obelisk, deine Legende.
- **Untertitel:** „Arena of the Eternal Will“ ist überall durch „Rome meets magic“ ersetzt.
- **Kopfzeile:** Dort steht der **Kampagnenname aus der Datenbank**. Im Mock heißt die Kampagne noch „APEX – Arena of the Eternal Will“. Ich ändere keine Kampagnendaten; eine Umbenennung in der App gibt es bisher nicht.

**Der Obelisk: Solo-Prüfungen ohne Spielleitung** (Tab „◆ Obelisk“)
- **Stufen:**
  - Es gibt die Stufen 1 bis 150. Stufe 1 entspricht Level 1, Stufe 150 einem Level-25-Kampf.
  - Ab Level 20 wächst der Kampf weiter: mehr Gegner, als stünden mehr Helden da.
  - Innerhalb eines Levels steigen die Stufen von leicht bis tödlich.
  - Die Stufen tragen keine Level-Zahl. Angezeigt wird, wie gefährlich sie für den eigenen Charakter sind: trivial, bequem, fordernd, gefährlich, tödlich.
- **Freischalten:** Anfangs ist nur Stufe 1 offen. Jeder Sieg öffnet zwei weitere. Jede 5. Stufe bringt Elite-Beute, jede 10. Wächter-Beute.
- **Der Kampf:**
  - Er entsteht mit dem Zufallsbegegnungs-Werkzeug: Bande, Ort, Lage.
  - Die Auswahl passt zum XP-Budget der Stufe, damit ein Level-1-Held keinem Oger begegnet. Nutztiere sind ausgeschlossen.
  - Der Kampf läuft auf einer eigenen Kampfkarte mit Initiative. Die Gegner-KI steuert der Server; der Client des Spielers gibt nur den Takt.
  - Die Kreaturen des Obelisken kennen keine Furcht: Sie fliehen nicht und ergeben sich nicht.
- **Ohne Folgen für die Kampagne:** Trefferpunkte, Zauberplätze und zeitliche Effekte sind zu Beginn voll und kehren danach auf die Kampagnenwerte zurück. Danach steht man wieder dort, wo man vorher war.
- **Sieg:** Ein Beutewurf der Stufe landet im Inventar, Währung im Geldbeutel.
- **Tod (alle Trefferpunkte auf 0):**
  - Das Inventar ist weg; Ausrüstung wird abgelegt.
  - **Es bleiben:** Level, Geldbeutel, Quest-Gegenstände und der Transmutationswürfel. Das ist meine Entscheidung, damit Kampagnenfortschritt nicht verloren geht. Falls ihr es härter wollt, kann man das ändern.
  - Der Spieler klickt „Accept Inventory Wipe“ und kann dann neu beginnen.
- **Rückzug:** Nur möglich, solange jeder Held über der Hälfte seiner Trefferpunkte steht; darunter entscheidet der Kampf.
- **Spielleitung:**
  - Fällt jemand, erscheint eine Meldung und am Tab ein Zähler (☠).
  - Verlorene Gegenstände lassen sich einzeln oder alle zurückgeben.
  - Weitere Werkzeuge: Schlüsselsteine vergeben oder nehmen; einstellen, ob eine Prüfung einen Schlüsselstein kostet (Standard: nein, sie sind vorerst nur eine Ressource); Stufen von Hand öffnen; laufende Prüfungen ohne Folgen abbrechen; eine Chronik.
- **Benachrichtigung – ehrlich:** Echte Push-Nachrichten auf ein geschlossenes Handy brauchen VAPID-Schlüssel, einen Service Worker und einen Versanddienst. Das gibt es bisher nicht.
  - Jetzt gibt es: eine Meldung in APEX und eine **Browser-Benachrichtigung, solange APEX offen ist** (nach Erlaubnis).
  - Echtes Push wäre ein eigener Schritt.
- **Daten:**
  - Der Obelisk lebt im Spielstand (`obelisk`), ohne neue Tabelle und ohne Migration.
  - Spieler sehen nur ihre eigenen Werte, nicht die Rückgabeliste der Spielleitung.
  - Jede Prüfung legt eine eigene Szene an, die danach archiviert wird. Bestehende Szenen und Karten bleiben unberührt.

**Geprüft**
- **Tests:** 641 Tests grün. Neu ist `obelisk211`; er prüft:
  - Stufen und Vorschläge
  - Freischalten, Wipe und Sieg
  - einen ganzen Lauf über die API: Start, KI-Zug, Tod, Rückgabe durch die Spielleitung, Wipe akzeptieren, Sieg
  - Schlüsselsteine und Rückzug
  - den modellierten Kopf
- **Build:** grün.
- **Im Browser** (Mock-Server): Spieler-Tab, Kampf mit KI-Gegner (der Pirat kam heran und schoss), Sieges- und Tod-Dialog, GM-Tab mit Rückgabe. Außerdem Figuren, Köpfe und Porträts in Nahansicht.

**Nicht geprüft / offen**
- **Datenbank:** Der Obelisk lief nur gegen den Mock-Server. Gegen die echte Supabase-Datenbank habe ich ihn nicht ausgeführt.
  - Szenenwechsel laufen über `apex_assign_scene` mit dem GM-Profil als Handelndem.
  - Voraussetzung: Die Kampagne hat ein aktives GM-Profil, und der Spieler ist Kampagnenmitglied (hat sich einmal angemeldet).
- **Mehrere Charaktere:** Steuert ein Profil mehrere Charaktere, gehen alle mit in die Prüfung. Getestet ist nur der Normalfall mit einem Charakter.
- **Geräte:** Leistung auf Handys und Ton in Safari/iOS habe ich nicht gemessen.
- **Werkzeuge:** Für noch hochwertigere Modelle (modellierte Assets statt prozeduraler Formen) wären Spline oder Meshy möglich. Beide habe ich nicht benutzt, weil sie in euren Konten Assets und Credits anlegen würden.

## APEX 2.12 – Fehler behoben, einheitlicher Stil, Farben nach Wahl, Proportionen, Downtime und Hideouts

**Fehler: Andere Spieler sahen zufällig aus**
- **Ursache:** In einer Szene kam die Figur eines anderen Charakters ohne ihr Aussehen beim Spieler an. Der Client suchte es in der Arena-Sicht des Spielers, dort fehlte der Charakter oft, und dann griff eine Zufallsvorlage nach der Token-ID.
- **Behebung:** Das öffentliche Aussehen (gewählte Figur oder getragene Ausrüstung) reist jetzt mit der Szenen-Figur mit. Alle sehen dieselbe Figur.

**Zug-Marker und Inventar**
- **Zug-Marker:** Wer am Zug ist, hat über dem Kopf einen schlanken, durchscheinenden weiß-goldenen Marker, der leicht schwebt.
- **Der „grüne Pfeil in der Hüfte“:** Das war die Startpunkt-Markierung des GM, über die die erste Figur gestellt wird. Sie ist jetzt schlank, durchscheinend und über Kopfhöhe.
- **Inventar im Charakter-Tab:** Gegenstände werden nicht mehr in eine schmale Spalte gequetscht. Behälter stehen nur nebeneinander, wenn jeder Platz hat; die Knöpfe rutschen unter den Namen.

**Stil**
- **Obelisk-Optik überall:** kühles und warmes Licht, feine Maserung auf Hintergrund, Panels, Kopf- und Navigationsleiste.
- **Neues Emblem:** ein „A“, das an einem Obelisken mit leuchtender Rune lehnt.
- **Kopfzeile:** zeigt nur noch APEX; der Kampagnenname erscheint beim Darüberfahren.
- **Titelseite:** nur APEX und „Join Campaign“.
- **Farben und Schriften** (Knopf neben dem Ton, auch auf der Titelseite):
  - Hauptfarbe: Vorlagen von Gold über Tyrian-Purpur, Amethyst, Bronze, Silber, Rot und Grünspan bis Azur, oder eine freie Farbe
  - Schriftton: Marmor, Pergament, Mondlicht, Asche
  - Schriften für Überschriften und Fließtext
  - Stärke der Textur
  - Gilt nur auf dem eigenen Gerät und färbt die ganze App sofort um.

**Figuren**
- **Proportionen nachgemessen:** Hüftgelenk bei etwa 0,49 der Körperhöhe (vorher 0,51), längerer Rumpf, Kopf etwa ein Achtel, breitere Schultern. Die Beine wirken nicht mehr „Slenderman“-lang.
- **Geformte Konturen statt Röhren und Kugeln:**
  - Beine: Oberschenkel, Kniescheibe, Wade, schlanker Knöchel
  - Arme: Bizeps und Unterarm, ein Deltamuskel statt Schulterkugel
- **Weniger Knete:**
  - anliegender Lederpanzer statt zweier Halbkugeln
  - Stiefelschäfte, die der Wade folgen
  - flache, gerollte Kragen
- **Neue Regler im Figuren-Editor:** Größe, Beinlänge, Schultern, Kopfgröße, Statur (jeweils −1 … +1).

**Downtime und Hideouts** (Tab „🏕 Downtime“)
- **GM: „Make camp (on the road)“:**
  - Ein gemeinsames Lager in der Gegend, in der die Gruppe steht, erkannt an den Kacheln der aktuellen Szene: Wald, Wüste, Schnee, Sumpf, Ufer, Gebirge, Siedlung.
  - Dazu Lagerfeuer, Zelte, Wagen, Kiste, Holzstapel und Bett.
  - Spieler können das Gelände nicht umbauen. Der GM hat alle Werkzeuge, etwa für einen nächtlichen Überfall.
- **GM: „Send everyone home“:**
  - Jeder Spieler kommt in sein eigenes Hideout.
  - Der Spieler wählt die Gegend: Seeufer, Strand, Waldlichtung, Wasserfall, Wüstenoase, Winterwald, Gebirgspass, Sumpf, Gehöft, Herrenhaus, Obstgarten, Tempelruine, Höhle, Dorf.
  - Er wählt, was immer dort steht: Truhe, Wagen, Zelt, Lagerfeuer, Bett, Holzstapel, Tisch, Fässer.
  - Er gestaltet es mit dem Gelände-Editor (Malen, Höhen, Licht, Beschriftungen, Tiere). Gegnergruppen und versteckte GM-Notizen kann er dort nicht anlegen.
  - Das Hideout bleibt für die nächste Downtime erhalten.
- **„End downtime“:** Alle kehren dorthin zurück, wo sie vorher waren. Das Lager wird archiviert. Laufende Obelisk-Prüfungen werden folgenlos zurückgerufen.
- **Die Truhe:**
  - Jeder Charakter hat im Hideout ein Langzeitlager.
  - Was dort liegt, wird nicht getragen und ist bei einem Obelisk-Tod sicher.
  - Gegenstände lassen sich während der Downtime hin- und herlegen, oder per „Store everything not worn“ alles einlagern, was nicht getragen wird.
- **Obelisk:**
  - Er öffnet nur in der Downtime. Der GM kann ihn mit „Open outside downtime“ dauerhaft öffnen.
  - Vor dem Betreten zeigt er alles, was auf dem Spiel steht, mit „→ Chest“ pro Gegenstand.
  - Nach der Prüfung steht man wieder im Lager oder Hideout.
- **Daten:** Alles lebt im Spielstand (`downtime`, `stash` am Charakter) und in normalen Szenen, ohne Migration.

**Geprüft**
- **Tests:** 648 Tests grün. Neu sind:
  - `ui212`: Aussehen anderer Spieler, Proportionen, Regler
  - `downtime212`: Lager, Hideout, Truhe, Rückkehr, Editor-Speichern ohne Gegner
- **Testkorrektur:** Ein alter, zufallsabhängiger Test (`female28`) setzte Orks manchmal auf einen Baum; er nutzt jetzt eine feste Karte.
- **Build:** grün.
- **Im Browser** (Mock-Server):
  - Lager mit Lagerfeuer, Zelten, Wagen und Kiste
  - Truhe und Obelisk-Abfrage
  - Hideout „Strand“ mit Editor und Speichern
  - Inventar-Layout, Titelseite, Farbwahl (Purpur), Kopfzeile
  - Figuren und Köpfe in Nahansicht

**Nicht geprüft / offen**
- **Datenbank:** Die echte Supabase-Datenbank habe ich nicht angesprochen. Szenen und Zuweisungen laufen über dieselben Wege wie bisher.
- **Nur beigetretene Spieler:** Spieler, die sich noch nie angemeldet haben, werden nicht verschoben. Die Datenbank erlaubt das nur für Kampagnenmitglieder.
- **Ein Pferd im Hideout** gibt es noch nicht als Figur; der Wagen ist eine Kachel.
- **Handys:** nicht gemessen.

## APEX 2.13 – Kampagnen-Theme für alle, Reichsadler, Zoom, ruhigere Figuren

- **Theme nur für den GM:**
  - Farben und Schriften stellt nur noch der GM ein. Sie gelten für alle Spieler; Spieler haben keinen Knopf mehr.
  - Gespeichert im Spielstand (`uiTheme`), die Titelseite merkt sich das zuletzt gesehene Theme.
- **Theme überall:** Auch Unterebenen (Szenen-Editor, Journal, Eingabefelder) folgen jetzt Hauptfarbe und Schriftton; 120 fest verdrahtete Gold- und Textfarben ersetzt.
- **Hintergrund-Licht:** Neue Theme-Option:
  - Obelisk: blauer Kern, Glut oben rechts
  - Glut
  - Arkan
  - Grün
  - Schlicht
- **Emblem:** dreiköpfiger Reichsadler. Kantige Köpfe im Profil, gekrönter Mittelkopf, Klingenfedern, Schild-Rumpf mit leuchtender Rune; in der Theme-Farbe.
- **Zoom in den 3D-Vorschauen** (Appearance und Inventar): Mausrad oder +/−, beim Zoomen mit Ziehen hoch und runter schauen.
- **Figuren:**
  - Oberflächen ohne „Hubel“: kaum noch Relief auf Stoff, Leder, Haut, Haar und Metall, nur Farbschwankung. Kettenhemd, Schuppen, Stein, Rinde und Chitin behalten ihre Struktur.
  - Flache, aufliegende Augenbrauen statt spitzer Röhren; kleinere Reißzähne und Hauer.
  - Helm, Mütze und Kappe folgen der Kopfform statt als Halbkugel-„Topf“ aufzusitzen.
  - Ruhigere Beinkontur, Kniescheibe nur bei nackten Beinen, weniger spiegelndes Metall.
- **Geprüft:**
  - 648 Tests grün, Build grün.
  - Emblem und Figuren im Browser gerendert.
- **Nicht geprüft:** echte Datenbank, Handys.

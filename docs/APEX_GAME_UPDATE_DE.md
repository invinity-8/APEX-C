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

Erste lokale Änderungen: Game-/Character-Beschriftung, Spellbook wieder im Character-Untertab, Gewichtsanzeige auf eine Nachkommastelle. Alle übrigen Punkte sind offen. Noch kein vollständiger Gameplay-Ausbau und keine Produktionsbereitstellung.

## Bestätigte Regelbasis

SRD 2014 / 5.1 als Grundgerüst, kombiniert mit dem bestehenden PoE-inspirierten Itemsystem. UA- und Hausregelerweiterungen sind erwünscht. Datenmodell und Oberfläche sollen zusätzliche Fähigkeiten erlauben; nicht automatisierte Effekte müssen manuell durch den GM abwickelbar bleiben. Keine automatische Umstellung auf 2024.

Die lokale Typprüfung der ersten Navigations- und Anzeigeänderungen wurde erfolgreich ausgeführt.

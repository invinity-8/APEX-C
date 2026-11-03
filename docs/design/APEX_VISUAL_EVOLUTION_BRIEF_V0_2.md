# APEX – Visual Evolution
## Design Briefing & technische Übergabe v0.2

**Projekt:** APEX – Arena of the Eternal Will  
**Repository:** `invinity-8/APEX-C`  
**Status des Ausgangsbriefings:** Konzeptphase, ursprünglich ohne Repository-Änderungsauftrag

> Dieses Dokument überträgt das vom Projektinhaber bereitgestellte Kreativbriefing v0.2 in das Repository. Die Formulierungen sind für die Lesbarkeit als Markdown zusammengeführt; es ist die gestalterische Quellreferenz, kein Nachweis, dass beschriebene Assets oder 3D-Funktionen bereits implementiert sind. Für den aktuellen Entwicklungsstand gilt das Repository selbst.

## 1. Zielsetzung

APEX ist eine browserbasierte Fantasy-D&D-Kampagnenplattform mit einer prozedural generierten Hexfeldwelt. Die aktuell überwiegend flache Top-Down-Visualisierung soll langfristig zu einer atmosphärischen, immersiven 2.5D-/3D-Fantasy-Welt weiterentwickelt werden. Gesucht wird kein kompletter Neubau des Spiels, sondern eine **visuelle Evolution bei unveränderter Spiellogik**.

Die Welt soll lebendig, räumlich, hochwertig, majestätisch und geheimnisvoll wirken.

## 2. Künstlerische DNA

**Arbeitstitel: APEX – Dark Imperial Fantasy.** Die visuelle Identität verbindet drei Inspirationsrichtungen mit einer eigenständigen APEX-Identität. Die Prozentwerte sind kreative Gewichtungen, keine mathematische Vorgabe.

### 50 % Diablo III – insbesondere Akt 1

- Malerische, stilisierte 3D-Ästhetik; isometrisch wirkende Landschaften
- Weiche Beleuchtung und atmosphärische Tiefenwirkung; lesbare Silhouetten
- Sanfte Naturanimationen und eindrucksvolle, dosierte magische Effekte
- Bewusst gestaltete Farben statt Fotorealismus
- Alteuropäisch-gotische Umgebungen; neblige Wiesen, dunkle Wälder, verwittertes Steinwerk
- Schöne, latent bedrohliche Fantasy-Landschaften

Besonders wichtig: malerische Natur, alte Gebäude, warmes Licht, Nebel, gedämpfte Farben, unterschwellige Bedrohung – **nicht** die übersteigerte, bunte High-Fantasy-Ästhetik späterer Abschnitte.

### 20 % The Will of the Many

- Monumentalität und institutionelle Macht
- Strenge geometrische Formen und verschachtelte Architektur
- Magische Hierarchien und unheimliche Machtstrukturen
- Verborgene Mechanismen unter einer scheinbar geordneten Welt
- Mysteriöse Symbole, Rituale, uralte Technologien und sakrale Geometrie
- Kontrollierte, intelligente, geheimnisvolle Magie

Die Formensprache soll kraftvoll, geordnet, schwer und rätselhaft sein.

### 20 % Gladiator (2000) – insbesondere die Eröffnung

- Römisch-militärische Würde und monumentale imperiale Architektur
- Schwere Stoffe, Leder, Eisen, Bronze, Staub, Rauch, Kälte
- Imperiale Ernsthaftigkeit, heroische Erdigkeit und militärische Ordnung
- **Centurio-Rot** als zentrale Akzentfarbe
- Hierarchie, römische Feldzeichen, Triumphbögen, Säulen, Tempel, Aquädukte
- Antikes Rom als lebendige, kriegerische Zivilisation

Die Materialwirkung und das satte Rot römischer Stoffe sind zentrale Referenzen. Das Imperium soll **kein steriles Marmormuseum** sein: Es ist alt, mächtig, benutzt, lebendig und konfliktgeladen.

### 10 % eigenständige APEX-Identität

- Arena of the Eternal Will; uralte Machtstrukturen
- Imperiale Fantasy und eigenständige Mythologie
- Kontrollierte Magie und geheimnisvolle Weltmechanik
- Ikonische, originäre APEX-Symbolik
- Goldener Adler **Aquila Aurea** als bestehendes Weltelement
- Eine verborgene Ordnung, die die Spielwelt durchzieht

**Path of Exile 1 wird ausdrücklich als direkte Stilreferenz entfernt.** Keine geschützten Figuren, Logos, spezifischen Assets oder unverwechselbaren Designs der genannten Werke kopieren. APEX soll vertraut hochwertig, aber unverkennbar eigenständig sein.

## 3. Künstlerische Leitidee

> **„Ein schönes, strenges, gefährliches Imperium.“**

Natur: weich, organisch, dezente Bewegung. Architektur: streng, massiv, alt, einschüchternd. Magie: selten, kontrolliert, visuell eindrucksvoll. Die Umwelt erzählt von imperialer Macht, zerfallenen Zivilisationen und übernatürlichen Geheimnissen.

Nicht durchgehend finster und nicht bunt-cartoonhaft. Sonnige Wiesen und golden beleuchtete Landschaften dürfen neben düsteren Wäldern, kalten Militäranlagen und Ruinen existieren.

Die Atmosphäre vereint malerische Dark Fantasy, römische Monumentalität, militärische Würde, geheimnisvolle Machtstrukturen, organische Natur und alte kontrollierte Magie. Majestätisch und gefährlich – und zugleich einladend zum Erkunden.

## 4. Geplante Darstellungsweise

- Stilisiertes 3D mit malerischen Oberflächen
- Leicht geneigte, isometrisch anmutende Kartenperspektive
- Erkennbare Höhenunterschiede
- Räumlich aufragende Bäume, Berge, Gebäude, Monumente
- Weiche Schatten und atmosphärisches Licht
- Tag-/Nachtwechsel und dezente Animationen
- Lesbarkeit beim Zoomen, klare Hexauswahl und Spielinformationen
- Keine unkontrollierte Kamera; keine Beeinträchtigung der Spielmechanik

Kameraausrichtung erst nach Analyse des bestehenden Kartenrenderers festlegen. Ziel ist **keine komplizierte 3D-Steuerung**, sondern ein lebendiges Fantasy-Diorama aus einer leicht schrägen Perspektive.

## 5. Natur und Biome

### Wiesen
Sanfte Geländeformen, leichte Höhenwellen, subtil im Wind bewegtes Gras, kleine Pflanzen und vereinzelte Details, weiches warmes Licht, natürliche malerische Grüntöne. Harte Kachelgrenzen vermeiden, soweit spielmechanisch sinnvoll.

### Wälder
Räumliche Baumgruppen unterschiedlicher Höhe, bewegte Kronen und Äste, dunkler Waldboden, Moos, Farn, Steine, Schatten, subtiler Nebel und organische alteuropäische Formen. Silhouetten müssen von der Kartenperspektive lesbar bleiben.

### Berge
Höhenstruktur, Felsklippen, Geröll, Erosion, monumentale Wirkung, dezente Schatten und volumetrische Tiefe; keine unnötig teuren Geometrien. Stilisierter Realismus statt übertriebener Comicformen.

### Flüsse und Seen
Ruhige animierte Wasserflächen, subtile Reflexionen, organische Ufer, geringe Wellen bei kleinen Gewässern, natürliche Integration in das Gelände.

### Ruinen und imperiale Orte
Römisch inspirierte Monumente, zerfallene Tempel, Säulen und Treppen, Triumphbögen, massive Befestigungen, Bronze, verwitterter Marmor, Eisen, vereinzelte magische Lichter. Eigenständige APEX-Symbolik, strenge Geometrie und hierarchische Architektur – militärische Glaubwürdigkeit plus geheimnisvolle Monumentalität.

## 6. Farben und Materialien

### Verbindliche Grundpalette v0.2

| Farbe | HEX | Rolle |
|---|---|---|
| Obsidian | `#22272B` | Dunkle Grundstimmung und UI |
| Waldgrün | `#405B49` | Natur |
| Verwitterter Stein | `#8C806A` | Stein und neutrale Materialien |
| Imperialgold | `#C09B58` | Würde, Akzente, Symbole |
| Centurio-Rot | `#8E2F2F` | Imperiale Stoffe, Banner, Akzente |

Das frühere gedämpfte Blutrot `#693B45` wird durch **Centurio-Rot `#8E2F2F`** ersetzt. Eigenschaften: satt, klassisch, militärisch, römisch-imperial, heroisch, würdevoll; harmoniert mit Gold, Stein und dunklem Grün; weniger violett/bräunlich.

Optionale Varianten: heroisches Scharlachrot `#A33A32`, dunkles Legionärsrot `#7F2A2A`. Rot besonders für Stoffe, Banner, Feldzeichen, Wappen, ausgewählte UI-Akzente – **nicht** flächendeckend.

### Materialgefühl

Naturmaterialien: weich, organisch, leicht unregelmäßig, malerisch, lebendig.

Imperiale Materialien: schwer, geometrisch, monumental, verwittert, glaubwürdig.

Bevorzugt: alter Stein, verwitterter Marmor, Bronze, dunkles Eisen, goldene Verzierungen, schwere rote Stoffe, gealtertes Holz, moosige Natursteine, weiches Gras, subtil reflektierendes Wasser.

Magie kontrolliert leuchten lassen, nicht die gesamte Farbwelt überlagern.

## 7. Formensprache

**Natur:** weich modellierte Böden, leicht erhöhte Wiesen, voluminöse lesbare Bäume, Nebel, klare stilisierte Geländemassen, organische Übergänge. Flache Icon-Optik ist nicht das langfristige Endziel.

**Architektur:** monumentale Bögen, schwere Säulen, große Treppen, massive Sockel, klare Symmetrien, imperiale Achsen, sakrale Geometrie, hierarchische Raumfolgen und „alte Macht in Stein“.

**Magie:** kontrolliert, hierarchisch, selten, geometrisch, geheimnisvoll, mit klaren Energiezentren, Linien, Glyphen und Lichtadern statt bunter Unordnung.

## 8. Animationen

Animation ist Identität, keine Ablenkung:
- Wind in Gräsern und leichte Bewegung von Baumkronen
- Subtiles Wasser und sanfter Nebel
- Flackernde Lichtquellen
- Atmosphärische Partikel und dezente magische Impulse
- Weiche Tag-/Nachtübergänge
- Ruhige, natürliche Landschaftsbewegung

Niemals unnötig hektisch. Animationen müssen reduziert/deaktiviert werden können.

## 9. Ausdrücklich vermeiden

- Generische Mobile-Game-Optik
- Übertrieben bunte High Fantasy
- Stark comicartige oder plastikartige Materialien
- Sterile Architektur
- Zu viele Partikel und übertriebene Dauerbeleuchtung
- Rein fotorealistische Grafik
- Übermäßig schmutzige Grimdark-Optik
- Path of Exile 1 als direkte Referenz
- Kopieren geschützter Diablo-/Gladiator-/Will-of-the-Many-Designs

## 10. Technisches Projektumfeld (Stand des Briefings)

React 19, TypeScript, Vite, Canvas/SVG-Karte, Supabase, Vercel, GitHub, Hexmechanik, Multiplayer, Fog of War, Zoom, Tag/Nacht. **Bei jeder Implementierung tatsächliche Architektur, Dateien und Branch erneut prüfen.**

## 11. Vorgeschlagene technische Architektur

- **Spline:** 3D-Design, Assets, Szenen, Materialien und Animation
- **Claude Code:** Implementierung, Integration, Dokumentation, Tests, Pull Requests
- **Three.js / React Three Fiber:** als mögliche Laufzeit für skalierbare Hexlandschaften prüfen, nicht ungefragt einführen
- **GitHub:** Versionierung und manuelle Freigabe
- **Vercel:** Preview und Produktion
- **Supabase:** bestehende persistente Daten und Spiellogik bleiben unangetastet

Spline soll möglichst **kein zwingend erreichbarer Laufzeitdienst** für die Welt sein. Wiederverwendbare, unabhängig deploybare Assets bevorzugen.

## 12. Spline-MCP-Status zum Zeitpunkt des Ausgangsbriefings

Der Nutzer hatte die Spline-Verbindung angegeben, aber deren Verfügbarkeit in der jeweiligen Claude-Code-Umgebung war damals nicht bestätigt.

Offizieller Endpunkt: `https://mcp.spline.design/mcp`

CLI-Option, nur falls in einer geeigneten Claude-Code-CLI-Umgebung erforderlich:

```bash
claude mcp add --transport http --scope user spline https://mcp.spline.design/mcp
```

Vor erneuter Installation bestehende Verbindung prüfen; nichts duplizieren. Tatsächlich verfügbare Tools und Authentifizierung prüfen; keinen Zugriff behaupten, wenn er fehlt.

## 13. Arbeitsablauf

1. Kreative/funktionale Anforderungen und Styleguide-konformen Auftrag formulieren.
2. Claude erstellt/ändert über Spline passende Assets, soweit MCP verfügbar.
3. Exportierte Assets ins Repository integrieren.
4. Separaten Git-Branch und Pull Request erstellen.
5. Vercel-Preview bereitstellen, sofern angebunden.
6. Optik und Funktion manuell prüfen.
7. Erst nach Freigabe mergen und produktiv deployen.

## 14. Sicherheit und Qualitätsanforderungen

- Keine unmittelbaren Änderungen an der Live-Anwendung, kein automatischer Merge
- Keine ungeprüften Supabase-Datenmodelländerungen oder Regeländerungen
- Fog of War und Rechte unverändert
- Vorhandener Renderer als Fallback
- Asset-Größen und Laufzeitkosten begrenzen
- Große Karten und mobile Geräte berücksichtigen
- Barrierefreiheit/reduzierte Bewegung
- Lizenzen und Exportrechte vor Produktiveinsatz prüfen

## 15. Ursprünglich geplanter Proof of Concept

Isolierte Testszene aus 3–7 Hexfeldern:
- Weich animierte Wiese
- Räumlicher Wald mit Windbewegung
- Kleines Felsrelief
- Sanfte Beleuchtung
- Kontrollierte Kamera
- Erkennbare römisch-imperiale Designkomponente
- Dezentes Centurio-Rot und Imperialgold

Der Proof of Concept verändert keine Spielfunktionen. Er dient als visueller/technischer Machbarkeitsnachweis – **nicht als Endziel** der später beauftragten APEX-0.6-Produktion.

## 16. Übergabeauftrag aus dem ursprünglichen Brief

Das Ausgangsbriefing forderte eine Repository-Analyse, MCP-Prüfung, versionierten Styleguide, konkreten Proof-of-Concept-Plan und eine isolierte Designprobe, falls möglich. Änderungen nur über Branch/PR; kein Merge oder Production-Deploy.

Dies beschreibt den historischen Übergabestand und begrenzt nicht spätere, ausdrücklich ambitioniertere Aufträge.

## 17. Finale kreative Zusammenfassung

> **Diablo III Akt 1 trifft auf die römisch-militärische Würde der Gladiator-Eröffnungsszene und die geheimnisvolle, hierarchische Monumentalität von The Will of the Many.**

Malerische, lebendige Fantasywelt mit animierter Natur, majestätischer Architektur, kontrollierter Magie und eigener imperialer Identität. Kernpalette: Waldgrün, Obsidian, verwitterter Stein, Imperialgold, sattes Centurio-Rot.

**Kreatives Leitmotiv: „Ein schönes, strenges, gefährliches Imperium.“**

# Kenney 2.5D Map Preview – Implementierungsnachweis

**Branch:** `feat/apex-09-kenney-25d-preview`  
**Abhängigkeit:** PR #45 (Map Campaign Director), der wiederum PR #44 enthält.  
**Datenbank:** keine Migration und keine Änderung an der Produktionsdatenbank.  
**Storage:** keine Uploads oder Bucket-Änderungen. Der bestehende Bucket `apex-asset-packs` bleibt privat.

## Umgesetzt

- Der Map-Renderer behält den Classic-Modus und bietet auf Forest-Szenen mit sichtbaren, generierten Baum-Markern einen zuschaltbaren **2.5D Preview**.
- Die Vorschau legt einen Kenney-Grasboden und isometrische Baum-Sprites über dieselbe SVG-Karte. Marker, Raster und Tokens verwenden unverändert dieselben Szenenkoordinaten; Sprite-Elemente fangen keine Klicks ab.
- Es werden ausschließlich drei feste Dateien aus dem Kenney Nature Kit angefordert: `ground_grass_NE.png`, `tree_blocks_NE.png` und `plant_bush_NE.png`. Die vorhandenen Katalogdaten deklarieren das Pack als CC0-1.0.
- Der Server gibt ausschließlich kurzlebige (60 Sekunden) signierte URLs aus dem bestehenden privaten Bucket zurück. Der Client übermittelt keine Storage-Pfade und erhält keinen geheimen Schlüssel.
- Der Server verlangt eine authentifizierte Sitzung. GM-Zugriffe sind auf veröffentlichte Szenen der eigenen Kampagne beschränkt; Spieler bekommen nur für ihre aktuell zugewiesene Szene URLs. Entwürfe, archivierte Szenen und Legacy-Arena werden abgewiesen.
- Das Laden startet erst nach Klick auf den Preview-Schalter. Bei Fehlern bleibt Classic aktiv.

## Geprüfte Grenzen und offene Abnahme

- API-Tests decken GM-Zugriff, Zugriff eines Spielers auf die eigene Szene, Ablehnung einer fremden Szene sowie Draft/Archiv/Legacy und ungültige Eingaben ab.
- Ein authentifizierter Rollen-Browserlauf ist wegen der Deployment Protection noch erforderlich. Der Screenshotvergleich mit identischer Szene/Kamera sowie Messungen für Laden, übertragenes Asset-Volumen, Eingabereaktion und Rendering bei Radius 39 und 78 wurden daher noch nicht erhoben.
- Die SVG-Karte bleibt autoritativ: dieser Preview-Layer ändert keine Bewegung, Tokenpositionen, Regeln oder Fog-of-War-Daten. Für nicht unterstützte Geländetypen bleibt die vorhandene Darstellung sichtbar.
- Die 60-Sekunden-URLs können in diesem Zeitfenster weiterverwendet werden; sie sind signierte Leserechte, keine Änderung am Bucket. Das Laden verbraucht die vorhandene Storage-Bandbreite, ohne Image Transformations zu verwenden.

## Abnahme nach Merge

1. PR #44, danach #45 und anschließend diesen PR mergen.
2. Eine isolierte, bereits veröffentlichte Forest-Szene mit generierten Bäumen auf der geschützten Preview als GM öffnen.
3. In Classic und 2.5D bei identischer Szene und Kamera jeweils einen Screenshot aufnehmen; als zugewiesener Spieler prüfen, dass nur die eigene Szene erscheint.
4. Startzeit, ausgelieferte Sprite-Bytes, Klick-/Bewegungsreaktion und Renderdauer bei Radius 39 und 78 messen; bei Fehler/Netzwerkverweigerung Classic-Fallback bestätigen.

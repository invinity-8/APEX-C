# Welt von APEX – Platzhalter-Lore

Diese Notizen sind ein **eigener** Entwurf, inspiriert vom *Konzept* übertragener Willenskraft.
Es werden keine Texte, Begriffe oder Handlungen aus fremden Werken übernommen. Alles ist frei änderbar.

## Das Imperium

Ein Rom auf dem Höhepunkt seiner Macht – getragen von Magie statt Sklaven allein:
schwebende Aquädukte, Straßen (*Viae Arcanae*), die Marschierende voranschieben,
Signaltürme mit Bronzespiegeln, selbstrollende Belagerungstürme.

## Voluntas – gebundene Willenskraft

- Jeder Mensch besitzt **Voluntas**, eine messbare Willenskraft.
- Über ein staatliches **Tributum Voluntatis** treten Bürger einen Teil davon ab. Die Kraft fließt
  in **Ankersteine** (Infrastruktur) oder in **Willensphiolen** (tragbare Speicher).
- Wer Voluntas *empfängt*, wird stärker, schneller, klüger. Wer zu viel abgibt, wird matt und gefügig.
- Die Arena selbst wird von einem verborgenen Ankerstein gespeist (siehe *Templum Oblitum*). Er hält die Grenzen –
  und lässt sie schrumpfen.

## Spielmechanik (Datenmodell vorbereitet)

| Element | Wo im Code | Idee |
|---|---|---|
| `Token.will` (current/max) | `src/game/types.ts` | Eigene Willenskraft einer Figur |
| `Item.kind = 'will-vessel'` mit `willCharge/willCapacity` | `src/game/types.ts` | Phiolen speichern Voluntas für später |
| Ort `Fons Voluntatis` | `src/data/demo.ts` | Füllt Phiolen – mit Risiko |
| Event-Effekt `modifyMovePoints` | `src/game/events.ts` | Beispiel „Willenssturm“ |

Mögliche nächste Regeln: Voluntas ausgeben für +BP, +Sicht oder Rettungswürfe; Willensübertragung zwischen Gruppenmitgliedern.

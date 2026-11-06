# Carry weight, Bag of Holding, resources & legacy Willpower (APEX 0.7)

## Carry weight
- **One internal unit: kilograms.** SRD 5.1 weights are given in pounds and converted once in
  `src/game/items/weight.ts` (1 lb = 0.45359237 kg, rounded to 0.01 kg).
- **Item weight:** an item's own `weightKg` if it has one. Players can set it for any item, in kg, under *Edit*.
  Otherwise the item uses its base item's SRD weight. Free-text items without a weight count 0.
- **Load:** the sum of quantity × weight over the whole inventory.
  - Equipped items are inventory items, so they are counted exactly once.
  - Items inside a Bag of Holding do not count; only the bag's own 15 lb does.
  - Magical currency (Seals, Orbs, Fragments) weighs nothing. Coins written on the character sheet are not counted.
- **Capacity (SRD 5.1):** Strength score × 15 lb, plus equipped "carrying capacity" modifiers. Strength is read from
  the character sheet; if it is missing, the gauge shows "Strength missing".
- **States:**
  - *Standard rule* (default): *Unburdened*, or *Overburdened* above capacity.
  - *Variant encumbrance* (GM: Arsenal → Balance → `encumbranceVariant = 1`): *Encumbered* above STR × 5 lb
    (speed −10 ft) and *Heavily encumbered* above STR × 10 lb (speed −20 ft, disadvantage on STR/DEX/CON ability
    checks, attack rolls and saving throws).
- **Movement enforcement:** the server blocks Arena and scene-map movement when carried weight exceeds capacity.
  With Variant Encumbrance enabled, the server also reduces effective speed by 10 ft or 20 ft at the documented
  thresholds and limits the remaining movement budget accordingly. The player view reports the current allowance;
  browser/live multiplayer acceptance remains a release check.
- The vertical gauge in the Inventory shows kg, maximum, percentage and state. It updates with every inventory
  change, because it is computed from the synchronised inventory.

## Bag of Holding (SRD 5.1)
- Wondrous item. It weighs 15 lb and holds up to 500 lb (226.8 kg), at most 64 cubic feet; APEX enforces the
  weight. The GM grants it in the Arsenal (base item *Bag of Holding*).
- **Persistent identity:** the bag's container id is `hold-<bag item id>`. The container appears automatically
  while the character owns the bag ("✦ Bag of Holding · x / 226.8 kg"). It cannot be deleted on its own.
- **Contents do not count** towards carry weight.
- **Refused actions:**
  - over 500 lb
  - a bag inside a bag (SRD: that would destroy both)
  - deleting a bag that still holds items, or discarding such a bag from the Arsenal tray
- **Transfer:** when the bag leaves a character (today: GM revoke), its contents are packed into the bag (`held`)
  and travel with it. At the next character they are unpacked into the bag's container. Item ids stay unique, so
  nothing is duplicated.
- **Recovery policy:** if a holding container ever loses its bag (for example a hand-edited save), its items move
  to *Recovered from a Bag of Holding* for the GM to sort. They are never deleted.
- Exotic planar interactions (portable hole, rupture) are not implemented.

## Custom resources
Resources on the character sheet (*Character → Resources*) can be edited, added and **removed with
confirmation** (✕ on the resource card). Removing one leaves every other sheet value untouched. A resource orb
that showed the removed resource falls back to the automatic choice. Hit points are separate and are not affected.

## Legacy Willpower – removed
- Removed from the code: `Token.will`, `WillPool`, the `setWill` command and its validation, will-vessel items
  (`willCharge`, `willCapacity`), the Character → Resources legacy section, the inventory and selection displays,
  the demo data, and the world option *Keep progress / Fresh start*. The server still accepts `keepProgress` from
  older clients and ignores it.
- **Migration strategy:** there is no database change and nothing is reset. `STATE_VERSION` is 3.
  - `migrateState` (imports, archives, snapshots, demo saves) and the server's **legacy reader**
    (`withLegacyReader` in `src/server/api.ts`) run `stripLegacy()` on every state they read.
  - `stripLegacy()` drops `token.will` and turns "will-vessel" items into ordinary `misc` items, keeping name,
    description, notes and quantity.
  - Every following write therefore stores a state without Willpower.
  - Stored archives and snapshots are not rewritten; they are cleaned when they are read, so old worlds still load.

## Rough weights for every item (APEX 0.7 finalization)

Problem found in play: imported (Aurora) and hand-written items had no base item and therefore weighed 0 kg, so the
gauge stayed near zero. Now:

- **Every free-text item gets a rough estimate** from its name (`src/game/items/weightGuess.ts`): the APEX base
  catalogue (SRD 5.1), a table of common SRD gear, packs, ammunition, foci, tools, instruments and clothes, then
  keyword rules (sword, axe, armour …), else 0.5 lb. Pounds are converted to kg and rounded to 0.05 kg – a guide
  value, not bookkeeping.
- **Existing campaigns:** items without a weight are back-filled once when the server reads the state (the same
  legacy reader that removed Willpower); explicit weights are never changed; base items keep their SRD weight.
- **New items:** manual adds and PDF imports (`invAddItem`) get the estimate unless a weight is given; loot-draft
  custom items too; generated/merchant items use their base item.
- Weights stay editable per item (Inventory → Edit → Weight).
- **Gold Pieces** in the purse count: 50 coins = 1 lb.
- **No Strength on the sheet:** the capacity assumes STR 10 and the gauge says "STR 10 assumed".

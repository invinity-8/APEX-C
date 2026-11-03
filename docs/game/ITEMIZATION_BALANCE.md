# APEX Itemization & Balance (APEX 0.6)

APEX layers action-RPG style item generation (rarity, prefixes/suffixes, item levels, tiers) on top of a D&D 5e
(SRD 5.1) table game. The guiding rule: **higher rarity widens combinations, it does not multiply numbers.**
D&D's bounded accuracy (AC, to-hit and saves stay in a narrow band) must survive any loot table.

Source of truth in code:

| Topic | File |
| --- | --- |
| Base items (templates, SRD + APEX) | `src/game/items/bases.ts` |
| Modifier repository (affixes, tiers, weights) | `src/game/items/modifiers.ts` |
| Rarity rules, caps, GM limits | `src/game/items/rules.ts` |
| Generation (weighted rolls) | `src/game/items/generate.ts` |
| Instances, validation, redaction | `src/game/items/instance.ts` |
| Resistance maths | `src/game/items/resistance.ts` |
| Equipment integration | `src/game/equipment.ts` (`itemBonuses`, `weaponMods`, `deriveStats`) |

## 1. Base items

* **Templates vs. instances.** A base item is a template. An item in a character's inventory is an *instance*
  that copies what it needs at creation (`baseId`, `equip`, name, item level, modifiers). Changing a template never
  changes items already in play.
* **SRD 5.1** weapons, armour, shield, selected adventuring gear and *Potion of Healing* use the SRD statistics
  (damage, properties, AC, weight, cost). Attribution (CC BY 4.0) is stored on each entry and repeated here:
  > This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast
  > LLC, available at https://dnd.wizards.com/resources/systems-reference-document, licensed under
  > CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/).
* **APEX generic bases** fill categories with no SRD base item (rings, amulets, cloaks, helmets, gloves, boots,
  belts, materials, quest token). They have **no built-in combat statistics** – their value comes from rolled
  modifiers or the GM. They are not official D&D items.
* Generated equipment has `equip.gmLocked = true`: players can equip it but cannot rewrite its statistics.
* Free-text items keep working unchanged. Items without `rarity` are plain items.

## 2. Rarity

| Rarity | Colour | Affixes | Prefix / suffix budget |
| --- | --- | --- | --- |
| Normal | grey `#c8c3b8` | 0 | 0 / 0 |
| Magic | blue `#7da2ff` | 1–2 | 1 / 1 |
| Rare | gold `#e3c25b` | 3–4 | 2 / 2 |
| Unique | orange `#c9733a` | *reserved – cannot be generated or created in 0.6* | – |

Rarity is always shown as **colour plus a text label** (never colour alone). Magic items are named
`Prefix Base Suffix` (e.g. *Smouldering Longsword of Ash*). Rare items get a random two-word name from original
word lists (e.g. *Cinder Verdict*), with the base type still shown.

## 3. Item level and tiers

* Item level runs from **1 to 30** (`MAX_ITEM_LEVEL`). The GM picks it per item. A sensible default is roughly
  `character level + 0…5`, so loot at level 20 can reach every tier.
* Every modifier has 1–4 **tiers**. Each tier has a minimum item level, a value range and a weight. A higher item
  level **unlocks** stronger tiers but keeps the weaker ones, so high-level loot is better on average without
  being guaranteed.
* Strong effects such as `to-hit` (ilvl 12/24) and `+1 AC` (ilvl 14) are gated by item level and have low weights.

## 4. Modifier repository

All modifiers are **original APEX content**. The prefix/suffix, family and tier concepts are general
action-RPG ideas; no modifier data was copied from other games or fan databases.

Fields per modifier: `id`, `name` (affix name), `affix` (prefix/suffix), `family`, `tags` (which bases can roll it),
`tiers` (`tier`, `ilvl`, `min`, `max`, `weight`), `effect`, `local` (applies to the weapon itself), `text`,
`description`. `MODIFIER_VERSION` is stored on every rolled item, and changing tiers or values requires bumping it.
Version 2 (APEX 0.6 playable loot) added the weapon suffixes *of Ruin* and *of Alacrity* on weapons. Without them,
weapons had prefixes only, so a Rare weapon could never exceed 2 modifiers.

**Families are mutually exclusive**: an item carries at most one modifier per family. For example, a sword cannot
roll fire and cold flat damage together, because both belong to `flat-damage`.

### Prefixes

| Id | Name | Bases | Tiers (ilvl: range) | Effect |
| --- | --- | --- | --- | --- |
| `dmg-physical/fire/cold/lightning` | Honed / Smouldering / Frostbitten / Stormcharged | weapons | 1: 1 · 10: 1–2 · 18: 2–3 · 26: 3–4 | + flat damage per hit (local) |
| `to-hit` | Disciplined | weapons | 12: +1 · 24: +2 | attack rolls with this weapon (local) |
| `ac` | Bulwark | armour, shields | 14: +1 | Armour Class |
| `max-hp` | Hale | armour, shields, belts, jewellery, helmets | 1: 2–4 · 10: 5–8 · 20: 9–12 | maximum hit points |
| `bane-beasts/undead/fiends/constructs` | Beast-bane … | weapons | 6: 1–2 · 18: 2–4 | damage vs. a creature type (local, GM judges) |

### Suffixes

| Id | Name | Bases | Tiers | Effect |
| --- | --- | --- | --- | --- |
| `res-<element>` (fire, cold, lightning, poison, necrotic, radiant) | of Ash, of the North Wind, of Grounding, of the Antidote, of the Living, of Shade | armour, shields, jewellery, cloaks, helmets, gloves, boots, belts | 1: 5–10 · 8: 11–18 · 16: 19–26 · 24: 27–34 | APEX resistance points |
| `save-<ability>` | of Fortitude, of Reflexes, of Resolve … | jewellery, cloaks, belts, shields | 8: +1 · 22: +2 | saving throws (one family for all saves) |
| `skill-<skill>` | of the Watch, of Hushed Steps … | jewellery, head, hands, feet, cloak, belt | 1: +1 · 15: +2 | one skill (one family for all skills) |
| `initiative` | of Alacrity | feet, hands, jewellery, weapons | 6: +1 · 20: +2 | initiative |
| `crit-damage` | of Ruin | weapons | 1: 2–3 · 10: 3–5 · 20: 5–8 | extra damage once on a critical hit with this weapon (local) |
| `carry` | of the Mule | belts, gloves | 1: 10–20 · 12: 25–40 lb | carrying capacity |
| `speed` | of the March | boots | 12: +5 ft | walking speed **on the sheet only** – arena movement points are never changed |

### Examples

* *Smouldering Longsword of …* (magic, ilvl 5): `+1 fire damage`. A longsword hit deals `1d8+3 slashing + 1 fire`.
* *Cinder Loop* (rare Silver Ring, ilvl 20): `+7 to maximum hit points`, `+22 Fire Resistance`, `+1 to Perception`.
* A weapon can never roll resistances, and a ring can never roll flat weapon damage.

## 5. Bounded-accuracy caps

Caps apply to the **sum over all equipped items in active slots** (to-hit and flat damage apply per weapon). The
breakdown shows when a cap applies.

| Rule (`ItemRules`) | Default | GM may set |
| --- | --- | --- |
| `resistanceCap` (points) | 100 (= 50 %) | 0–100 |
| `toHitCap` (per weapon) | +2 | 0–3 |
| `acCap` | +2 | 0–3 |
| `saveCap` (per ability) | +2 | 0–3 |
| `skillCap` (per skill) | +2 | 0–5 |
| `initiativeCap` | +2 | 0–5 |
| `maxHpCap` | +20 | 0–60 |
| `speedCap` (ft) | +10 | 0–30 |
| `flatDamageCap` (per weapon, all types) | 6 | 0–12 |

The GM changes these with the GM-only command `setItemRules` (values are clamped to the "GM may set" range;
`rules: null` restores the defaults). The effective rules are part of every client view, so the derived numbers
players see always match the GM's settings. A GM panel for this arrives with the Arsenal (APEX 0.6 PR 3).

## 6. Resistances

APEX resistance is **additive points**, separate from D&D's binary resistance:

```
Damage Reduction = min(max(points, 0), cap) / 200     (cap ≤ 100  →  at most 50 %)
```

Displayed as *“Fire Resistance: 30 points (15% damage reduction)”*.

**Calculation order** for one damage instance of one type (`applyDamage`):

1. **D&D immunity** → 0 damage, stop.
2. **D&D resistance** → halve, round down. **D&D vulnerability** → double. If both apply, they cancel (5e rule).
3. **APEX resistance** → `prevented = floor(damage × reduction)`; `damage −= prevented`.

APEX reduction comes last and rounds the *prevented* amount down. It can never stack into immunity. For example,
21 fire damage against D&D fire resistance and 100 points becomes 10, then 5. APEX never writes combat events on
its own: the resistance view explains numbers, and the GM applies damage at the table. The GM can inspect every
character's resistances (Arsenal, PR 3).

## 7. Generation (server-side)

`rollMods(base, rarity, itemLevel, rng)` is a pure function:

1. Draw the affix count uniformly from the rarity's range.
2. For each affix, list every *(modifier, tier)* pair whose tag matches the base, whose tier item level is at most
   the item level, whose family is not yet on the item, and whose prefix/suffix budget remains. Pick one with
   probability `weight / Σ weights` (an unbiased cumulative-weight scan).
3. Draw the value uniformly from the tier range.

If a base has too few eligible modifiers, it gets fewer affixes rather than duplicates. The random source is a
seeded PRNG (`seededRng`). From PR 3 onwards **only the server** creates seeds, using crypto randomness; clients
never supply seeds, values or modifiers. The seed and `MODIFIER_VERSION` make each roll reproducible and
explainable. Distribution tests in `tests/items06.test.ts` check weight proportionality, tier frequencies and
uniform integers.

## 8. Unidentified items

`identified: false` items keep their modifiers on the server. Player views pass through `redactItem`, which
removes `mods` and `modVersion`, so the modifiers never reach a player's browser (verified in tests). Unidentified
items grant **no** bonuses until identified. Identification (PR 3) is a server-side, idempotent state change that
reveals the already-rolled modifiers. It never rerolls them.

## 9. Equipment integration

* Only items in **active slots** count: the active weapon set, and the Resting preset's kept slots while resting.
* Character-wide bonuses (`itemBonuses`) and weapon-local bonuses (`weaponMods`) each come with step-by-step
  sources, shown as tooltips in the Equipment panel.
* **No double counting with imported sheets.** Imported sheet values stay untouched. If AC is derived from
  equipment, modifier AC is one labelled step. If AC is imported, the modifier bonus is added once and labelled
  *“Item modifiers (not part of the imported sheet)”*. Max HP, saves and skills are shown as separate
  “From equipped modifiers” lines and are never written into the sheet.
* Generated items cannot change quantity, cannot be split, and their equipment statistics are GM-locked.

## 10. The playable loot loop (GM Arsenal, currency, identify, reroll, salvage)

All of these are server-validated commands in `src/game/items/loot.ts` and run through `/api/apex?op=command`.

| Command | Who | What happens |
| --- | --- | --- |
| `arsenalGenerate` | GM | Rolls an item on the server (crypto seed injected by `api.ts`) into the **Arsenal tray** (preview, GM-only), or directly into a character's inventory (`giveTo`). `count` 1–10 rolls items separately; stackables use `quantity`. |
| `arsenalGive` / `arsenalDiscard` | GM | Moves a tray item into an inventory, or deletes the preview. |
| `gmGrantCurrency` | GM | Adds or removes Seals, Orbs or Fragments (never below 0, max 9999). |
| `gmRevokeItem` | GM | Removes an item (with an optional reason). Generated items return to the tray. Audited. |
| `gmSetItemLock` | GM | Restricts an item (quest item): players cannot salvage or delete it. |
| `itemIdentify` | owner | Spends 1 **Seal of Revelation** and reveals the modifiers rolled at creation (no reroll). Magic items get their affix name; rare items get a stable name derived from the item id. |
| `itemReroll` | owner | Spends 1 **Orb of Renewal** and replaces all modifiers of an identified Magic/Rare item with a new server roll. Base, item level, rarity, owner and slot stay; there is no preview or undo. |
| `itemSalvage` | owner | Destroys an unequipped, unlocked, generated item for Arcane Fragments (table below). |
| `combineFragments` | owner | `fragmentsPerOrb` Fragments (default **10**, GM-adjustable 2–100) → 1 Orb, several sets at once. |

**Salvage reward** (shown before confirming): Normal 1; Magic 2 (+1 from item level 15); Rare 4 + ⌊item level / 10⌋,
at most 6. Only items generated from the item pool can be salvaged; free-text items never pay out, so players cannot
create value from nothing.

**Exploit protection**
* Randomness comes only from a server seed. A client-supplied `seed` is dropped by the validator.
* Item actions name the item revision (`rev`) and `combineFragments` names the purse revision (`currencyRev`). After a
  success, a repeated request is refused, so nothing is spent or paid twice. Requests also carry a request id
  (`apex_command_log`), and an exact retry returns the first result without applying it again.
* Every write is an optimistic-locking compare-and-swap of the campaign state. Concurrent actions are re-validated
  against the newest state, so two simultaneous spends of the last Orb cannot both succeed.
* Players cannot generate items, grant currency, change a generated item's quantity or statistics, or split it.
  Unidentified items cannot be equipped and grant nothing. Their modifiers are removed from every player response.
* Currency and inventories of other characters are never sent to a player.
* The item audit log (GM-only, last 300 entries) records generation, grants, revokes, restrictions, identification,
  rerolls, salvage and fragment conversion.

Currency is stored on the character token (`token.currency`, `token.currencyRev`) inside the existing campaign state.
No database migration is needed.

## 11. Tuning guidance for GMs

* For gritty campaigns, lower `toHitCap`, `acCap` and `saveCap` to 1 and keep `resistanceCap` at 60 (30 %).
* For heroic campaigns, keep the defaults. Raising `toHitCap` or `acCap` to 3 noticeably weakens bounded accuracy.
* Prefer handing out more *magic* items with targeted resistances over many *rare* items. Rares are where
  combinations stack up.

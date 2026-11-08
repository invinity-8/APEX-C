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
| `spellAttackCap` (APEX 0.7) | +1 | 0–2 |
| `spellDcCap` (APEX 0.7) | +1 | 0–1 |
| `abilityCap` (per ability score, APEX 0.7) | +1 | 0–2 |
| `thornsCap` (damage, APEX 0.7) | 4 | 0–8 |

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

## 12. APEX 0.7 – The Imperial Armory

### Equipment location (one authoritative source)
*Superseded in APEX 1.0 – see §17.* The former **Equipped / Worn** container no longer exists: the paper doll's slots
are the only meaning of "worn", and the inventory shows exactly those items in its **Worn** section.

### New crafting currency
| Currency | Effect | Rules |
| --- | --- | --- |
| **Orb of Augmentation** | Adds **one** random eligible modifier | Identified Magic/Rare only. Needs a free affix slot (Magic ≤ 2, Rare ≤ 4) and a free prefix/suffix budget. Respects families and item-level tiers. Existing modifiers are never changed. If nothing is eligible, the action is refused and **nothing is spent**. |
| **Orb of Ascension** | Rarity +1: Normal → Magic → Rare | Identified items only. Keeps base, item level and **all existing modifiers**. Adds only what the new rarity needs to reach its minimum (Normal→Magic: +1; Magic→Rare: up to 3 in total). Magic items are renamed from their affixes, rares get their stable rare name. Never creates Uniques. |

The confirmation dialogs list the *possible* modifiers by name. The actual roll happens on the server after
confirming and cannot be previewed or cancelled.

### Arcane Transmutation (random Orb)
`fragmentsPerRandomOrb` (default 10) fragments → one random Orb per set, picked by weight from the GM-adjustable
table:

| Outcome | Default weight |
| --- | ---: |
| Orb of Renewal | 65 |
| Orb of Augmentation | 30 |
| Orb of Ascension | 5 |

Rolls use the server seed (`transmuteFragments`) and the purse revision (`currencyRev`). The command is atomic and
cannot be double-spent, and the result is shown to the player and recorded in the audit log ("Transmuted"). The
fixed conversion "10 fragments → Orb of Renewal" stays available.

### Flavour modifiers (MODIFIER_VERSION 3)
Low-impact, common modifiers that add variety and make "perfect" rares rarer:
- *Trailworn*: +3–5 lb carrying capacity, applied automatically.
- *Situational*, shown but never added to totals; the GM applies them:
  - *Featherweight*: item weight −10–25 %
  - *of the Forager*: +1 Survival when foraging
  - *of the Climber*: +1 Athletics when climbing
  - *of the Hearth*: +5–10 Cold Resistance against environmental cold only
  - *of the Long Road*: ignore 1 exhaustion level from a forced march
- *Cosmetic*, with no effect: *Glimmering* and *Engraved*.

Each is labelled `situational` or `cosmetic` on the item.

### Unique: Niri's Timetwister
- An Imperial Medallion (amulet), item level 20. Fixed modifier: +2 initiative.
- It is created only by the GM (*Arsenal → Unique items*) and never appears in random loot.
- It cannot be salvaged, rerolled, augmented or ascended.
- **Twist of Time:** while worn (amulet slot, active) and charged, the wearer skips their current turn. At their
  next turn they take two consecutive full turns.
  - A full turn is movement + action + bonus action + object interaction. The reaction does not double.
  - It applies only in a turn-based encounter. A day/night phase is not a turn.
- **APEX has no authoritative turn queue yet.** Activation therefore does not fake turn mechanics:
  - It records a *postponed turn* on the **character** (`token.timeTwist`), not on the amulet. Moving, unequipping
    or giving away the amulet does not move the turn.
  - It spends the charge, writes a Chronicle entry and an audit entry.
  - The GM resolves it with *Double turn taken*, or cancels it with *Lost* when the encounter ended or the
    character was incapacitated.
- Only one postponed turn can exist at a time. Retries are refused (item revision and charge state).
- Recharge: once per long rest, by the GM (*Recharge*).

## 13. Currency Vault & Imperial Transmutation Cube (APEX 0.7 / 0.9)

- **Currency Vault:** a compact grid with original APEX glyphs; no Path of Exile artwork or layout is copied.
  - Groups: *Orbs & seals* (Seal of Revelation, Orb of Renewal, Augmentation, Ascension) and *Materials* (Arcane
    Fragments).
  - Stack counts sit on the icons. Hover shows a tooltip, click opens the details, and a small action panel sits
    below.
  - All existing balances are kept as they were.
- **Imperial Transmutation Cube** (base item `apex-imperial-transmutation-cube`): an original APEX artifact (basalt
  cube with gold bands). It progresses through levels 0–5; the player-facing bar displays level, fragments, and
  unlocked/locked operations. New Cube grants start at level 0; a Cube or a prior entitlement is needed to begin.
  - Level 1: Basic Transmutation. Level 2: Renewal operations (reroll). Level 3: Augmentation. Level 4: Ascension.
    Level 5 is reserved and has no operation in APEX 0.9.
  - Cube Fragments (`cubeFragment`) are their own purse currency and are never consumed as Arcane Fragments.
    Defaults cost 3 / 6 / 9 / 12 / 15 fragments to advance to levels 1 / 2 / 3 / 4 / 5; the GM can tune each cost
    under **Arsenal → Balance** and grant/remove fragments under **Purse & currency**.
  - Every player upgrade validates the carried Cube/entitlement, expected level, current purse revision, balance and
    configured cost on the server before spending. GM level adjustments are separately authorized.
  - Existing saves with a carried Cube or permanent GM entitlement migrate to level 4, preserving the crafting rights
    they had before progression. Level 1+ is an earned persistent unlock even if the physical Cube is later lost.
    Characters without a progression-bearing Cube retain their prior 0.7 behavior; the new level gates apply when
    they receive a new Cube progression record.
  - The GM grants a new Cube like any item ("Generate & give") or puts it in a loot table; permanent legacy access
    remains a separate GM toggle.

## 14. Additional modifier families & GM loot drafts (APEX 0.7)

### New modifier families

All of them are rare, gated by item level and capped across **all** equipped items (section 5). They never stack
above the cap, whatever the number of items.

| Id | Name | Bases | Tiers (ilvl: range, weight) | Effect and cap |
| --- | --- | --- | --- | --- |
| `spell-attack` | Channeling (prefix) | jewellery, weapons | 14: +1 (60) | Spell attack rolls; at most **+1** in total. |
| `spell-dc` | Commanding (prefix) | jewellery | 22: +1 (15) | Spell save DC; extremely rare, at most **+1** in total. |
| `attr-str` … `attr-cha` | of Might / Grace / Vigour / Insight / the Sage / Majesty (suffix) | jewellery, belts, helmets, gloves | 16: +1 (25) | +1 to one ability score; at most **+1 per ability**, and items never raise a score above **20**. |
| `thorns` | of Thorns (suffix) | armour, shields | 8: 1–2 (120); 18: 2–3 (50) | See trigger below; at most **4** damage in total. |
| `skill-acrobatics` | of the Tumbler (suffix) | boots, gloves, cloaks | 1: +1 (300); 15: +2 (120) | Acrobatics; skill cap applies (+2). |

Already existing and unchanged: to-hit (weapons, ilvl 12/24, +2 cap), walking speed (boots, +10 ft cap), saves,
skills, resistances (environmental damage types such as cold and fire use the same resistance families).

**Thorns trigger (exact):** once per turn, when a creature **within 5 feet** hits the wearer with a **melee attack**,
that creature takes the thorns value as **piercing** damage. Thorns damage is not an attack and **never triggers
thorns** (no recursion, also not between two thorns wearers). The GM applies the damage; APEX shows the capped value.

**Ability scores:** the equipment summary lists the capped bonus with the "never above 20" note. Imported character
sheets stay the source of the ability scores; APEX does **not** recalculate them (no automatic modifier/skill update) –
the table applies the bonus, respecting the 20 limit.

### GM loot drafts

*Arsenal → Loot drop* rolls a draft **on the server** (seeded; client seeds are discarded), lets the GM edit it, and
only then creates real items:

1. **Roll:** encounter type, party (reference) level 1–20 and the categories that can drop (weapons, armour &
   shields, accessories, Seals of Revelation, Orbs of Renewal, Arcane Fragments, potions, consumables, other
   currency). Quest and custom items are only ever added by hand.

   | Encounter | Rolls | Rarity weights (normal / magic / rare) | Item level |
   | --- | --- | --- | --- |
   | Minion | 1 | 80 / 18 / 2 | party level |
   | Standard | 2 | 65 / 30 / 5 | party level + 1 |
   | Elite | 3 | 45 / 42 / 13 | party level + 3 |
   | Boss | 5 | 25 / 50 / 25 | party level + 5, then +0 (85 %), +1 (12 %), +2 (3 %) |

   Category weights: weapons 20, armour 16, accessories 18, seals 10, orbs 4, fragments 14, potions 12,
   consumables 8, other currency 3. Magic and rare equipment is rolled **unidentified** by default.
2. **Edit:** remove entries; change quantity, item level, rarity and the identified flag; add equipment, potions
   (SRD Potion of Healing), consumables, currency, **custom items** and **quest items**. Every edit names the draft
   revision – a stale edit is refused. A draft holds at most 24 entries.
3. **Approve:** the final pool becomes real items in the Arsenal tray (modifiers rolled with a new server seed).
   **Nothing is given automatically.** Currency entries become *currency bundles*: giving one adds the currency to
   the purse. *Discard draft* drops it without creating anything. All steps are in the item audit log.

Players never receive drafts or the tray (GM state only).

### Quest items

- Name, description, quantity, optional image (**https URL only**, loaded without referrer), GM notes.
- **Not salvageable or deletable by players by default** (`locked`); the GM can allow salvage per item.
- *Cannot be transferred* marks the item as bound. APEX has no player-to-player transfer yet; bound items are
  refused by salvage and will be refused by future trade/merchant features.
- **GM notes are stripped from every player view** (server-side redaction); the GM sees them in the tray and in
  inventories.
- Players can move quest items and add their own notes, but cannot rename them or change quantity or weight.


## 15. Party loot: Need / Distribute / Pass (APEX 0.7)

*Arsenal → Party loot* puts tray items up for a public roll (`src/game/items/partyLoot.ts`).

- **Start (GM):** choose tray items, the eligible characters and a deadline (1–60 min, default 5). Each item leaves
  the tray and lives inside its roll, so it exists exactly once at every moment. The Chronicle announces the roll.
- **Choose (players, in the 🎲 Loot rolls dock):**
  - **Need** – the character needs it; Need always beats Distribute.
  - **Distribute** – would take it (to share, sell or pass on) if nobody needs it.
  - **Pass** – does not want it.
  A choice can be changed until the roll is resolved; repeating the same choice is harmless. Before resolution,
  players see only their own choice and how many have decided.
- **Resolution** – automatically when everyone has chosen, by the GM at any time (*Resolve now*), or by any eligible
  player once the deadline has passed (*Roll now*). A disconnected player or GM therefore never blocks a roll.
  - Unanswered choices count as **Pass**.
  - If anyone chose Need, only the Need characters roll; otherwise the Distribute characters.
  - Each roller gets a **d100 from the server** (crypto seed, never from the client); a tie for the highest result
    is re-rolled among the tied characters until one is ahead.
  - The item goes to the winner **in the same state write** (optimistic locking). If the winner's inventory (or
    purse, for currency bundles) is full, the next-highest roller gets it.
  - If everybody passed or nobody can take it, the item returns to the Arsenal tray.
  - All choices and dice are public afterwards (dock, Arsenal history, Chronicle entry).
- **Cancel (GM):** returns the item to the tray. A resolved roll can never be resolved or cancelled again.
- Limits: 12 open rolls; the 20 most recent results are kept.

**Item level default:** *Loot drop* now uses the **party's median character level** by default. The server reads
the level of every player character with a stored sheet (explicit *Level* entry, else the sum of *Class & Level*)
and takes the median (lower middle for an even count; level 1 if no sheet has a level). The GM can switch this off
and enter a level by hand. Boss drops keep the rare higher item levels (+0 / +1 / +2 at 85 / 12 / 3 %).

## 16. GM Merchant & Gold Pieces (APEX 0.7)

- **Gold Pieces** are a new purse currency (`gold`), next to Seals, Orbs and Fragments; the GM grants them like any
  currency. Purse limit per currency: 99,999.
- **Arsenal → Merchant (GM):** open/close the shop (announced in the Chronicle), name, the merchant's gold and the
  percentage of an item's value it pays. Stock is **moved** from the Arsenal tray ("Offer") and back ("Back to
  tray") – the merchant never creates items. Prices are per unit, in gold or any APEX currency, and can be changed at
  any time.
- **🏛 Merchant tab (players, only while open):** buy (whole items or part of a stack) and sell.
  - **Reference value** = SRD price × 1 / 3 / 8 for normal / magic / rare. The merchant pays value × its rate,
    limited by its gold; sold items join the stock at their reference value.
  - **Not sellable:** quest items, GM-restricted and bound items, uniques, equipped items, a Bag of Holding with
    contents, items without an SRD price.
- **Safety:** every trade is one optimistic-locked state write (currency, stock and inventory change together).
  Buying names the purse revision and the merchant revision, selling the item revision and the merchant revision,
  so a double click, a retry or a stale screen is refused instead of spending or selling twice. Two players racing
  for the last item: exactly one gets it and pays. All trades are in the item audit log (`trade`).


## 17. APEX 1.0 – Itemization overhaul

### Worn = the paper doll (no Equipped container)
- "Worn" is not a container. An item is worn **if and only if** an equipment slot references it. It keeps its home
  container (where it goes when taken off).
- The inventory shows a **Worn** section with exactly the slot items (inactive weapon set marked). Worn items are
  never listed in a container at the same time.
- **Right-click** an item: equip it into a fitting slot (free slots first), or take a worn item off. Dropping an
  item on *Worn* equips it; dragging a worn item into a container (or choosing a container) takes it off.
- Old saves: the legacy `equipped` container is removed on the next inventory/equipment command, and its items
  return to `prevContainer` (or the Backpack). The client hides it immediately. Deleting a container that only
  holds worn items moves their home to the first container.

### Upgrade comparison (hover)
Every wearable, identified, not-worn item gets a badge: **▲ Upgrade**, **▼ Downgrade**, **◆ Trade-off** or
**＝ Same**. Hovering (or focusing) shows every changed number against the item currently in that slot: AC,
attack bonus, average damage, resistances (% reduction), HP, initiative, speed, carry, spell attack/DC, thorns,
ability scores, saves and skills. It uses the same rules as the character sheet (`previewEquipStats`).
The badge's weights only rank the changes: AC 10, attack 6, ability 5, save 4, initiative 3, avg. damage 2 per
point, skill 1.5, HP 1, resistance 0.3 per %, speed 0.6 per ft.

### Armour pieces: Armour & Evasion → Armor Class
Every armour slot (body, head, hands, feet) has an **Armour** and an **Evasion** rating (half-AC units):

| Slot | Light (armour / evasion) | Medium | Heavy |
| --- | --- | --- | --- |
| Body | 2 / 6 | 5 / 2 | 8 / 0 |
| Head, hands, feet (each) | 1 / 2 | 2 / 1 | 3 / 0 |

```
AC = 10 + ⌊Σ armour / 2⌋ + min(Dex modifier, ⌊Σ evasion / 2⌋, body limit)    body limit: light –, medium +2, heavy +0
```
An empty slot (or an old unrated cap/glove/boot) counts as light evasion with no armour, so unarmoured stays
10 + Dex. Reference results: full light set 12 + Dex (studded leather), full medium 15 + Dex (max 2) (half plate),
full heavy 18 (plate). **No combination exceeds 18 at any Dexterity** (tested over all 81 mixes), so mixing is
a choice of style, weight and stealth: heavy body + light pieces locks Dex; a light body with heavy helmet,
gauntlets and sabatons keeps up to +3 Dex. Shields add on top (Buckler +1, Shield +2, Scutum +3 with STR 15,
20 lb and stealth disadvantage), then item modifiers (AC cap +2).

**SRD suits** (Plate Armor, Leather Armor …) keep their SRD Armor Class. They are complete suits, so worn
helmet/gloves/boots add only their modifiers, not their ratings (shown as a step in the AC explanation). Mage Armor
applies when no rated piece is worn.

### Bases (36 armour pieces + 2 shields)
Three tiers per slot and weight class (drop levels 1 / 8 / 16). Tiers share their ratings (bounded accuracy) and
differ in weight, stealth, Strength requirement and price – e.g. *Iron Cuirass* (35 lb, STR 13) → *Lorica
Segmentata* (30 lb) → *Praetorian Plate* (26 lb, STR 11). Light pieces roll clothing modifiers (skills, travel),
heavy pieces also roll armour modifiers (thorns, AC). Loot drafts only pick bases whose drop level is at most the
item level; helmets, gloves and boots now drop as **armour**, accessories are rings, amulets, cloaks and belts.
**Modifier tiers depend on the item level, never on the base tier** – a great roll can land on a humble base.

### Modifiers (MODIFIER_VERSION 4)
- Attributes (*of Might / Grace / Vigour / Insight / the Sage / Majesty*): every worn slot (jewellery, belt, head,
  hands, feet, cloak, body armour). +1 from item level 10 (weight 60), +2 from item level 24 (weight 15). Cap per
  ability +2, never above 20. **Applied**: the raised modifier is used for AC, attacks and initiative.
- *Hale* tier 4 (ilvl 27: +13–16 HP), *of the March* tier 2 (ilvl 22: +10 ft).
- Existing items keep their rolls; the new tiers only affect new rolls.

### One set of numbers everywhere (`effectiveStats`)
The character sheet overview, the party widget, scene combat and scene movement use the same calculation:
- **Armor Class**: equipment-derived when armour/shields are worn, otherwise the sheet value (+ item modifiers).
  Enemies in scene combat attack this AC.
- **Speed**: walking speed + item speed − encumbrance (below). Scene movement uses it, including bonuses above the
  sheet speed. Arena movement points stay GM-set; encumbrance can only lower them.
- **Initiative**: sheet + item initiative + Dex gained from items. Scene initiative rolls use it.
- **Max HP**: sheet + item HP (shown, never written into the sheet).
- **Attacks**: equipped weapons of the active set appear in the scene attack menu with derived to-hit and damage
  (flat weapon damage folded into the modifier), before the sheet's own attacks.
- **Resistances**: element glyphs with points and the damage reduction (100 points = 50 %).

### Encumbrance in percent (rule value 2, the new default)
| Load (of capacity STR × 15 lb + item carry) | State | Speed |
| --- | --- | --- |
| ≤ 50 % | Unburdened | full |
| > 50 % | Encumbered | −25 % (rounded down to 5 ft) |
| > 75 % | Heavily encumbered | −50 % |
| > 100 % | Overburdened | cannot move |

The GM can switch back to SRD standard (0) or the SRD variant (1, −10/−20 ft) under *Arsenal → Balance*.

### Item icons
Original inline SVG glyphs per base family (sword, axe, bow, staff …; robe/mail/plate; cap/helm/great helm;
glove/gauntlet; shoe/boot/sabaton; buckler/shield/tower; jewellery, potions, materials …). The metal tint shows the
weight class, the frame the rarity.

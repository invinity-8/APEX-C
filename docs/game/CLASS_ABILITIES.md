# Class abilities, Sneak & temporary HP (APEX 0.7)

Rules basis: D&D 5e **SRD 5.1** (2014 rules), as used by the imported Aurora sheets. All rules are validated on the
server (`/api/apex?op=sheet`, actions `wildShape`, `revert`, `damage`, `heal`, `tempHp`, `sorcery`). Every action
names the sheet version it is based on, so a double click or a stale device is refused (409) instead of applying
the action twice. Only the character's owner and the GM can use them.

## Class levels
The class level is read from the sheet ("Druid 3 / Sorcerer 2", "Level 4 Kor Druid", or Class + Level fields). A
single-class character's class level equals the character level. **Multiclass characters always use the class
level**, never the total character level.

## Wild Shape (Druid)
| Druid level | Max CR | Restrictions | Duration |
| --- | --- | --- | --- |
| 2–3 | 1/4 | no flying or swimming speed | ⌊level/2⌋ hours |
| 4–7 | 1/2 | no flying speed | ⌊level/2⌋ hours |
| 8+ | 1 | – | ⌊level/2⌋ hours |

- **Uses:** 2, tracked as the sheet resource *Wild Shape*. It is created at 2/2 on the first use and regained on a
  short or long rest (the player or GM resets it).
- **Beast catalogue:** 16 SRD 5.1 beasts (statistics only, CC BY 4.0) plus custom forms the GM adds in
  *Arsenal → Wild Shape forms*. The limits above also apply to custom forms.
- **While transformed:**
  - The beast's STR/DEX/CON, AC, speeds, senses, attacks, HP and Hit Dice apply.
  - The druid keeps INT/WIS/CHA and their skill and saving-throw proficiencies. The view shows saves with the
    druid's proficiencies; if the beast's bonus is higher, the rules say to use the beast's.
  - Class features remain available if the beast can physically use them.
  - **No spellcasting** until druid level 18 (Beast Spells).
- **HP:** beast HP (`sheet.wildShape.hp`) and the druid's own HP (`hitPoints`) are stored separately. Damage goes
  first to temporary HP, then to beast HP. At 0 beast HP the druid reverts, and **excess damage carries over** to
  the normal form. Healing while transformed heals the beast, up to its maximum.
- **Equipment (APEX choice among the SRD options):** equipment merges into the new form and has no effect until
  the druid reverts. Nothing leaves or is copied in the inventory.
- **Pictures:** the player can upload one picture per form (PNG/JPG/WebP, at most 1.5 MB, checked by content). It
  is stored in the private portrait bucket under `<campaign>/<character>/beast-<form>-…`. Clients only receive a
  cache version and load the picture through a short-lived signed URL. No proprietary monster artwork is bundled.
- **Limitations:**
  - Duration is not timed automatically (APEX has days and phases, not hours); the player or GM reverts.
  - Circle of the Moon (not in the SRD) is not built in; the GM can add suitable custom forms.
  - Party Health keeps showing the druid's own HP.
  - Uses are not refreshed automatically on rests.

## Font of Magic (Sorcerer)
From sorcerer level 2. Sorcery Points maximum = sorcerer level.

| Create slot | 1st | 2nd | 3rd | 4th | 5th |
| --- | --- | --- | --- | --- | --- |
| Cost (SP) | 2 | 3 | 5 | 6 | 7 |

- Converting a slot gives SP equal to the slot level, never above the maximum. No slot above 5th can be created.
- Created slots are extra (they may exceed the slot maximum) and vanish on a long rest; the player or GM resets
  them.
- The resource *Sorcery Points* is created at its maximum on first use. Its maximum always follows the sorcerer
  level.
- Conversions use the slots on the sheet, which already reflect multiclass slot rules.

## Temporary hit points (SRD)
- They are separate from HP and never added to maximum HP.
- They are lost first when taking damage.
- They do not stack. *Grant temp* keeps the higher of old and new; *Replace* sets the new value; *Remove* clears
  them.
- The health orb draws them as a separate blue ring with a "🛡 +N temp" label.

## Sneak (custom APEX rule)
- Every player character has a **Sneak** toggle (Character → Actions).
- While sneaking, **every step costs double movement points**, which is the same as half speed. Reach and cost
  previews on the map follow the same rule, and the movement bar shows "🥷 Sneaking".
- Toggling never refills or refunds movement points. The cost is applied at the moment of each step, so switching
  back and forth gains nothing.
- **Sneaking is not invisibility.** Fog of War and visibility are unchanged; avoiding notice still requires a
  Stealth check the GM calls for. Rogues use the same state; no class exceptions are implemented.
- This is an APEX rule for the hex arena. It is separate from standard D&D movement, where moving stealthily is a
  travel-pace choice.

# Character progression, snapshots & feedback (APEX 0.7)

## Identity and tagline

- **Overview → Identity → ✎ Edit identity** is available to the character's player and to the GM. It edits:
  - Name
  - **Character Title / Tagline** (with a live preview)
  - Species, Class, Subclass, Level, Multiclass, Background, Alignment and Biography
- Name and tagline live on the character token (`setAppearance`). Saving a tagline sets `titleCustom`. From then on,
  imports and defaults never change it. Imported class data such as "Level 1 Kor Druid" → "Kor Druid" is only
  offered as a suggestion button.
- The header shows the tagline exactly as chosen. The imported build line appears on its own line below it.
- The other identity fields are labelled entries in the character sheet. They are saved with the sheet's version
  check, so a concurrent edit from another device is never overwritten silently.

## Incremental PDF update (level-up)

When a character already has a sheet, *Import Character Sheet* opens **Update (level-up) – only changes**:

1. The browser reads the PDF. Nothing is uploaded.
2. Every PDF value is compared with the current sheet. Only changed or new values are listed, in readable form:
   - `Strength: 11 (+0) → 12 (+1)`
   - `Maximum HP: 9 → 16`
   - `New feature: Wild Shape`
   - `Spell: Moonbeam`
3. Changes can be ticked one by one or per category ("all" / "none").
4. Values that are not ticked are not touched. Manual edits, the custom tagline, portrait, appearance, items and
   currency are also left alone.
5. **Consumables are protected.** Current HP and current resource uses are kept, and are only clamped to new
   maxima, unless the player explicitly ticks "Also take current hit points and current resource uses from the PDF".
6. Before saving, the server stores a **character snapshot** ("Before level-up 1 → 2" or
   "Before sheet update (PDF)").
7. A **progression entry** is appended to the sheet (`sheet.progression`, newest last, at most 50). It records
   previous and new level, time, PDF file name, changed fields, approved fields and an optional note. It appears
   under **History** for the player and the GM.

APEX never invents class features, feats or spell progression. Only what the PDF contains can be applied.
*Full review (merge / replace)* remains available for complete re-imports.

## Character snapshots (GM)

**Character sheets → History → Character archive** (GM only, online):

- **Create snapshot.** Give it a name and a reason. Suggestions include *Level 1 – Campaign Start*,
  *Level 2 – After Arena Trial*, *Before Boss Encounter* and *GM Manual Backup*. A snapshot contains:
  - the full sheet: identity, attributes, saves, skills, HP, resources and spell slots, spellcasting, features,
    background, notes and appearance
  - name, tagline, colours, initials, walking speed
  - the equipment configuration
  - the inventory and currency, **for reference only**
- **Compare** a snapshot with the current character or with another snapshot. Differences are shown field by field.
- **Restore selected** sections, chosen individually:
  - identity, background and notes
  - attributes, saves and skills
  - HP, combat values and attacks
  - resources and spell slots
  - features
  - spells
  - name, tagline and colours
  - equipment configuration
- **Restore safety:**
  - The current state is always snapshotted first ("Before restore (…)"), so every restore can be undone.
  - Items and currency are **never** restored, so a snapshot cannot duplicate items, regenerate affixes or bring
    back an item that was traded or salvaged.
  - Equipment configuration is restored only for items the character still owns. References to items no longer
    owned are dropped by `reconcileEquipment`.
  - Current HP and resource uses are never raised by a restore.
  - Restoring the economic state (who owns which items) is not part of character snapshots. It remains an
    explicit World-Management decision ("restore archived world → use archived inventory").

Storage: snapshots use the existing `apex_character_sheet_backups` table, with a JSON payload whose
`kind = 'apex-character-snapshot'`. Automatic import backups appear in the same list as *Automatic backup*.

**World creation fix (0.7):** *Create New World* / *Reset World* now carry equipment, currency, accent and marker,
portrait, walking speed and the custom-tagline flag along with the other character fields. Restoring an archived
world with "keep current inventory" keeps the current equipment references and currency, never the archived ones.

## Feedback

- **💬 Feedback** in the header, for players and the GM. Types: *Report Bug*, *Request Feature* and *Suggest
  Improvement*. Each report has:
  - title, category and description
  - optional reproduction steps
  - optional screenshot (PNG/JPG/WebP, at most 1.5 MB, checked by content)
  - app version, UI area and time
- Reports never include passwords, sessions, tokens, character records or the campaign state.
- Each report is a small row in `apex_feedback` (migration `20261104090000`, schema version 5). Screenshots go to
  the existing private `apex-portraits` bucket under `<campaign>/feedback/…` and are opened through short-lived
  signed URLs. The limit is 10 reports per profile per hour.
- **GM inbox** (📮 Feedback tab):
  - filter by type and status, and search
  - Acknowledge, Mark In Progress, Mark Resolved, Reject / Not Planned
  - private GM notes
  - share a report with all players
  - CSV export (formula-safe) and JSON export
- **Players** see their own reports with status and timestamps, plus reports the GM shared. Shared reports are
  shown without the reporter's identity. GM notes are never sent to players.

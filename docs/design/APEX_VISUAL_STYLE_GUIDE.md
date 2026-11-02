# APEX – Visual Style Guide (canonical design system)

> **Status: provisional (v0.5-draft).** This file is meant to version *"APEX – Visual Evolution, Design Briefing &
> Technical Handover v0.2"*. That attachment was **not available** to the implementation session that created this
> file, so the guide below is built from the art direction written into the APEX 0.5 "Imperial Reforged" brief
> (palette, reference weighting, materials, constraints). When the v0.2 document is supplied, paste it verbatim into
> **Appendix A** and reconcile any differences in **§12 Conflicts** – the briefing wins.

## 1. Promise
**"A beautiful, disciplined, dangerous empire."** Every screen should feel majestic, ancient, mysterious, dangerous
and worth exploring – a premium digital fantasy tabletop, not a mobile game.

## 2. Creative influences (concepts only – never copy)
| Weight | Influence | What we take | What we never take |
|---|---|---|---|
| 50 % | Diablo III, Act 1 mood | painterly, moody, warm-light-in-darkness atmosphere; readable silhouettes | characters, UI art, logos, textures, layouts |
| 20 % | *The Will of the Many* | institutional power, hierarchy, sacred geometry, hidden structures | text, names, cover art |
| 20 % | *Gladiator* (2000) | Roman military dignity, dust, leather, bronze, weathered marble, crimson textiles | stills, costumes as designed, logos |
| 10 % | APEX mythology | Aquila Aurea, the labyrinth, the shrinking arena, Will as a force | – |

Path of Exile is **not** a reference. Nothing from any of these works is reproduced; all APEX assets are original.

## 3. Palette (mandatory)
| Token | Hex | Role |
|---|---|---|
| Obsidian | `#22272B` | base of all surfaces (scale `ink-*`, canonical `ink-800`) |
| Forest Green | `#405B49` | nature, success, stamina (scale `forest-*`) |
| Weathered Stone | `#8C806A` | muted text, stone borders (scale `marble-*` / `stone-*`) |
| Imperial Gold | `#C09B58` | titles, highlights, focus, selection (scale `gold-*`) |
| Centurion Red | `#8E2F2F` | banners, textiles, critical accents, danger (scale `blood-*`) |

**Proportions:** ~70 % Obsidian/dark surfaces · 15 % Stone (text, borders) · 8 % Gold · 5 % Forest · ≤ 2 % Red.
Red marks *meaning* (danger, death, imperial banners) – it never floods a screen. Player-chosen colours (markers,
accents) are allowed anywhere they identify a character, but UI chrome always stays in the palette.

### Semantic tokens (`src/index.css`, `:root`)
`--apex-bg`, `--apex-surface`, `--apex-surface-raised`, `--apex-surface-sunken`, `--apex-border`,
`--apex-border-strong`, `--apex-text`, `--apex-text-strong`, `--apex-text-muted`, `--apex-highlight`,
`--apex-alert`, `--apex-alert-surface`, `--apex-warning`, `--apex-success`, `--apex-selection`, `--apex-health`,
`--apex-health-deep`, `--apex-resource`, `--apex-resource-deep`, `--apex-stamina`, `--apex-disabled`,
`--apex-focus`, `--apex-hover`, `--apex-light-day`, `--apex-light-night`; radii `--apex-radius-*`, spacing
`--apex-space-1..4` (4 px grid), motion `--apex-motion-fast|motion|motion-slow`, easing `--apex-ease`.
New code uses semantic tokens; the Tailwind scales are their building blocks.

## 4. Typography
- **Display:** Cinzel (fallback Trajan Pro, Georgia) – titles, widget headers (11 px, 0.2em tracking, uppercase,
  Gold), announcements, numbers on orbs. Carved-inscription feel; never for body text.
- **Body:** Inter – 12–14 px UI text, 11 px meta. Stone for secondary text, Marble-100 for primary.
- Hierarchy: Screen title (Cinzel 24–32) → Widget header (Cinzel 11 caps) → Label (Inter 11 caps, Stone) → Body.

## 5. Materials
| Context | Material language |
|---|---|
| UI chrome | dark obsidian stone slabs, thin gold inlay lines (`.imperial-rule`), bronze/iron frames, inner carved edge |
| Imperial world | heavy stone, weathered marble, bronze, dark iron, crimson military textiles, monumental Roman geometry |
| Nature | painterly, organic, softly lit, subtly animated, always readable from above |
| Magic | rare, controlled, geometric, precise, violet-white light; never confetti |

Avoid: glossy plastic, saturated cartoon colours, heavy bevels, rainbow gradients, particle spam.

## 6. Components (templates)
- **Panel** (`.panel`): stone slab, `--apex-border`, carved inner edge, deep shadow.
- **Widget header** (`.widget-header` + `.panel-title`): carved title left, actions right (collapse, move, close).
- **Buttons:** `.btn-gold` (one primary per area), `.btn-ghost` (secondary), `.btn-danger` (destructive, Red),
  `.btn-active` (toggled). Focus is always a visible 2 px gold outline.
- **Inputs:** dark sunken field (`ink-900`), Stone border, Gold border on focus.
- **Resource display:** orbs for HP (Red/blood glass) and the main resource (deep blue/arcane glass); split orbs
  for two resources; always with numeric `current / max` text – the visual never replaces the number.
- **Map markers:** player tokens use the chosen marker shape + the player's colour with a gold rim; rivals use
  team heraldry; selection = gold ring.
- **Loading / errors:** quiet status lines ("Opening the gates…"); errors in `--apex-alert-surface` with a clear
  next step, never raw stack traces.

## 7. Iconography
Line icons, 1.5 px stroke, square-ish Roman geometry, Gold or Stone. Emoji in existing UI are transitional and
are replaced by registry icons as the Spline/asset work lands. Heraldry: eagle (Aquila Aurea), laurel, labyrinth
meander, crossed gladii – original drawings only.

## 8. Signature motifs
- **Aquila Aurea** – the golden eagle at the arena's heart; light source of the world.
- **Labyrinth** – Greek-key/meander geometry around the centre; used as dividers and frames.
- **Imperial heraldry** – Centurion-Red banners with gold trim; used sparingly on headers, announcements, events.

## 9. Motion
Restrained and purposeful: 120 ms (hover), 220 ms (panels), 600 ms (orb fills, day/night). Environmental motion
(grass, tree crowns, water, fog, torch flicker, rare magic motes) is subtle and capped to ~30 fps. Every animation
is disabled or reduced under `prefers-reduced-motion` (global rule in `index.css` + JS checks in canvases).

## 10. Accessibility
Text contrast ≥ 4.5:1 on surfaces (Marble-100 on Obsidian ≈ 12:1; Stone on Obsidian ≈ 4.6:1 – use Stone only
for ≥ 11 px secondary text). Never encode state by colour alone (icons/labels accompany Red/Green). All controls
reachable by keyboard; drag-and-drop always has a keyboard/click alternative.

## 11. Assets & performance
All graphics are registered in `src/assets/registry.ts` (see `docs/design/ASSET_REGISTRY.md`): source, export,
format, optimisation, licence, fallback, version. Prefer SVG/CSS for UI chrome, WebP/AVIF for painted textures,
Canvas for the map; runtime 3D only where it earns its cost, lazy-loaded, with a 2D fallback.

## 12. Conflicts with earlier styling (resolved here)
| Earlier (0.1–0.4) | Now (canonical) |
|---|---|
| Warm brown-black ink (`#0f0d0c`) backgrounds | Obsidian-based blue-grey darks (`#15181b` … `#22272b`) |
| Brighter yellow gold (`#d4a64a`, `#e9c46a`) | Imperial Gold `#C09B58` family |
| Purple ambient glow in the page background | Forest + faint Red ambient light; violet reserved for magic |
| Bright red errors (`#e5484d`) | Centurion Red `#8E2F2F` surfaces, `#c0504c` for readable red text |

## Appendix A – Visual Evolution, Design Briefing & Technical Handover v0.2
*(to be inserted verbatim when supplied)*

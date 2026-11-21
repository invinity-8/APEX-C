/**
 * APEX 2.9 – random encounter creator (Game tab): from a setting (battle layout), a band of enemies, the party and
 * the wanted difficulty it proposes a complete fight – the map, the creatures (DMG XP budget, encounters.ts) and how
 * they are found (camp, ambush …). Same seed → same proposal. The GM edits the list, adds quest characters from the
 * library and creates the scene in one go.
 */
import { PRESETS, type HexPreset } from '../campaign/hexScene.js';
import type { StatBlock } from './bestiary.js';
import { planEncounter, SITUATIONS, THEMES, type Difficulty, type EncounterPlan, type Situation } from './encounters.js';

/** Settings that suit each band (the first ones fit best). */
export const SITES_FOR: Record<string, HexPreset[]> = {
  cultists: ['stonecircle', 'crypt', 'graveyard', 'battlefield'],
  orcs: ['watchtower', 'gorge', 'battlefield', 'crossroads'],
  bandits: ['caravan', 'crossroads', 'tradingpost', 'bridge'],
  goblins: ['mine', 'gorge', 'tradingpost', 'watchtower'],
  undead: ['graveyard', 'crypt', 'battlefield', 'stonecircle'],
  beasts: ['waterfall', 'lakeshore', 'gorge', 'bridge'],
  wolves: ['waterfall', 'gorge', 'stonecircle', 'lakeshore'],
  hobgoblins: ['watchtower', 'battlefield', 'crossroads', 'citygate'],
  gnolls: ['caravan', 'battlefield', 'tradingpost', 'farmstead'],
  lizardfolk: ['lakeshore', 'waterfall', 'bridge'],
  pirates: ['shipwreck', 'docks', 'lakeshore'],
  spiders: ['spiderlair', 'mine', 'gorge'],
  kobolds: ['mine', 'lavafield', 'gorge'],
  mercenaries: ['tradingpost', 'crossroads', 'manor', 'bridge'],
  giants: ['gorge', 'stonecircle', 'watchtower'],
};
/** How each band is usually met. */
const SITUATIONS_FOR: Record<string, Situation[]> = {
  bandits: ['ambush', 'camp', 'patrol'], pirates: ['camp', 'ambush'], spiders: ['ambush', 'lair'], undead: ['lair', 'patrol'], beasts: ['lair', 'ambush'], wolves: ['ambush', 'patrol'],
  cultists: ['camp', 'lair'], orcs: ['camp', 'siege', 'patrol'], goblins: ['ambush', 'lair', 'camp'], hobgoblins: ['siege', 'patrol'], gnolls: ['ambush', 'patrol'], lizardfolk: ['ambush', 'camp'],
  kobolds: ['lair', 'ambush'], mercenaries: ['patrol', 'camp'], giants: ['lair', 'siege'],
};
export const SITE_CHOICES = PRESETS.battle.filter((p) => p.id !== 'blank');
export const siteLabel = (id: string) => (PRESETS.battle.find((p) => p.id === id)?.label ?? id).replace(/^[A-Za-z]+ · /, '').replace(/ \(.*\)$/, '');

export interface EncounterProposal { name: string; site: HexPreset; theme: string; situation: Situation; radius: number; seed: number; plan: EncounterPlan }
export interface ProposalInput { site: HexPreset | 'any'; theme: string | 'any'; situation: Situation | 'any'; difficulty: Difficulty; partySize: number; partyLevel: number; seed: number; blocks: StatBlock[] }

const rng = (seed: number) => { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

/** A complete proposal. A fixed setting draws a band that fits it, a fixed band a setting that fits it. */
export function proposeEncounter(o: ProposalInput): EncounterProposal {
  const r = rng(o.seed * 104729 + 17);
  const pick = <T,>(l: readonly T[]) => l[Math.floor(r() * l.length)];
  const fitting = (site: string) => THEMES.filter((t) => SITES_FOR[t.id]?.includes(site as HexPreset)).map((t) => t.id);
  let theme = o.theme !== 'any' && THEMES.some((t) => t.id === o.theme) ? o.theme : '';
  let site = o.site !== 'any' && SITE_CHOICES.some((p) => p.id === o.site) ? o.site : null;
  if (!theme) theme = site && fitting(site).length ? pick(fitting(site)) : pick(THEMES).id;
  if (!site) site = pick(SITES_FOR[theme] ?? SITE_CHOICES.map((p) => p.id as HexPreset));
  const situation = o.situation !== 'any' && SITUATIONS.some((x) => x.id === o.situation) ? o.situation : pick(SITUATIONS_FOR[theme] ?? SITUATIONS.map((x) => x.id));
  const plan = planEncounter({ theme, situation, difficulty: o.difficulty, partySize: o.partySize, partyLevel: o.partyLevel, seed: o.seed, blocks: o.blocks });
  const radius = plan.entries.length > 8 || o.partySize > 5 ? 12 : 10;
  const band = THEMES.find((t) => t.id === theme)!.label;
  return { name: `${band} – ${siteLabel(site)}`.slice(0, 80), site, theme, situation, radius, seed: o.seed, plan };
}

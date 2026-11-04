/**
 * Unique items (APEX 0.7). Uniques are hand-made by the GM in the Arsenal – they are NEVER part of random loot.
 * Each has a fixed base, fixed modifiers and (optionally) an activatable ability whose state lives on the item
 * (`charge`) and – while it is waiting to be resolved – on the CHARACTER (`token.timeTwist`), so moving or selling
 * the item can never duplicate or carry the effect.
 */
import type { RolledMod } from '../types.js';

export interface UniqueDef {
  id: string;
  name: string;
  baseId: string;
  itemLevel: number;
  flavor: string;
  mods: RolledMod[];
  ability?: { name: string; text: string; rules: string[]; recharge: string };
}

export const NIRIS_TIMETWISTER = 'niris-timetwister';

export const UNIQUES: UniqueDef[] = [
  {
    id: NIRIS_TIMETWISTER,
    name: 'Niri’s Timetwister',
    baseId: 'apex-imperial-medallion',
    itemLevel: 20,
    flavor: 'Two hands of tarnished gold turn against each other. Whoever wears it hears a second heartbeat – always half a breath late.',
    mods: [{ modId: 'initiative', tier: 2, value: 2 }],
    ability: {
      name: 'Twist of Time',
      text: 'Voluntarily skip your current turn. At your next turn you take two consecutive full turns instead of one.',
      rules: [
        'Only in a turn-based encounter (initiative). A day/night phase is not a turn.',
        'A full turn = movement, one action, one bonus action and your free object interaction; your reaction does not double.',
        'Activate it on your own turn instead of acting; the amulet must be worn (amulet slot, active) and charged.',
        'Only one postponed turn at a time. It belongs to you, not to the amulet – passing the amulet on does not pass the turn.',
        'If you are incapacitated at your next turn or the encounter ends first, the postponed turn is lost.',
        'Recharge: once per long rest (the GM recharges it).',
        'APEX has no turn tracker yet: activation is recorded and announced, the GM resolves the double turn at the table.',
      ],
      recharge: 'once per long rest',
    },
  },
];

const BY_ID = new Map(UNIQUES.map((u) => [u.id, u]));
export const uniqueDef = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);

/** Equipment / inventory command cost on a large (radius 78) world: npx tsx bench/character.ts */
import { createDemoState } from '../src/data/demo';
import { executeCommand, type Command } from '../src/game/commands';
import { ARMOR_PRESETS, WEAPON_PRESETS, deriveStats } from '../src/game/equipment';
import { emptySheet } from '../src/game/sheet';

let s = createDemoState({ radius: 78, seed: 1 });
const P = { role: 'player' as const, tokenId: 'sinna' };
const run = (c: Command) => {
  const r = executeCommand(s, P, c);
  if (!r.ok) throw new Error(r.error);
  s = r.state;
};
for (const [id, name, e] of [['bp', 'Breastplate', ARMOR_PRESETS.Breastplate], ['sh', 'Shield', ARMOR_PRESETS.Shield], ['qs', 'Quarterstaff', WEAPON_PRESETS.Quarterstaff], ['dg', 'Dagger', WEAPON_PRESETS.Dagger]] as const) {
  run({ type: 'invAddItem', tokenId: 'sinna', itemId: id, name });
  run({ type: 'setItemEquip', tokenId: 'sinna', itemId: id, rev: 0, equip: e });
}
run({ type: 'equipItem', tokenId: 'sinna', itemId: 'bp', slot: 'chest' });
const time = (label: string, n: number, fn: (i: number) => void) => {
  const t0 = performance.now();
  for (let i = 0; i < n; i++) fn(i);
  console.log(`${label.padEnd(44)} ${((performance.now() - t0) / n).toFixed(2)} ms/op`);
};
time('setWeaponSet (r78 world)', 50, (i) => run({ type: 'setWeaponSet', tokenId: 'sinna', set: i % 2 ? 1 : 2 }));
time('equipItem move dagger main1↔main2', 50, (i) => run({ type: 'equipItem', tokenId: 'sinna', itemId: 'dg', slot: i % 2 ? 'main1' : 'main2' }));
time('setResting toggle', 50, (i) => run({ type: 'setResting', tokenId: 'sinna', resting: i % 2 === 0 }));
time('invAddItem', 50, (i) => run({ type: 'invAddItem', tokenId: 'sinna', itemId: `x${i}`, name: `Thing ${i}` }));
const sheet = { ...emptySheet(), attributes: [{ id: 'd', name: 'Dexterity', value: '14', modifier: '+2' }, { id: 's', name: 'Strength', value: '12', modifier: '+1' }], combat: [{ id: 'p', label: 'Proficiency bonus', value: '+2' }] };
time('deriveStats (client, per render)', 5000, () => deriveStats(sheet, s.tokens.sinna));

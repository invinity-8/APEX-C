/**
 * Cosmetic rewards (APEX 0.7) – purely visual, never affect rules. The GM grants or revokes them; players choose
 * among the ones they own. No payment of any kind: these are in-game rewards.
 * Defaults are plain – nothing is selected until the player picks something.
 */
export type CosmeticKind = 'frame' | 'wreath' | 'ornament' | 'background' | 'border' | 'title';
export interface CosmeticDef {
  id: string;
  kind: CosmeticKind;
  name: string;
  description: string;
  /** colour / CSS value used by the renderer */
  value: string;
}

export const COSMETIC_KIND_LABEL: Record<CosmeticKind, string> = {
  frame: 'Portrait frame',
  wreath: 'Laurel wreath',
  ornament: 'Imperial decoration',
  background: 'Card background',
  border: 'Card border',
  title: 'Honorary title',
};

export const COSMETICS: CosmeticDef[] = [
  { id: 'frame-gilded', kind: 'frame', name: 'Gilded Frame', description: 'A thin band of hammered gold around the portrait.', value: '#e3c25b' },
  { id: 'frame-legion', kind: 'frame', name: 'Legion Frame', description: 'Centurion red with bronze rivets.', value: '#a83a32' },
  { id: 'frame-arcane', kind: 'frame', name: 'Arcane Frame', description: 'A faint violet glow of bound will.', value: '#9a7bd8' },
  { id: 'wreath-gold', kind: 'wreath', name: 'Golden Laurels', description: 'Laurels of a victor of the arena.', value: '#e3c25b' },
  { id: 'wreath-silver', kind: 'wreath', name: 'Silver Laurels', description: 'For an honourable second place.', value: '#c8c3b8' },
  { id: 'orn-eagle', kind: 'ornament', name: 'Eagle Phalera', description: 'A bronze eagle disc, awarded for courage.', value: '🦅' },
  { id: 'orn-star', kind: 'ornament', name: 'Arena Star', description: 'Marks a tribute who survived a night of the arena.', value: '✦' },
  { id: 'orn-crown', kind: 'ornament', name: 'Grass Crown', description: 'The rarest honour: saving the whole party.', value: '❦' },
  { id: 'bg-dusk', kind: 'background', name: 'Dusk over the Aqueduct', description: 'Warm evening gradient.', value: 'linear-gradient(135deg, rgba(58,47,58,.9), rgba(138,90,58,.55))' },
  { id: 'bg-marble', kind: 'background', name: 'Senate Marble', description: 'Pale veined marble.', value: 'linear-gradient(135deg, rgba(90,88,84,.75), rgba(40,38,36,.9))' },
  { id: 'bg-crimson', kind: 'background', name: 'Crimson Banner', description: 'The red of the legions.', value: 'linear-gradient(135deg, rgba(110,30,30,.75), rgba(30,14,14,.9))' },
  { id: 'border-gold', kind: 'border', name: 'Gold Border', description: 'A gold edge for the character card.', value: '#c09b58' },
  { id: 'border-arcane', kind: 'border', name: 'Arcane Border', description: 'A violet edge for the character card.', value: '#9a7bd8' },
  { id: 'title-champion', kind: 'title', name: 'Champion of the Arena', description: 'Shown next to the character name.', value: 'Champion of the Arena' },
  { id: 'title-tribune', kind: 'title', name: 'Tribune of the People', description: 'Shown next to the character name.', value: 'Tribune of the People' },
  { id: 'title-survivor', kind: 'title', name: 'Survivor of the First Night', description: 'Shown next to the character name.', value: 'Survivor of the First Night' },
];

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));
export const cosmetic = (id: string | undefined) => (id ? BY_ID.get(id) : undefined);

export interface CharacterCosmetics {
  unlocked: string[];
  selected: Partial<Record<CosmeticKind, string>>;
}

/** Selected cosmetics that the character still owns (anything revoked is ignored). */
export function activeCosmetics(c: CharacterCosmetics | undefined): Partial<Record<CosmeticKind, CosmeticDef>> {
  if (!c) return {};
  const out: Partial<Record<CosmeticKind, CosmeticDef>> = {};
  for (const [kind, id] of Object.entries(c.selected) as Array<[CosmeticKind, string]>) {
    const d = cosmetic(id);
    if (d && d.kind === kind && c.unlocked.includes(id)) out[kind] = d;
  }
  return out;
}

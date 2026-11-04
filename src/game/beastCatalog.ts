/** All Wild Shape forms available in a campaign: SRD beasts plus the GM's custom forms. */
import { SRD_BEASTS, type BeastForm } from './beasts.js';

export function beastsFor(custom: BeastForm[] | undefined): BeastForm[] {
  return [...SRD_BEASTS, ...(custom ?? [])];
}
export const findBeast = (custom: BeastForm[] | undefined, id: string) => beastsFor(custom).find((b) => b.id === id);

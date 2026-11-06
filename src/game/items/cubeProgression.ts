import type { GameState, Token } from '../types.js';
import type { ItemRules } from './rules.js';

export const CUBE_BASE = 'apex-imperial-transmutation-cube';
export const CUBE_MAX_LEVEL = 5;

export function carriesCube(token: Pick<Token, 'inventory'>): boolean {
  return token.inventory.some(item => item.baseId === CUBE_BASE);
}

/** Old saves without progression retain their previously granted Cube operations. */
export function cubeLevelOf(token: Pick<Token, 'cubeAccess' | 'cubeProgression' | 'inventory'>): number {
  if (token.cubeAccess) return 4;
  if (token.cubeProgression) return Math.max(0, Math.min(CUBE_MAX_LEVEL, Math.floor(token.cubeProgression.level)));
  return carriesCube(token) ? 4 : 0;
}

export function cubeCostForNextLevel(level: number, rules: ItemRules): number | null {
  if (level < 0 || level >= CUBE_MAX_LEVEL) return null;
  const keys: Array<keyof ItemRules> = ['cubeLevel1Fragments', 'cubeLevel2Fragments', 'cubeLevel3Fragments', 'cubeLevel4Fragments', 'cubeLevel5Fragments'];
  return rules[keys[Math.floor(level)]];
}

export function hasCubeAccess(token: Pick<Token, 'cubeAccess' | 'cubeProgression' | 'inventory'>): boolean {
  return !!token.cubeAccess || carriesCube(token) || cubeLevelOf(token) > 0;
}

export function migrateCubeProgression(state: GameState): boolean {
  let changed = false;
  for (const token of Object.values(state.tokens)) {
    if (token.kind !== 'player' || token.cubeProgression) continue;
    const legacyEntitlement = carriesCube(token) || !!token.cubeAccess;
    token.cubeProgression = {
      level: token.cubeAccess ? 4 : legacyEntitlement ? 4 : 0,
      ...(token.cubeAccess ? { gmOverride: true } : {}),
      ...(legacyEntitlement ? { legacyEntitlement: true } : {}),
    };
    changed = true;
  }
  return changed;
}

export function requiredCubeLevel(operation: 'transmute' | 'renewal' | 'augment' | 'ascend'): number {
  return operation === 'transmute' ? 1 : operation === 'renewal' ? 2 : operation === 'augment' ? 3 : 4;
}

export function canUseCubeOperation(token: Pick<Token, 'cubeAccess' | 'cubeProgression' | 'inventory'>, operation: 'transmute' | 'renewal' | 'augment' | 'ascend'): boolean {
  return cubeLevelOf(token) >= requiredCubeLevel(operation);
}

export function unlockedCubeOperations(): Array<{ level: number; label: string }> {
  return [
    { level: 1, label: 'Basic transmutation' },
    { level: 2, label: 'Renewal operations' },
    { level: 3, label: 'Augmentation operations' },
    { level: 4, label: 'Ascension operations' },
    { level: 5, label: 'Advanced crafting (reserved)' },
  ];
}

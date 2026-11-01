import { createHash } from 'node:crypto';
import type { Profile } from '../src/server/repo';
import { hashPassword } from '../src/server/auth';
import type { MemoryRepo } from './memoryRepo';

/** The five campaign profiles, exactly as seeded by the baseline migration (ids are per profile). */
export function seedProfiles(repo: MemoryRepo, campaignId: string) {
  const mk = (key: string, displayName: string, characterName: string, role: 'gm' | 'player', tokenIds: string[], n: number): Profile => ({
    campaignId,
    key,
    displayName,
    characterName,
    role,
    tokenIds,
    userId: `00000000-0000-4000-8000-00000000000${n}`,
    active: false,
  });
  repo.profileList = [
    mk('gm', 'GM', 'All characters', 'gm', [], 1),
    mk('hannah', 'Hannah', 'Sinna', 'player', ['sinna'], 2),
    mk('jean', 'Jean', 'Aster', 'player', ['aster'], 3),
    mk('simon', 'Simon', 'Elwin', 'player', ['elwin'], 4),
    mk('jerba', 'Jerba', 'Javi', 'player', ['javi'], 5),
  ];
}

/** Sets a password and activates the profile directly in the repo (test setup only). */
export async function activate(repo: MemoryRepo, campaignId: string, key: string, password: string) {
  await repo.setCredential(campaignId, key, await hashPassword(password));
  await repo.updateProfile(campaignId, key, { active: true });
}

/** Adds a one-time GM setup code like apex_private.create_gm_setup_code() does. Returns the plain code. */
export function addSetupCode(repo: MemoryRepo, campaignId: string, code = 'ABCD-1234-EF56-7890-ABCD-EF12', validMs = 3600_000) {
  const raw = code.toUpperCase().replace(/[^0-9A-F]/g, '');
  repo.setupCodes.forEach((c) => (c.usedAt ??= repo.now()));
  repo.setupCodes.push({ campaignId, codeHash: createHash('sha256').update(raw).digest('hex'), expiresAt: repo.now() + validMs, usedAt: null });
  return code;
}

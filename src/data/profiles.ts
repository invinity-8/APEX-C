/**
 * Campaign profiles shown on the "Who are you?" screen.
 *
 * DISPLAY ONLY. Choosing a profile grants nothing: the server only opens a profile with its
 * password (checked against an Argon2id hash in Supabase). Role and characters always come from
 * the database (table apex_profiles). No passwords or secrets belong in this file.
 *
 * The same five profiles are seeded into Supabase by the baseline migration
 * supabase/migrations/20261101145653_apex_baseline.sql (keys and token ids must match).
 */
export type ProfileRole = 'gm' | 'player';

export interface ProfileConfig {
  key: string;
  /** The person's first name. */
  name: string;
  /** Character played (GM: all characters). */
  character: string;
  role: ProfileRole;
  /** Game tokens this profile controls (GM: none listed – the GM controls everything). */
  tokenIds: string[];
  /** Portrait styling */
  color: string;
  sigil: string;
  epithet: string;
}

export const PROFILES: ProfileConfig[] = [
  { key: 'gm', name: 'GM', character: 'All characters', role: 'gm', tokenIds: [], color: '#e9c46a', sigil: '♛', epithet: 'Editor of the Arena' },
  { key: 'hannah', name: 'Hannah', character: 'Sinna', role: 'player', tokenIds: ['sinna'], color: '#e9c46a', sigil: '✦', epithet: 'Will-Weaver' },
  { key: 'jean', name: 'Jean', character: 'Aster', role: 'player', tokenIds: ['aster'], color: '#6fb1e0', sigil: '⚔', epithet: 'Retired Legionary' },
  { key: 'simon', name: 'Simon', character: 'Elwin', role: 'player', tokenIds: ['elwin'], color: '#7cc98a', sigil: '➹', epithet: 'Scout' },
  { key: 'jerba', name: 'Jerba', character: 'Javi', role: 'player', tokenIds: ['javi'], color: '#ece4d2', sigil: '☉', epithet: 'Gladiator-Priest' },
];

export const profileByKey = (key: string | null | undefined): ProfileConfig | undefined => PROFILES.find((p) => p.key === key);

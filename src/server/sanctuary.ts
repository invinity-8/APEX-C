import type { AuthUser, Repo } from './repo.js';
import type { SceneResult } from './scenes.js';
export interface SanctuarySettings { revision: number; atmosphere: 'hall' | 'campfire' | 'starlight'; defaultAsset: string | null; backgrounds: { assetId: string; name: string }[] }
export const defaultSanctuary = (): SanctuarySettings => ({ revision: 0, atmosphere: 'hall', defaultAsset: null, backgrounds: [] });
export interface SanctuaryStore {
  get(campaignId: string): Promise<SanctuarySettings>;
  save(campaignId: string, expected: number, settings: Omit<SanctuarySettings,'revision'>): Promise<SanctuarySettings | null>;
}
export async function sanctuaryRequest(user: AuthUser, method: string, body: unknown, repo: Repo): Promise<SceneResult> {
  if (!repo.sanctuary) return { status: 503, body: { error: 'Sanctuary settings unavailable.' } };
  if (method === 'GET') return { status: 200, body: await repo.sanctuary.get(user.campaignId) };
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed.' } };
  if (user.role !== 'gm') return { status: 403, body: { error: 'Only the GM can approve Sanctuary backgrounds.' } };
  const v = body as SanctuarySettings | null;
  if (!v || !Number.isSafeInteger(v.revision) || v.revision < 0 || !['hall','campfire','starlight'].includes(v.atmosphere) || !Array.isArray(v.backgrounds) || v.backgrounds.length > 20) return { status: 400, body: { error: 'Invalid Sanctuary settings.' } };
  const backgrounds: SanctuarySettings['backgrounds'] = [];
  for (const b of v.backgrounds) {
    if (!b || typeof b.assetId !== 'string' || !/^[0-9a-f-]{36}$/i.test(b.assetId) || typeof b.name !== 'string' || !b.name.trim() || b.name.length > 120 || backgrounds.some(x => x.assetId === b.assetId)) return { status: 400, body: { error: 'Invalid approved background.' } };
    backgrounds.push({ assetId: b.assetId, name: b.name.trim() });
  }
  if (v.defaultAsset !== null && !backgrounds.some(b => b.assetId === v.defaultAsset)) return { status: 400, body: { error: 'The default background must be approved.' } };
  const assets = await Promise.all(backgrounds.map(b => repo.sceneAssets?.get(user.campaignId, b.assetId)));
  if (assets.some(a => !a || a.audience !== 'players')) return { status: 400, body: { error: 'Approve only player-safe images from this campaign.' } };
  const settings = await repo.sanctuary.save(user.campaignId, v.revision, { atmosphere: v.atmosphere, backgrounds, defaultAsset: v.defaultAsset });
  return settings ? { status: 200, body: settings } : { status: 409, body: { error: 'Sanctuary settings changed. Reload them first.' } };
}

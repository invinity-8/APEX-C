/**
 * Cosmetic rewards UI (APEX 0.7): the decorated portrait, the player's picker (only unlocked cosmetics) and the
 * GM's grant / revoke table. Purely visual – nothing here changes rules.
 */
import type { ReactNode } from 'react';
import type { Command } from '../game/commands';
import { activeCosmetics, COSMETIC_KIND_LABEL, COSMETICS, cosmetic, type CharacterCosmetics, type CosmeticKind } from '../game/cosmetics';
import type { Token } from '../game/types';
import type { DispatchResult } from '../state/gameApi';

/** Wraps a portrait with the selected frame, laurel wreath and ornament. */
export function DecoratedPortrait({ cosmetics, size, children }: { cosmetics?: CharacterCosmetics; size: number; children: ReactNode }) {
  const a = activeCosmetics(cosmetics);
  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size + 18, height: size + 18 }} data-cosmetic-frame={a.frame?.id ?? ''} data-cosmetic-wreath={a.wreath?.id ?? ''}>
      {a.wreath && (
        <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0" aria-hidden>
          {Array.from({ length: 9 }, (_, i) => {
            const t = (-210 + i * 15) * (Math.PI / 180);
            const t2 = (30 - i * 15) * (Math.PI / 180);
            return (
              <g key={i} fill={a.wreath!.value} opacity=".9">
                <ellipse cx={50 + 46 * Math.cos(t)} cy={50 - 46 * Math.sin(t)} rx="5" ry="2.4" transform={`rotate(${(-210 + i * 15) * -1 + 90} ${50 + 46 * Math.cos(t)} ${50 - 46 * Math.sin(t)})`} />
                <ellipse cx={50 + 46 * Math.cos(t2)} cy={50 - 46 * Math.sin(t2)} rx="5" ry="2.4" transform={`rotate(${(30 - i * 15) * -1 + 90} ${50 + 46 * Math.cos(t2)} ${50 - 46 * Math.sin(t2)})`} />
              </g>
            );
          })}
        </svg>
      )}
      <span className="rounded-full" style={a.frame ? { boxShadow: `0 0 0 3px ${a.frame.value}, 0 0 10px ${a.frame.value}66` } : undefined}>
        {children}
      </span>
      {a.ornament && (
        <span className="absolute -right-0.5 -bottom-0.5 grid h-6 w-6 place-items-center rounded-full border border-gold-500/70 bg-ink-900 text-[13px] text-gold-200" title={a.ornament.name} data-testid="cosmetic-ornament">
          {a.ornament.value}
        </span>
      )}
    </span>
  );
}

/** Card style for the selected background / border (plain when nothing is selected). */
export function cosmeticCardStyle(c?: CharacterCosmetics): React.CSSProperties {
  const a = activeCosmetics(c);
  return { ...(a.background ? { background: a.background.value } : {}), ...(a.border ? { borderColor: a.border.value, boxShadow: `0 0 0 1px ${a.border.value}55` } : {}) };
}

export function CosmeticTitle({ cosmetics }: { cosmetics?: CharacterCosmetics }) {
  const t = activeCosmetics(cosmetics).title;
  return t ? (
    <span className="ml-2 rounded border border-gold-600/60 px-1.5 py-0.5 align-middle text-[10px] uppercase tracking-wider text-gold-200" data-testid="cosmetic-title">
      {t.value}
    </span>
  ) : null;
}

/** Player: choose among unlocked cosmetics (each kind: none or one). */
export function CosmeticsPicker({ tokenId, cosmetics, run }: { tokenId: string; cosmetics?: CharacterCosmetics; run: (cmd: Command) => Promise<DispatchResult> }) {
  const unlocked = (cosmetics?.unlocked ?? []).map((id) => cosmetic(id)).filter((d): d is NonNullable<typeof d> => !!d);
  const kinds = [...new Set(unlocked.map((d) => d.kind))];
  return (
    <section className="panel space-y-2 p-3 text-xs" aria-label="Cosmetic rewards">
      <h3 className="panel-title">Cosmetic rewards</h3>
      {!unlocked.length ? (
        <p className="text-marble-500">No cosmetic rewards yet – the Game Master awards frames, laurels, decorations, backgrounds and titles.</p>
      ) : (
        kinds.map((kind) => (
          <label key={kind} className="flex items-center gap-2 text-marble-300">
            <span className="w-36">{COSMETIC_KIND_LABEL[kind]}</span>
            <select
              className="rounded-md border border-ink-600 bg-ink-900 px-2 py-1 text-xs text-marble-50"
              aria-label={COSMETIC_KIND_LABEL[kind]}
              value={cosmetics?.selected[kind] ?? ''}
              onChange={(e) => void run({ type: 'setCosmetics', tokenId, selected: { [kind]: e.target.value || null } })}
            >
              <option value="">None</option>
              {unlocked
                .filter((d) => d.kind === kind)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </select>
          </label>
        ))
      )}
    </section>
  );
}

/** GM: grant or revoke cosmetic rewards per character (and see who owns what). */
export function CosmeticGrants({ players, run }: { players: Token[]; run: (cmd: Command) => Promise<DispatchResult> }) {
  return (
    <section className="panel space-y-2 p-3 text-xs" aria-label="Cosmetic rewards (GM)">
      <h3 className="panel-title">Cosmetic rewards</h3>
      <p className="text-marble-500">Visual rewards only – no effect on rules. Players choose among the ones they own.</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="text-marble-500">
            <tr>
              <th className="text-left font-normal">Reward</th>
              {players.map((p) => (
                <th key={p.id} className="font-normal">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {COSMETICS.map((c) => (
              <tr key={c.id} className="border-t border-ink-800">
                <td className="py-0.5 pr-2 text-marble-200" title={c.description}>
                  {c.name} <span className="text-marble-600">· {COSMETIC_KIND_LABEL[c.kind as CosmeticKind]}</span>
                </td>
                {players.map((p) => {
                  const owns = !!p.cosmetics?.unlocked.includes(c.id);
                  return (
                    <td key={p.id} className="text-center">
                      <input type="checkbox" checked={owns} aria-label={`${c.name} for ${p.name}`} onChange={(e) => void run({ type: 'gmCosmetic', tokenId: p.id, cosmeticId: c.id, grant: e.target.checked })} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

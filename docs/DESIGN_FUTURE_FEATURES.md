# APEX – design proposals for future features

Status: **proposal only** – nothing in this document is implemented. Decisions marked **(GM decides)** need the
Game Master's input before implementation. All proposals keep the existing architecture: server-authoritative
commands (`executeCommand` in `src/game/commands.ts`), idempotent request ids, the shared game state with version
sync + Realtime "version" pings, Fog of War via `buildPlayerView`, and GM-only authorization.

---

## 1. Dice and check system

### Goals
- Rolls are **made on the server** – a client can never choose or replay a result.
- The GM can **request a check** from one or several players ("Sinna, roll Athletics DC 15").
- Results are visible according to rules (public, GM-only, or roller + GM).
- Later: optional 3D dice animation, with a calm alternative for reduced motion and low-end devices.

### Data model (additive, inside the game state)
```ts
interface CheckRequest {
  id: string;                    // also the idempotency anchor
  createdBy: 'gm';
  targets: string[];             // token ids
  label: string;                 // "Athletics (swim across the river)"
  formula: string;               // "1d20+@athletics" – @refs resolved from the character sheet, or a fixed "+5"
  dc?: number;                   // hidden from players unless revealDc
  revealDc: boolean;
  visibility: 'public' | 'gm' | 'rollerAndGm';
  advantage?: 'adv' | 'dis';
  status: 'open' | 'done' | 'cancelled';
  results: Record<string, RollResult>;   // per token
  createdAt: { day: number; phase: Phase };
}
interface RollResult { dice: number[]; kept: number[]; modifier: number; total: number; success?: boolean; at: string }
```
`GameState.checks` keeps the last ~50 entries (like announcements), so every device catches up through the normal sync.

### Commands
- `requestCheck` (GM) – creates a `CheckRequest`.
- `rollCheck` (player for own token, or GM for any) – server rolls with `crypto.getRandomValues` (uniform, rejection
  sampling – never `Math.random`), stores the result. Repeating the same request id returns the stored result instead
  of re-rolling (prevents "reroll by retry").
- `freeRoll` (anyone, own token) – an unrequested roll, logged with its visibility.
- `cancelCheck` (GM).

The formula parser is small and strict: `NdM`, `+/-` integers, `kh/kl` (keep highest/lowest), `@skill` references.
Max 20 dice, sides ∈ {4,6,8,10,12,20,100}. Unknown references are rejected, not guessed.

### Visibility
`buildPlayerView` filters `checks`: players see public checks, their own results, and – for `rollerAndGm` – only their
own. Hidden DCs are removed. The GM view shows everything.

### UI
- GM: "Request check" in the Selection panel and in a new GM sidebar section "Checks" (open requests, results).
- Player: a centred, accessible prompt ("The GM asks for Athletics") with a **Roll** button; the result appears in
  the prompt and in the chronicle.
- **3D dice (later)**: a lazily loaded module (e.g. three.js + a physics-free scripted tumble that *ends on the
  server's result* – the animation never decides). Loaded only on demand, off for `prefers-reduced-motion`, on
  devices with `navigator.hardwareConcurrency <= 4`, or via a user setting. The fallback is a short number count-up /
  plain result card.

### Effort
Server + model + tests: ~1 day. Basic UI: ~1 day. 3D dice: 1–2 days, separate PR.

---

## 2. Swimming and water traversal

Today: `river` costs 3 MP (fordable), `water` (lakes) is impassable; events can turn land into lakes.

### Proposed mechanics (to be confirmed – no final fatigue rules invented here)
1. **Shallow vs. deep water**: add a `depth` hint for water hexes, derived by the generator (water hexes adjacent to
   land = shallow). Shallow water: passable, high MP cost (proposal 4 MP). Deep water: needs a swim check.
2. **Swim check per deep hex** (uses the dice system above): `rollCheck` Athletics vs. a DC set per lake or globally
   **(GM decides: DC, and whether the GM approves each attempt)**.
   - success → the move into the hex happens;
   - failure → the character stays put, MP are spent **(GM decides: full or half cost)**.
3. **Fatigue / exhaustion**: track a `swimStreak` (consecutive water hexes this phase) on the token. What it causes
   (exhaustion levels, Willpower loss, forced stop, drowning risk) is **(GM decides)** – the engine only exposes the
   counter and a GM-configurable threshold with an action "ask the GM" (a pending decision, like event approval).
4. **Equipment**: inventory items can carry a tag (`swim-aid`, `heavy`) that adjust the DC or cost; the tag list is
   GM-editable. No automatic weight system.
5. **Night**: optional extra DC at night **(GM decides)**.
6. **Fog of War**: lakes stay terrain like any other – no changes needed; a character on water sees normally.

### Implementation sketch
- `terrain.ts`: `water` gets `cost: null` plus `swimCost`; movement validation (`commands.ts` `move`) gains a branch
  "requires check" that returns a structured `needsCheck` response instead of an error.
- The client shows "This needs a swim check (Athletics DC 12) – roll?" and sends `rollCheck` + `move` as one
  command (`swimMove`) so the outcome is atomic and server-decided.
- Pathfinding/reach preview (`viewRules.ts`) shows water hexes as "check required" (striped highlight).

---

## 3. AI Event Assistant

### Goal
Help the GM **draft** arena events ("a storm floods the eastern forest on day 4") – never act on its own.

### Structured event format
The assistant must return exactly the shape the server already validates for `createEvent`
(`src/server/validate.ts`), extended with a trigger:
```json
{
  "name": "The Eastern Deluge",
  "description": "Black clouds burst over the eastern woods…",
  "trigger": { "type": "day", "day": 4 } ,
  "effects": [
    { "type": "setTerrain", "terrain": "water", "area": { "center": "12,-4", "radius": 3 } },
    { "type": "modifyMovePoints", "amount": -1 }
  ],
  "announce": true,
  "rationale": "Pushes tributes toward the centre before the shrink on day 5."
}
```
`area` is expanded to hex keys on the server. The output is checked by the **same validator** as manual events;
anything invalid is rejected and shown to the GM, not "repaired" silently.

### Flow
1. GM opens "Events → Draft with AI", types an idea, optionally picks a map region.
2. Server endpoint `op=ai-event` (GM-only, rate-limited, e.g. 20/day per campaign) builds a **minimal, GM-safe
   context**: arena radius, day/phase, shrink schedule, terrain counts per region, site names/positions, party
   positions (the GM may see these). No passwords, no session data, no character sheets unless the GM ticks a box.
3. The model returns JSON (tool use / structured output). Server validates → returns a *draft*.
4. The draft appears in the Event Library as a custom event with the normal **preview**; it does nothing until the GM
   approves it like any other event.

### Integration options
| Option | Pros | Cons |
|---|---|---|
| **A. Server-side call to the Claude API** from the Vercel function (recommended) | key stays on the server; same auth/validation path; simple | needs an API key + budget; adds latency (a few seconds) |
| B. GM pastes a prompt into any chat assistant and pastes the JSON back | zero cost, no key | manual, error-prone |
| C. Supabase Edge Function | isolates the key from the app | second runtime to maintain |

For option A: a current Claude model (e.g. `claude-sonnet-5-5` for quality/cost balance) with a JSON tool schema;
timeout 20 s; no streaming needed.

### Cost
Per draft roughly 2–4k input tokens (context) + ~500 output tokens. With token-based pricing this is a fraction of
a cent to a few cents per draft depending on the model – **check the current price list before enabling**. A hard
monthly budget (env var, e.g. `APEX_AI_MONTHLY_LIMIT`) and the per-campaign daily limit keep costs bounded.
**Do not enable a paid provider without the owner's approval.**

### Security
- API key only as a Vercel environment variable (never in the bundle, repo or logs).
- GM-only endpoint, CSRF header, rate limit, request size limit.
- Prompt-injection: player-written text (names, notes) is passed as quoted data, never as instructions; the output
  is only ever data validated against the strict schema – the model cannot call commands.
- Every draft and approval is logged in the GM log; nothing reaches players before approval.
- Privacy: the context excludes personal data; document in the README what is sent to the provider.

### Not in scope
No provider is installed by this document. Implementation would be a separate PR after a decision on option A/B/C
and the budget.

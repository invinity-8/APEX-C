# The World of APEX – Placeholder Lore

These notes are an **original** draft inspired by the *concept* of transferable willpower. No texts,
terms or plots are taken from other works. Everything can be changed freely.

## The Empire

A Rome at the height of its power – carried by magic as much as by legions: floating aqueducts,
roads (*Viae Arcanae*) that carry marching troops forward, signal towers with bronze mirrors and
self-propelled siege towers.

## The Aquila Aurea and the Labyrinthus Imperii

At the heart of the arena rises the **Aquila Aurea**, a colossal golden eagle on a marble dais – the symbol
of the Empire's power. Around it winds the **Labyrinthus Imperii**, concentric walls of ancient marble
inlaid with golden inscriptions that glow at night. Its purpose is unknown; the inscriptions are a hook
for future campaign events.

## Voluntas – bound willpower

- Every person has **Voluntas**, a measurable willpower.
- Through the state's **Tributum Voluntatis** citizens give up part of it. The power flows into
  **anchor stones** (infrastructure) or **will vials** (portable stores).
- Whoever *receives* Voluntas becomes stronger, faster, cleverer. Whoever gives too much becomes dull and pliant.
- The arena itself is powered by a hidden anchor stone (see *Templum Oblitum*). It holds the borders –
  and makes them shrink.

## Mechanics (data model prepared)

| Element | Where in code | Idea |
|---|---|---|
| *(removed in APEX 0.7)* | – | Voluntas stays a story concept; the old Willpower resource and will vessels are no longer part of the game state |
| Site `Fons Voluntatis` | `src/data/demo.ts` | Refills vials – at a risk |
| Event effect `modifyMovePoints` | `src/game/events.ts` | Example: “Willstorm” |

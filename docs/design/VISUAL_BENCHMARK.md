# APEX 0.5 visual & performance benchmark

Measured 2026-11-02 in the cloud dev container: production build (demo mode), headless Chromium **without GPU**
(software WebGL/canvas – pessimistic), 1400×900, no CPU throttling. Scripts: `bench/visuals.cjs`,
`bench/character.ts`, `bench/arena-size.ts`, `bench/render.cjs`.

## Welcome screen (Spline hero)
| | poster visible | hero | runtime + scene | lazily transferred | frame median / p95 | JS heap |
|---|---|---|---|---|---|---|
| default | 0.57 s | live 3D | 0.32 s | ~0.95–1.4 MB | 16.7 / 16.8 ms | 8 MB |
| reduced motion | 0.22 s | poster only | not loaded | 1 KB | 16.7 / 16.7 ms | 3 MB |

Main bundle unchanged by Spline (the runtime is only in lazy chunks).

## Map (after the orb fix)
| arena | view | atmosphere | load | idle frames median/p95 | pan median/p95 | day→night | heap |
|---|---|---|---|---|---|---|---|
| r39 | GM | on | 657 ms | 16.7/33.4 | 16.7/33.4 | 224 ms | 11 MB |
| r39 | GM | off | 409 ms | 16.7/33.4 | 33.3/33.4 | 212 ms | 12 MB |
| r39 | player | on | 397 ms | 16.7/33.3 | 16.7/50.0 | – | 8 MB |
| r39 | player | off | 352 ms | 16.7/16.8 | 16.7/50.0 | – | 9 MB |
| r78 | GM | on | 524 ms | 16.7/33.4 | 16.7/33.4 | 266 ms | 15 MB |
| r78 | GM | off | 491 ms | 16.7/16.8 | 16.7/33.4 | 206 ms | 15 MB |
| r78 | player | on | 411 ms | 16.7/33.3 | 16.7/33.4 | – | 15 MB |
| r78 | player | off | 415 ms | 16.7/16.7 | 33.3/50.0 | – | 21 MB |

Found and fixed while measuring: the resource orbs' endless CSS surface animation cost a full frame on every frame
in the player view (idle median 33 ms → 16.7 ms after removing it; value changes still animate).

## Character commands (radius-78 world, Node)
| command | before | after (clone only the character) |
|---|---|---|
| setWeaponSet | 26.8 ms | 0.07 ms |
| equipItem | 27.7 ms | 0.04 ms |
| setResting | 31.3 ms | 0.03 ms |
| invAddItem | 29.4 ms | 0.08 ms |
| deriveStats (client per render) | 0.01 ms | 0.01 ms |

No polling, no Realtime traffic for layout, atmosphere or orb configuration changes (orb configuration is one
sheet save when the player presses Save).

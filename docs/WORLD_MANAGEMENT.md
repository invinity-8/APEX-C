# World Management (APEX 0.4)

GM-only, in the right sidebar: **World Management**. All actions are checked on the server, carry a request id
(applied at most once) and replace worlds in **one database transaction** (`apex_world_transition`).

| Action | What happens |
|---|---|
| **Archive World** | A complete copy of the current world is stored in `apex_world_archives` (name, description, date). The world itself does not change. Success is only reported after the database confirmed the insert. |
| **Create New World** | Name, radius, optional seed, *keep progress* or *fresh start*. The current world is archived, a new world is generated, character data is carried over, and the new world becomes active – all in one transaction. |
| **Reset Current World** | Like *Create New World* with the same name/radius and a new random seed. Requires typing `RESET`. |
| **Restore Archived World** | Shows the archive and its date; the current world is archived first. Inventories/Will: *keep current* (default) or *use archived*. |

## What belongs where

| Level | Data | On a world change |
|---|---|---|
| Account | profiles, passwords (Argon2id hashes), roles, sessions | never touched (other tables) |
| Character | character sheets (own table), inventory + containers, name/title/colour, maximum Will, vision and movement traits, control rights | kept |
| World | map, seed, radius, positions, movement points left, vision bonus, explored terrain (Fog of War), sightings, sites, events, day/night, shrinking, log | new world: initialised by the APEX rules; restore: from the archive |

*Keep progress* keeps the current Will; *Fresh start* refills it to the maximum. Hit points and resources on the character sheet are
never changed by world actions.

## Safety
- **Atomic:** lock state row → check expected version → archive current world (copied inside the database) → replace → bump version.
  Any failure rolls everything back; the previous world stays active and loadable. There is no state in which no world can be loaded.
- **Concurrency:** a move or another GM action between reading and switching makes the version check fail (`409`, nothing changed).
  Duplicate clicks / retries reuse the request id and are applied once.
- **Stale clients:** every command carries the world id it was made for; commands for a replaced world are rejected (`409 world_changed`)
  and the client reloads. The version bump is broadcast via Realtime, so every connected device switches and shows a notice.
- **Fog of War:** players still receive only `buildPlayerView()` of the active world; archives are never sent to players.

# APEX MAIN – Supabase connection and access setup

Supabase project URL: https://xqkyaqxuoaxadpkcdhch.supabase.co
GitHub repository: https://github.com/invinity-8/APEX-C

## Current status (2026-11-01)
The initial `apex_invites` and `apex_access` tables, an auth-user synchronization trigger, and row-level security were created in Supabase. These tables define *who may be assigned an APEX role*; they do not yet make the current browser-based demo a secure online multiplayer application.

Allowed account emails:
- GM: felixbecker924@gmail.com
- Player: hannah.hartmann@unitybox.de
- Player: beckerjean21@gmail.com

No passwords are stored in this repository. Each participant should use a **separate Supabase Auth email/password account**. To create or invite users, use Supabase > Authentication > Users. Do not send passwords to the developer or commit them to GitHub.

## Next implementation steps
1. Implement Supabase Auth email/password login and session handling.
2. Resolve identity from `apex_access` rather than trusting any user-selected frontend role.
3. Add a centrally stored `game_states` record and server-side command validation.
4. Provide individually filtered `player_views`, with RLS enforced; never deliver secret GM state to player browsers.
5. Configure Vercel environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (public/publishable only). Never place service-role or secret keys in Vite variables.
6. Verify GM, Player 1, Player 2, and unauthenticated permissions, plus realtime sync across different browsers.

## Current deployment caveat
The current website is still a LOCAL DEMO. Role switching in the demo is for testing, not access control. Do not treat it as an authenticated multiplayer environment until the online architecture and RLS are implemented and validated.

# Online-Modus mit Supabase (Phase 2) – Konzept

> **Stand v0.1:** Noch nicht umgesetzt. Die App läuft ausschließlich im **Demo-Modus**:
> Alles liegt im `localStorage` *eines* Browsers. Der Rollenwechsel GM/Spieler ist dort
> ein Testwerkzeug – **kein Schutz** geheimer Daten. Bitte nicht als echte Mehrspieler-Lösung verwenden.

## Das Sicherheitsprinzip

Geheime Spielleiterdaten dürfen nie im Browser eines Spielers ankommen – auch nicht „versteckt“.
Deshalb ist die Spiellogik schon jetzt so gebaut, dass sie 1:1 auf einen Server wandern kann:

| Baustein (heute im Browser) | Später auf dem Server |
|---|---|
| `executeCommand(state, actor, cmd)` – prüft Rechte & Regeln | Edge Function `apply-command` |
| `buildPlayerView(state, tokenId)` – filtert alles Geheime heraus | Edge Function schreibt das Ergebnis in `player_views` |
| `GameState` in `localStorage` | Tabelle `game_states` (nur GM lesbar) |

```
Spieler-Browser                     Supabase
───────────────                     ────────────────────────────────────────────
 klickt "ziehen" ──insert──▶  commands (status=pending)
                                     │  (Database Webhook / Trigger)
                                     ▼
                              Edge Function apply-command
                                1. game_states laden (Service Role)
                                2. executeCommand(...)  ← gleiche Datei wie heute
                                3. game_states speichern (version + 1)
                                4. für jeden Spieler buildPlayerView(...)
                                   → player_views upsert
 ◀──Realtime── player_views (RLS: nur eigene Zeile)
 GM-Browser ◀──Realtime── game_states (RLS: nur GM)
```

Die Tabellen und RLS-Policies stehen als Entwurf in `supabase/migrations/0001_init.sql`.

## Umsetzungsschritte (Vorschlag)

1. **Supabase-Projekt anlegen** (kostenloser Plan reicht): <https://supabase.com> → *New project*.
2. **Migration einspielen:** im Supabase-Dashboard → *SQL Editor* → Inhalt von `supabase/migrations/0001_init.sql` ausführen.
3. **Auth aktivieren:** *Authentication → Providers → Email* (Magic Link ist am einfachsten für eine private Runde).
4. **Edge Function `apply-command`** schreiben, die `src/game/commands.ts` und `src/game/visibility.ts` importiert
   (Deno kann TypeScript direkt). Wichtig: optimistisches Sperren über `game_states.version`,
   damit zwei gleichzeitige Commands sich nicht überschreiben.
5. **Frontend:** `src/state/useGame.ts` bekommt eine Online-Variante (`useOnlineGame`), die
   - als GM `game_states` liest/abonniert,
   - als Spieler **nur** `player_views` liest/abonniert,
   - `dispatch()` als Insert in `commands` ausführt.
   Die Komponenten bleiben unverändert, weil sie schon heute nur mit `ViewModel` arbeiten.
6. **Umgebungsvariablen** in Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   (der Anon-Key ist öffentlich und durch RLS abgesichert). Der **Service-Role-Key** gehört
   ausschließlich in die Edge Function – niemals ins Frontend oder ins Git-Repository.
7. **Backups:** `state_snapshots` bei jedem Tageswechsel befüllen; zusätzlich JSON-Export wie im Demo-Modus.

## Was die Tests heute schon absichern

`tests/visibility.test.ts → "Spieleransicht enthält keine geheimen GM-Daten"` prüft, dass
`buildPlayerView` keine versteckten Orte, GM-Notizen, Seeds, GM-Logeinträge oder Rivalen
außerhalb der Sicht enthält. Diese Garantie ist die Grundlage für den Online-Modus.

## Bewusste Grenzen / offene Punkte

- Die Karte (Gelände) steckt heute im Spielstand. Online sollte der Seed **nie** an Spieler gehen
  (wird bereits herausgefiltert), sonst könnten sie die Karte nachrechnen.
- RLS-Policies sind ein Entwurf und müssen vor Produktivbetrieb mit echten Test-Accounts
  (GM, Spieler A, Spieler B) geprüft werden.

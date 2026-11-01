-- ============================================================================
-- APEX 0.2 – seed the main campaign and its first invitations (idempotent).
--
-- Invitations are redeemed by the server (/api/apex) the first time a user with a
-- CONFIRMED matching email address signs in. Characters are assigned afterwards in
-- the GM interface ("Players" tab) – nothing is hard-coded in the frontend.
-- Add future players in the GM interface, or with another insert like the ones below.
-- ============================================================================

insert into public.apex_campaigns (slug, name)
values ('main', 'APEX – Arena of the Eternal Will')
on conflict (slug) do nothing;

insert into public.apex_campaign_invites (campaign_id, email, role)
select c.id, v.email, v.role
from public.apex_campaigns c
cross join (values
  ('felixbecker924@gmail.com',    'gm'),
  ('hannah.hartmann@unitybox.de', 'player'),
  ('beckerjean21@gmail.com',      'player')
) as v(email, role)
where c.slug = 'main'
on conflict (campaign_id, email) do nothing;

-- Optional: also import entries from the manually created apex_access table, if it
-- exists with "email" and "role" columns. Unknown roles become 'player'.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'apex_access' and column_name = 'email')
     and exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'apex_access' and column_name = 'role') then
    execute $q$
      insert into public.apex_campaign_invites (campaign_id, email, role)
      select c.id,
             lower(trim(a.email::text)),
             case when lower(a.role::text) in ('gm', 'game_master', 'gamemaster', 'game master', 'admin', 'spielleiter')
                  then 'gm' else 'player' end
      from public.apex_access a
      cross join public.apex_campaigns c
      where c.slug = 'main' and a.email is not null and trim(a.email::text) <> ''
      on conflict (campaign_id, email) do nothing
    $q$;
  end if;
exception when others then
  raise notice 'apex_access import skipped: %', sqlerrm;
end $$;

-- Minimal stand-in for the Supabase-managed parts (auth schema, roles, realtime publication)
-- so the migrations can be verified against a plain local PostgreSQL. NOT for production.
drop database if exists apex_test;
create database apex_test;
\c apex_test
do $$ begin
  create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
create publication supabase_realtime;
-- Replica of the PRODUCTION legacy objects from migration 20261101094428
-- (structure only – the original also inserted three email addresses, omitted here).
create schema if not exists apex_private;
create table public.apex_invites (
 email text primary key,
 role text not null check (role in ('gm','player')),
 token_id text,
 created_at timestamptz not null default now(),
 constraint normalized_email check (email = lower(trim(email)))
);
create table public.apex_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check (role in ('gm','player')),
 token_id text,
 created_at timestamptz not null default now()
);
alter table public.apex_invites enable row level security;
alter table public.apex_access enable row level security;
create policy apex_access_read_self on public.apex_access for select to authenticated using (user_id = (select auth.uid()));
create or replace function apex_private.sync_access_from_invites() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.apex_access(user_id, role, token_id)
 select new.id, i.role, i.token_id from public.apex_invites i where i.email = lower(trim(new.email))
 on conflict (user_id) do update set role = excluded.role, token_id = excluded.token_id;
 return new;
end;
$$;
create trigger apex_auth_user_access after insert or update of email on auth.users
for each row execute function apex_private.sync_access_from_invites();
insert into public.apex_invites (email, role) values ('legacy-gm@example.test', 'gm');

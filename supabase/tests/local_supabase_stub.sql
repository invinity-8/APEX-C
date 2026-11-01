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
-- a pre-existing manual apex_access table
create table public.apex_access (email text, role text);
insert into public.apex_access values ('extra.player@example.com','player'), ('felixbecker924@gmail.com','gm');

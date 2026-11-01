-- ============================================================================
-- APEX – login code request log for server-side rate limiting (additive).
-- Stores only a SHA-256 hash of the email address, never the address or the code.
-- ============================================================================

create table if not exists public.apex_login_requests (
  id          bigint generated always as identity primary key,
  email_hash  text not null,
  outcome     text not null check (outcome in ('accepted', 'ignored', 'rate_limited', 'delivery_failed', 'quota')),
  created_at  timestamptz not null default now()
);
create index if not exists apex_login_requests_email_idx on public.apex_login_requests (email_hash, created_at desc);
create index if not exists apex_login_requests_time_idx on public.apex_login_requests (created_at desc);

alter table public.apex_login_requests enable row level security;
revoke all on table public.apex_login_requests from anon, authenticated;
grant all on table public.apex_login_requests to service_role;
grant usage, select on all sequences in schema public to service_role;

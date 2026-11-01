-- ============================================================================
-- Security advisor: public.rls_auto_enable() executable by anon/authenticated.
--
-- The function is Supabase's helper behind the event trigger "ensure_rls"
-- (enables RLS automatically on every new table in schema public). It is owned by
-- postgres, SECURITY DEFINER, returns event_trigger and had EXECUTE granted to
-- PUBLIC, anon and authenticated, so it was exposed as /rest/v1/rpc/rls_auto_enable.
-- PostgreSQL refuses to run event-trigger functions outside their trigger, so it was not
-- exploitable – but nobody needs to call it, so the grants are revoked.
--
-- Minimal and non-destructive: the function, its owner and the event trigger stay
-- unchanged; event triggers do not need EXECUTE for the role that runs the DDL
-- (verified locally: RLS is still enabled on tables created by a non-owner role).
-- ============================================================================
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable() from public;
    if exists (select 1 from pg_roles where rolname = 'anon') then
      revoke execute on function public.rls_auto_enable() from anon, authenticated;
    end if;
  end if;
end $$;

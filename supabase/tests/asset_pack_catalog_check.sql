do $$
declare
  pack_count integer;
  available_count integer;
begin
  select count(*), count(*) filter (where availability = 'available')
    into pack_count, available_count
  from public.apex_asset_packs;

  if pack_count <> 8 then
    raise exception 'Expected 8 Kenney asset pack records, found %', pack_count;
  end if;
  if available_count <> 0 then
    raise exception 'Local database has no uploaded Storage objects; expected all asset packs pending, found % available', available_count;
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.apex_asset_packs'::regclass) then
    raise exception 'Asset catalog must have row-level security enabled';
  end if;
  if has_table_privilege('anon', 'public.apex_asset_packs', 'select')
     or has_table_privilege('authenticated', 'public.apex_asset_packs', 'select') then
    raise exception 'Asset catalog must not be readable by browser roles';
  end if;
  if not has_table_privilege('service_role', 'public.apex_asset_packs', 'select') then
    raise exception 'Server service role must be able to read the asset catalog';
  end if;
  if exists (
    select 1 from storage.buckets
    where id = 'apex-asset-packs' and public
  ) then
    raise exception 'Asset pack Storage bucket must remain private';
  end if;
end;
$$;


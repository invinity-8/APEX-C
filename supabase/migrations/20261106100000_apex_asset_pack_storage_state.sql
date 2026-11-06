-- Reconcile the catalog with the private Storage uploads already present in APEX MAIN.
-- Fresh local databases have no Storage objects and safely keep these rows pending.
alter table public.apex_asset_packs enable row level security;
revoke all on public.apex_asset_packs from public, anon, authenticated;
grant select on public.apex_asset_packs to service_role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('apex-asset-packs', 'apex-asset-packs', false)
    on conflict (id) do update set public = false;
  end if;

  if to_regclass('storage.objects') is not null then
    execute $sql$
      update public.apex_asset_packs as pack
      set storage_bucket = 'apex-asset-packs',
          storage_path = expected.storage_path,
          availability = 'available',
          agent_instructions = 'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.',
          updated_at = now()
      from (values
        ('kenney_castle_kit_v2_0', 'kenney_castle-kit/', 397),
        ('kenney_fantasy_town_kit_v2_0', 'kenney_fantasy-town-kit_2.0/', 847),
        ('kenney_mini_arena_v1_1', 'kenney_mini-arena/', 120),
        ('kenney_modular_cave_kit_v1_0', 'kenney_modular-cave-kit_1.0/', 214),
        ('kenney_modular_dungeon_kit_v2_1', 'kenney_modular-dungeon-kit_1.0/', 209),
        ('kenney_nature_kit_v2_1', 'kenney_nature-kit/', 3618),
        ('kenney_prototype_kit_v1_0', 'kenney_prototype-kit/', 740),
        ('kenney_survival_kit_v2_0', 'kenney_survival-kit/', 412)
      ) as expected(id, storage_path, expected_files)
      where pack.id = expected.id
        and (
          select count(*)
          from storage.objects as object
          where object.bucket_id = 'apex-asset-packs'
            and left(object.name, length(expected.storage_path)) = expected.storage_path
        ) >= expected.expected_files
    $sql$;
  end if;
end;
$$;


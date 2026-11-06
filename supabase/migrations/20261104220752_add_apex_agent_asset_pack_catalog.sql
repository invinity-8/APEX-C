-- Reconstructed migration source from the already-applied production catalog.
-- The migration version exists in production; this file restores that history in Git.
-- Asset binaries stay in the private Storage bucket and are never copied into Git.

create table if not exists public.apex_asset_packs (
  id text primary key,
  display_name text not null,
  creator text not null default 'Kenney',
  version text,
  license text not null default 'CC0-1.0',
  archive_sha256 text not null,
  archive_bytes bigint not null,
  model_count integer not null,
  archive_file_count integer not null,
  storage_bucket text,
  storage_path text,
  availability text not null default 'pending_upload'
    check (availability in ('pending_upload', 'available', 'unavailable')),
  agent_instructions text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apex_asset_packs is
  'Private APEX asset discovery catalog. availability=available is set only after all expected extracted files exist in private Storage.';

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
end;
$$;

insert into public.apex_asset_packs (
  id, display_name, version, archive_sha256, archive_bytes,
  model_count, archive_file_count, agent_instructions
)
values
  ('kenney_castle_kit_v2_0', 'Kenney Castle Kit', '2.0', '921f3f73927bb23106cae34bc21d5ab4b033a9fc120475e96f714a406e3169df', 2232589, 76, 397,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_fantasy_town_kit_v2_0', 'Kenney Fantasy Town Kit', '2.0', '1a7530c09f4d2fa2cdee259876f089334f8b1f27fa86a0c4f54ef86cdd8676ef', 3854691, 167, 847,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_mini_arena_v1_1', 'Kenney Mini Arena', '1.1', '514760c2bc2457027451534a0b06a23f98beece166fb11ed2321226276b83c2c', 731420, 22, 120,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_modular_cave_kit_v1_0', 'Kenney Modular Cave Kit', '1.0', '48f37a6d4f241124cd7da17da1c6d4ed1bf1820bb149dcb233fbd5ebdd8ba996', 7025078, 40, 214,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_modular_dungeon_kit_v2_1', 'Kenney Modular Dungeon Kit', '2.1', 'dd0aa6776db8912283cdca60161dee6a8839bbda3558eba2ea501419eb5b4623', 6886434, 39, 209,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_nature_kit_v2_1', 'Kenney Nature Kit', '2.1', 'fa7974a0d342bfe63c38664ba9f8ec1a4aab8ea25f099bdc56870e33588c4d9d', 10537521, 329, 3618,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_prototype_kit_v1_0', 'Kenney Prototype Kit', '1.0', '213b522fb12bcc9b9ac66c4f7581f7c74623293272212e40a70c39936ad3da95', 2961396, 145, 740,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.'),
  ('kenney_survival_kit_v2_0', 'Kenney Survival Kit', '2.0', 'c3586341b5932c87eb43d75d915434f47daed168b17ed36a03e8ca9977c7443e', 1948174, 80, 412,
   'Available as extracted files in private Storage under storage_path. Prefer GLB for APEX. The archive SHA-256 and size refer to the original ZIP.')
on conflict (id) do nothing;


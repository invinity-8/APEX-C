-- ============================================================================
-- APEX 0.4 – private storage bucket for character portraits. Additive.
--
-- * Bucket "apex-portraits" is PRIVATE (public = false), max 2 MB, only JPEG/PNG/WebP.
-- * No storage policies are created: anon/authenticated cannot list, read or write objects.
--   Only the APEX server (service_role) uploads after validating the image and hands out
--   short-lived signed URLs to signed-in campaign members.
-- ============================================================================
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('apex-portraits', 'apex-portraits', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

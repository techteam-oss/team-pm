-- Profile pictures: public "avatars" bucket, each user writes only to their own folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "upload own avatar" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "replace own avatar" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "remove own avatar" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- People may edit their name, picture and theme, but not their email (invites match on it).
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, theme) on public.profiles to authenticated;

-- Avatars must come from this project's avatars bucket (no external tracking images).
alter table public.profiles add constraint avatar_url_from_bucket
  check (avatar_url is null or avatar_url like 'https://oxcoqixujubjiasimmwm.supabase.co/storage/v1/object/public/avatars/%') not valid;

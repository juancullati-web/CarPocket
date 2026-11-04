-- CarPocket : comptes et collections. Ce script peut être relancé sans danger.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now()
);

create table if not exists public.deck_items (
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  thumb text check (thumb is null or thumb ~ '^https://[a-z]+\.wikimedia\.org/'),
  main_photo text check (main_photo is null or main_photo ~ '^photos/[a-z0-9-]+/[0-9]+\.(jpg|png|webp)$'),
  added_at timestamptz not null default now(),
  primary key (user_id, title)
);

-- Photos propres à chaque collection : envoyées par la personne, ou masquées dans le catalogue.
alter table public.deck_items add column if not exists custom_photos text[] not null default '{}';
alter table public.deck_items add column if not exists hidden_photos text[] not null default '{}';

-- Une collection ne peut désigner que des fichiers rangés dans le dossier de son propriétaire.
create or replace function public.photos_in_folder(paths text[], owner_id uuid)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_and(p like owner_id::text || '/%'), true) from unnest(paths) as p;
$$;

alter table public.deck_items drop constraint if exists deck_items_custom_photos_check;
alter table public.deck_items add constraint deck_items_custom_photos_check
  check (cardinality(custom_photos) <= 20 and public.photos_in_folder(custom_photos, user_id));
alter table public.deck_items drop constraint if exists deck_items_hidden_photos_check;
alter table public.deck_items add constraint deck_items_hidden_photos_check
  check (cardinality(hidden_photos) <= 50);
alter table public.deck_items drop constraint if exists deck_items_main_photo_check;
alter table public.deck_items add constraint deck_items_main_photo_check
  check (main_photo is null
    or main_photo ~ '^photos/[a-z0-9-]+/[0-9]+\.(jpg|png|webp)$'
    or main_photo ~ '^[0-9a-f-]{36}/[a-z0-9-]+\.jpg$');

-- Wikimedia peut servir ses vignettes depuis plusieurs sous-domaines.
alter table public.deck_items drop constraint if exists deck_items_thumb_check;
alter table public.deck_items add constraint deck_items_thumb_check
  check (thumb is null or thumb ~ '^https://[a-z]+\.wikimedia\.org/');

-- L'avatar est un identifiant choisi dans la liste du site, jamais une image envoyée.
alter table public.profiles add column if not exists avatar text;
alter table public.profiles drop constraint if exists profiles_avatar_check;
alter table public.profiles add constraint profiles_avatar_check
  check (avatar is null or avatar ~ '^(emoji|marque|perso):[a-z0-9-]{1,30}$');

-- Chacun peut masquer sa collection : les autres comptes connectés ne la voient plus.
alter table public.profiles add column if not exists shared boolean not null default true;

-- Le profil se crée tout seul avec le compte, toujours en simple membre.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, username)
  values (new.id, lower(split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, username)
select id, lower(split_part(email, '@', 1)) from auth.users
on conflict (id) do nothing;

-- Lit le rôle sans repasser par les règles de la table, pour éviter une boucle.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Le rôle des autres n'est lisible que par l'administrateur.
create or replace function public.account_roles()
returns table (id uuid, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.role from public.profiles p where public.is_admin();
$$;

revoke all on function public.account_roles() from public, anon;
grant execute on function public.account_roles() to authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.deck_items enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.deck_items from anon, authenticated;
-- Le rôle n'est pas lisible directement, et seuls l'avatar et le partage sont modifiables.
grant select (id, username, avatar, shared) on public.profiles to authenticated;
grant update (avatar, shared) on public.profiles to authenticated;
grant select, insert, delete on public.deck_items to authenticated;
grant update (main_photo, custom_photos, hidden_photos) on public.deck_items to authenticated;

drop policy if exists "profil lisible par soi ou l'admin" on public.profiles;
drop policy if exists "profil lisible si partagé" on public.profiles;
create policy "profil lisible si partagé" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or shared or (select public.is_admin()));

drop policy if exists "avatar modifiable par soi" on public.profiles;
create policy "avatar modifiable par soi" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "collection lisible par soi ou l'admin" on public.deck_items;
drop policy if exists "collection lisible si partagée" on public.deck_items;
create policy "collection lisible si partagée" on public.deck_items
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.profiles p where p.id = deck_items.user_id and p.shared)
  );

drop policy if exists "ajout dans sa collection" on public.deck_items;
create policy "ajout dans sa collection" on public.deck_items
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "modification de sa collection" on public.deck_items;
create policy "modification de sa collection" on public.deck_items
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "retrait de sa collection" on public.deck_items;
create policy "retrait de sa collection" on public.deck_items
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Stockage privé des photos : lisibles avec les mêmes droits que la collection.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-photos', 'user-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "carpocket photos lecture" on storage.objects;
create policy "carpocket photos lecture" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'user-photos' and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
      or exists (
        select 1 from public.profiles p
        where p.id::text = (storage.foldername(name))[1] and p.shared
      )
    )
  );

drop policy if exists "carpocket photos ajout" on storage.objects;
create policy "carpocket photos ajout" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "carpocket photos suppression" on storage.objects;
create policy "carpocket photos suppression" on storage.objects
  for delete to authenticated
  using (bucket_id = 'user-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

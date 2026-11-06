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

-- Notes et valeurs modifiées : propres à chaque collection, jamais au catalogue partagé.
alter table public.deck_items add column if not exists notes text not null default '';
alter table public.deck_items add column if not exists custom_specs jsonb not null default '{}';

create or replace function public.custom_specs_valid(specs jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(specs) = 'object' and not exists (
    select 1 from jsonb_each(specs) as field(key, value)
    where field.key not in ('engine', 'power', 'torque', 'transmission', 'layout', 'top_speed', 'zero_100',
      'weight', 'length', 'width', 'height', 'wheelbase', 'body', 'production', 'designer', 'assembly')
      or jsonb_typeof(field.value) <> 'string'
      or char_length(field.value #>> '{}') not between 1 and 200
  );
$$;

alter table public.deck_items add column if not exists custom_summary text not null default '';
alter table public.deck_items drop constraint if exists deck_items_custom_summary_check;
alter table public.deck_items add constraint deck_items_custom_summary_check check (char_length(custom_summary) <= 5000);
alter table public.deck_items drop constraint if exists deck_items_notes_check;
alter table public.deck_items add constraint deck_items_notes_check check (char_length(notes) <= 2000);
alter table public.deck_items drop constraint if exists deck_items_custom_specs_check;
alter table public.deck_items add constraint deck_items_custom_specs_check check (public.custom_specs_valid(custom_specs));
-- La source d'une valeur retenue : { "power": { "label": "...", "url": "https://..." } }.
alter table public.deck_items add column if not exists custom_sources jsonb not null default '{}';

create or replace function public.custom_sources_valid(sources jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(sources) = 'object' and pg_column_size(sources) < 20000 and not exists (
    select 1 from jsonb_each(sources) as field(key, value)
    where jsonb_typeof(field.value) <> 'object'
      or char_length(coalesce(field.value ->> 'label', '')) not between 1 and 200
      or char_length(coalesce(field.value ->> 'url', '')) > 500
      or coalesce(field.value ->> 'url', '') !~ '^https://[^[:space:]]+$'
  );
$$;

alter table public.deck_items drop constraint if exists deck_items_custom_sources_check;
alter table public.deck_items add constraint deck_items_custom_sources_check check (public.custom_sources_valid(custom_sources));
-- Le lien avec la voiture : possédée, essayée ou rêvée.
alter table public.deck_items add column if not exists status text;
alter table public.deck_items drop constraint if exists deck_items_status_check;
alter table public.deck_items add constraint deck_items_status_check check (status is null or status in ('owned', 'driven', 'dream'));
alter table public.deck_items drop constraint if exists deck_items_main_photo_check;
alter table public.deck_items add constraint deck_items_main_photo_check
  check (main_photo is null
    or main_photo ~ '^photos/[a-z0-9-]+/[0-9]+\.(jpg|png|webp)$'
    or main_photo ~ '^[0-9a-f-]{36}/[a-z0-9-]+\.jpg$'
    or main_photo ~ '^https://(upload|thumb)\.wikimedia\.org/[^[:space:]]+$');

-- Photos libres de Wikimedia Commons choisies par la personne, avec auteur et licence.
alter table public.deck_items add column if not exists free_photos jsonb not null default '[]';

create or replace function public.free_photos_valid(photos jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 5 and not exists (
    select 1 from jsonb_array_elements(photos) as photo
    where jsonb_typeof(photo) <> 'object'
      or coalesce(photo ->> 'file', '') !~ '^https://(upload|thumb)\.wikimedia\.org/[^[:space:]]+$'
      or coalesce(photo ->> 'thumb', '') !~ '^https://(upload|thumb)\.wikimedia\.org/[^[:space:]]+$'
      or coalesce(photo ->> 'source_url', '') !~ '^https://commons\.wikimedia\.org/[^[:space:]]+$'
      or char_length(coalesce(photo ->> 'author', '')) not between 1 and 300
      or char_length(coalesce(photo ->> 'license', '')) not between 1 and 100
      or char_length(photo::text) > 2000
  );
$$;

alter table public.deck_items drop constraint if exists deck_items_free_photos_check;
alter table public.deck_items add constraint deck_items_free_photos_check check (public.free_photos_valid(free_photos));

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
grant update (main_photo, custom_photos, hidden_photos, notes, custom_specs, custom_sources, custom_summary, status, free_photos) on public.deck_items to authenticated;

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

-- Commentaires et réactions sur la voiture d'une collection : mêmes droits de lecture qu'elle.
create table if not exists public.car_comments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  title text not null,
  author_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  author_name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now(),
  foreign key (owner_id, title) references public.deck_items (user_id, title) on delete cascade on update cascade
);
create index if not exists car_comments_item on public.car_comments (owner_id, title, created_at);

create table if not exists public.car_reactions (
  owner_id uuid not null,
  title text not null,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('like', 'want')),
  created_at timestamptz not null default now(),
  primary key (owner_id, title, user_id, kind),
  foreign key (owner_id, title) references public.deck_items (user_id, title) on delete cascade on update cascade
);

-- L'auteur et la date ne viennent jamais du navigateur.
create or replace function public.car_comment_author()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.author_id := auth.uid();
  new.created_at := now();
  new.author_name := coalesce((select username from public.profiles where id = auth.uid()), '');
  return new;
end;
$$;
revoke all on function public.car_comment_author() from public, anon, authenticated;
drop trigger if exists car_comment_author on public.car_comments;
create trigger car_comment_author before insert on public.car_comments
  for each row execute function public.car_comment_author();

alter table public.car_comments enable row level security;
alter table public.car_reactions enable row level security;
revoke all on public.car_comments from anon, authenticated;
revoke all on public.car_reactions from anon, authenticated;
grant select, delete on public.car_comments to authenticated;
grant insert (owner_id, title, body) on public.car_comments to authenticated;
grant update (title) on public.car_comments to authenticated;
grant select, delete on public.car_reactions to authenticated;
grant insert (owner_id, title, kind) on public.car_reactions to authenticated;
grant update (title) on public.car_reactions to authenticated;

drop policy if exists "commentaires lisibles avec la collection" on public.car_comments;
create policy "commentaires lisibles avec la collection" on public.car_comments
  for select to authenticated using (
    owner_id = (select auth.uid()) or (select public.is_admin())
    or exists (select 1 from public.profiles p where p.id = car_comments.owner_id and p.shared)
  );
drop policy if exists "commenter une collection visible" on public.car_comments;
create policy "commenter une collection visible" on public.car_comments
  for insert to authenticated with check (
    owner_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = car_comments.owner_id and p.shared)
  );
drop policy if exists "retirer son commentaire ou ceux de sa collection" on public.car_comments;
create policy "retirer son commentaire ou ceux de sa collection" on public.car_comments
  for delete to authenticated using (
    author_id = (select auth.uid()) or owner_id = (select auth.uid()) or (select public.is_admin())
  );
drop policy if exists "suivre le changement de version" on public.car_comments;
create policy "suivre le changement de version" on public.car_comments
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

drop policy if exists "réactions lisibles avec la collection" on public.car_reactions;
create policy "réactions lisibles avec la collection" on public.car_reactions
  for select to authenticated using (
    owner_id = (select auth.uid()) or (select public.is_admin())
    or exists (select 1 from public.profiles p where p.id = car_reactions.owner_id and p.shared)
  );
drop policy if exists "réagir à une collection visible" on public.car_reactions;
create policy "réagir à une collection visible" on public.car_reactions
  for insert to authenticated with check (
    user_id = (select auth.uid()) and owner_id <> (select auth.uid())
    and exists (select 1 from public.profiles p where p.id = car_reactions.owner_id and p.shared)
  );
drop policy if exists "retirer sa réaction" on public.car_reactions;
create policy "retirer sa réaction" on public.car_reactions
  for delete to authenticated using (user_id = (select auth.uid()));
drop policy if exists "suivre le changement de version" on public.car_reactions;
create policy "suivre le changement de version" on public.car_reactions
  for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- Ce qu'un compte a déjà vu, commun à tous ses appareils et lisible par lui seul.
create table if not exists public.user_state (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  comments_seen_at timestamptz not null default now()
);
alter table public.user_state enable row level security;
revoke all on public.user_state from anon, authenticated;
grant select on public.user_state to authenticated;
grant insert (user_id, comments_seen_at), update (user_id, comments_seen_at) on public.user_state to authenticated;
drop policy if exists "son propre état" on public.user_state;
create policy "son propre état" on public.user_state
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

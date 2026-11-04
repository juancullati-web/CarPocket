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
  thumb text check (thumb is null or thumb like 'https://upload.wikimedia.org/%'),
  main_photo text check (main_photo is null or main_photo ~ '^photos/[a-z0-9-]+/[0-9]+\.(jpg|png|webp)$'),
  added_at timestamptz not null default now(),
  primary key (user_id, title)
);

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

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.deck_items enable row level security;

revoke all on public.profiles from anon, authenticated;
revoke all on public.deck_items from anon, authenticated;
-- Personne ne peut modifier un profil depuis le site, donc ni changer son rôle.
grant select on public.profiles to authenticated;
grant select, insert, delete on public.deck_items to authenticated;
grant update (main_photo) on public.deck_items to authenticated;

drop policy if exists "profil lisible par soi ou l'admin" on public.profiles;
create policy "profil lisible par soi ou l'admin" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "collection lisible par soi ou l'admin" on public.deck_items;
create policy "collection lisible par soi ou l'admin" on public.deck_items
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

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

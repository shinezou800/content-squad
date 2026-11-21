begin;

create schema private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table public.app_owner (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz default now()
);
alter table public.app_owner enable row level security;
alter table public.app_owner force row level security;
revoke all on public.app_owner from public, anon, authenticated;

create function private.is_app_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_owner o where o.user_id = auth.uid()
  );
$$;
alter function private.is_app_owner() owner to postgres;
revoke all on function private.is_app_owner() from public, anon;
grant execute on function private.is_app_owner() to authenticated;

create table public.runs (
  id text primary key,
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  squad_id text,
  topic text,
  status text check (status in ('draft', 'approved')),
  data jsonb not null,
  created_at timestamptz,
  updated_at timestamptz default now()
);
alter table public.runs enable row level security;
alter table public.runs force row level security;
revoke all on public.runs from public, anon, authenticated;
grant select, insert, update, delete on public.runs to authenticated;

create policy runs_select on public.runs for select to authenticated
using (owner_id = auth.uid() and private.is_app_owner());
create policy runs_insert on public.runs for insert to authenticated
with check (owner_id = auth.uid() and private.is_app_owner());
create policy runs_update on public.runs for update to authenticated
using (owner_id = auth.uid() and private.is_app_owner())
with check (owner_id = auth.uid() and private.is_app_owner());
create policy runs_delete on public.runs for delete to authenticated
using (owner_id = auth.uid() and private.is_app_owner());

create index runs_owner_created_at_idx on public.runs (owner_id, created_at desc);

commit;

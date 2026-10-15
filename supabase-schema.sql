create table if not exists public.harvest_records (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  kind_name text not null default '',
  detail text not null default '',
  amount integer not null default 0,
  created timestamptz not null default now()
);

create index if not exists harvest_records_user_date_idx
  on public.harvest_records(user_id, date);

alter table public.harvest_records enable row level security;

drop policy if exists "Users can read their own harvest records" on public.harvest_records;
create policy "Users can read their own harvest records"
  on public.harvest_records for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own harvest records" on public.harvest_records;
create policy "Users can insert their own harvest records"
  on public.harvest_records for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own harvest records" on public.harvest_records;
create policy "Users can update their own harvest records"
  on public.harvest_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own harvest records" on public.harvest_records;
create policy "Users can delete their own harvest records"
  on public.harvest_records for delete
  using (auth.uid() = user_id);
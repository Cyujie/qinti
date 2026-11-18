-- 在 supabase-schema.sql 之后运行。旧零串行继续可读，仅正数占用日期。
begin;
create unique index if not exists harvest_positive_day
  on public.harvest_records(user_id, date) where amount > 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.harvest_records'::regclass
                 and conname = 'harvest_new_amount_positive') then
    alter table public.harvest_records add constraint harvest_new_amount_positive
      check (amount > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.harvest_records'::regclass
                 and conname = 'harvest_whole_bunches') then
    alter table public.harvest_records add constraint harvest_whole_bunches
      check (amount % 30 = 0) not valid;
  end if;
end $$;

create table if not exists public.harvest_checkins (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null default ((now() at time zone 'Asia/Shanghai')::date),
  primary key (user_id, date)
);
alter table public.harvest_checkins enable row level security;
revoke all on public.harvest_checkins from public, anon, authenticated;
grant select, insert on public.harvest_checkins to authenticated;
drop policy if exists checkins_read on public.harvest_checkins;
create policy checkins_read on public.harvest_checkins for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists checkins_insert on public.harvest_checkins;
create policy checkins_insert on public.harvest_checkins for insert to authenticated
  with check (user_id = (select auth.uid()) and date <= (now() at time zone 'Asia/Shanghai')::date);

-- 采摘和导入公用一个事务；按文件顺序保留每天第一条正数，历史零串跳过。
create or replace function public.qinti_save_harvest(p_user uuid, p_rows jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare inserted integer; bad_position bigint;
begin
  if auth.uid() is null or p_user is distinct from auth.uid() then
    raise exception '账号已变更，请重新提交';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception '记录应为数组';
  end if;
  select position into bad_position from jsonb_array_elements(p_rows) with ordinality a(x,position)
    where jsonb_typeof(x->'amount') is distinct from 'number'
       or (x->>'amount')::numeric <> trunc((x->>'amount')::numeric)
       or mod((x->>'amount')::numeric,30) <> 0
       or (x->>'amount')::numeric not between 0 and 2147483647
       or coalesce(x->>'date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or (x->>'date')::date is null
  order by position limit 1;
  if found then raise exception '第 % 条记录日期或数量无效，数量应为 0 或 30 的倍数',bad_position; end if;

  insert into public.harvest_records (id,user_id,date,kind_name,detail,amount,created)
  select gen_random_uuid()::text,p_user,day,coalesce(item->>'kindName',''),
         coalesce(item->>'detail',''),(item->>'amount')::integer,
         coalesce((item->>'created')::timestamptz,now())
  from (
    select distinct on ((x->>'date')::date) (x->>'date')::date as day,x as item
    from jsonb_array_elements(p_rows) with ordinality a(x,position)
    where (x->>'amount')::integer > 0
    order by (x->>'date')::date,position
  ) as daily
  order by day
  on conflict (user_id,date) where amount > 0 do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function public.qinti_save_harvest(uuid,jsonb) from public, anon;
grant execute on function public.qinti_save_harvest(uuid,jsonb) to authenticated;
commit;

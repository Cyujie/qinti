-- 青提收获统计器 Supabase 数据库结构
-- 用途：保存登录用户自己的青提采摘记录
-- 执行位置：Supabase Dashboard → SQL Editor → New query
-- 注意：请使用项目管理员账号执行本文件

-- =====================================================
-- 1. 收获记录表
-- =====================================================
create table if not exists public.harvest_records (
  -- 记录唯一编号，由网页生成
  id text primary key,

  -- 所属用户，关联 Supabase Auth 用户
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 采摘日期，使用北京时间对应的日期
  date date not null,

  -- 自动判断的采摘类型，例如工作日采摘、周末采摘、凌晨采摘
  kind_name text not null default '',

  -- 本次采摘的文字说明
  detail text not null default '',

  -- 收获数量，按原规则保存为 30、60 等数量值
  amount integer not null default 0,

  -- 记录创建时间
  created timestamptz not null default now()
);

-- 按用户和日期建立索引，加快收获日历和统计查询
create index if not exists harvest_records_user_date_idx
  on public.harvest_records(user_id, date);

-- =====================================================
-- 2. 开启行级安全策略
-- =====================================================
-- 开启后，每条数据都会根据当前登录用户进行权限判断
alter table public.harvest_records enable row level security;

-- =====================================================
-- 3. 查询权限
-- =====================================================
-- 用户只能读取属于自己的收获记录
drop policy if exists "Users can read their own harvest records" on public.harvest_records;
create policy "Users can read their own harvest records"
  on public.harvest_records for select
  using (auth.uid() = user_id);

-- =====================================================
-- 4. 新增权限
-- =====================================================
-- 用户只能新增 user_id 等于自己账号 ID 的记录
drop policy if exists "Users can insert their own harvest records" on public.harvest_records;
create policy "Users can insert their own harvest records"
  on public.harvest_records for insert
  with check (auth.uid() = user_id);

-- =====================================================
-- 5. 修改权限
-- =====================================================
-- 用户只能修改属于自己的收获记录
drop policy if exists "Users can update their own harvest records" on public.harvest_records;
create policy "Users can update their own harvest records"
  on public.harvest_records for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =====================================================
-- 6. 删除权限
-- =====================================================
-- 用户只能删除属于自己的收获记录
drop policy if exists "Users can delete their own harvest records" on public.harvest_records;
create policy "Users can delete their own harvest records"
  on public.harvest_records for delete
  using (auth.uid() = user_id);

-- Install after chat-groups.sql. Room keys and invitation secrets are encrypted on the client.
begin;
alter table qinti_chat.rooms add column if not exists name_version bigint not null default 0;
alter table qinti_chat.rooms add column if not exists encrypted_label text;
create table if not exists qinti_chat.sync_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  verifier text not null check(verifier ~ '^[a-f0-9]{64}$')
);
create table if not exists qinti_chat.key_backups (
  room_id uuid primary key references qinti_chat.rooms(id) on delete cascade,
  envelope text not null check(length(envelope) between 60 and 8192)
);
alter table qinti_chat.sync_accounts enable row level security;
alter table qinti_chat.key_backups enable row level security;
revoke all on qinti_chat.sync_accounts,qinti_chat.key_backups from public,anon,authenticated;

create or replace function public.qinti_directory(action text default 'list', verifier text default null,
  room uuid default null, envelope text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  registered text;
  entries jsonb;
begin
  if uid is null then raise exception 'Unauthorized'; end if;
  if action='name' then
    select jsonb_build_object('room',r.id,'name_version',r.name_version,'encrypted_label',r.encrypted_label,'title',g.title)
      into entries from qinti_chat.rooms r left join qinti_chat.groups g on g.room_id=r.id
      where r.id=room and r.owner_id=uid;
    if not found then raise exception 'Unauthorized'; end if;
    return entries;
  end if;
  if action='enable' then
    insert into qinti_chat.sync_accounts values(uid,verifier) on conflict(owner_id) do nothing;
  end if;
  select a.verifier into registered from qinti_chat.sync_accounts a where a.owner_id=uid;
  if action='list' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created desc),'[]'::jsonb) into entries from (
      select r.id as room,r.created_at as created,g.title,g.room_id is not null as "group",b.envelope,r.name_version,r.encrypted_label
      from qinti_chat.rooms r left join qinti_chat.groups g on g.room_id=r.id
      left join qinti_chat.key_backups b on b.room_id=r.id where r.owner_id=uid) x;
    return jsonb_build_object('verifier',registered,'rooms',entries);
  end if;
  if registered is null or verifier is distinct from registered then raise exception 'Recovery code mismatch'; end if;
  if action='save' then
    insert into qinti_chat.key_backups(room_id,envelope)
      select r.id,$4 from qinti_chat.rooms r where r.id=room and r.owner_id=uid
      on conflict(room_id) do nothing;
    if not exists(select 1 from qinti_chat.rooms r where r.id=room and r.owner_id=uid) then raise exception 'Unauthorized'; end if;
  elsif action<>'enable' then raise exception 'Invalid action'; end if;
  return 'true'::jsonb;
end $$;
revoke all on function public.qinti_directory(text,text,uuid,text) from public,anon;
grant execute on function public.qinti_directory(text,text,uuid,text) to authenticated;
-- Compare the observed version while holding the room lock.
create or replace function public.qinti_rename(room uuid, expected bigint, new_name text)
returns bigint language plpgsql security definer set search_path='' as $$
declare
  version bigint;
begin
  select r.name_version into version from qinti_chat.rooms r
    where r.id=room and r.owner_id=auth.uid() for update;
  if not found then raise exception 'Unauthorized'; end if;
  if version is distinct from expected then
    raise exception 'Name changed' using errcode='40001';
  end if;
  if exists(select 1 from qinti_chat.groups g where g.room_id=room) then
    if new_name is null or char_length(btrim(new_name)) not between 1 and 40 then raise exception 'Invalid group name'; end if;
    update qinti_chat.groups g set title=btrim(new_name) where g.room_id=room;
  else
    if new_name is null or new_name !~ '^[A-Za-z0-9_-]{16}[.][A-Za-z0-9_-]{22,240}$' then raise exception 'Invalid encrypted label'; end if;
    update qinti_chat.rooms r set encrypted_label=new_name where r.id=room;
  end if;
  update qinti_chat.rooms r set name_version=version+1 where r.id=room;
  return version+1;
end $$;
revoke all on function public.qinti_rename(uuid,bigint,text) from public,anon;
grant execute on function public.qinti_rename(uuid,bigint,text) to authenticated;
commit;

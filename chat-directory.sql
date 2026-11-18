-- Install after chat-groups.sql. Room keys and invitation secrets are encrypted on the client.
begin;
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
  if action='enable' then
    insert into qinti_chat.sync_accounts values(uid,verifier) on conflict(owner_id) do nothing;
  end if;
  select a.verifier into registered from qinti_chat.sync_accounts a where a.owner_id=uid;
  if action='list' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created desc),'[]'::jsonb) into entries from (
      select r.id as room,r.created_at as created,g.title,g.room_id is not null as "group",b.envelope
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
commit;

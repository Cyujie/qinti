-- Run once in the project's Supabase SQL Editor. Existing harvest data is untouched.
begin;
create schema if not exists qinti_chat;
revoke all on schema qinti_chat from public, anon, authenticated;
create table qinti_chat.rooms (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  invite_hash text,
  guest_hash text,
  created_at timestamptz not null default now()
);
create index chat_rooms_owner on qinti_chat.rooms(owner_id);
create table qinti_chat.messages (
  seq bigint generated always as identity primary key,
  room_id uuid not null references qinti_chat.rooms(id) on delete cascade,
  from_host boolean not null,
  packet text not null,
  msg_id uuid not null,
  unique(room_id, msg_id)
);
create index chat_message_page on qinti_chat.messages(room_id,seq);
alter table qinti_chat.rooms enable row level security;
alter table qinti_chat.messages enable row level security;
revoke all on all tables in schema qinti_chat from public, anon, authenticated;

create function public.qinti_chat(action text, room uuid, token text default '',
  payload text default '', cursor_seq bigint default 0, message_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  r qinti_chat.rooms%rowtype;
  digest_token text := encode(sha256(convert_to(token,'UTF8')),'hex');
  host boolean;
  result jsonb;
begin
  if action = 'create' then
    if uid is null or payload is null or payload !~ '^[a-f0-9]{64}$' then raise exception 'Unauthorized'; end if;
    insert into qinti_chat.rooms(id,owner_id,invite_hash) values(room,uid,payload);
    return 'true'::jsonb;
  end if;
  if action = 'join' then
    if token is null or token !~ '^[a-f0-9]{64}$' or payload is null or payload !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
    update qinti_chat.rooms set invite_hash=null,guest_hash=payload where id=room
      and invite_hash=digest_token and created_at > now()-interval '24 hours';
    if not found then raise exception 'Invalid invitation'; end if;
    return 'true'::jsonb;
  end if;
  select * into r from qinti_chat.rooms where id=room;
  host := uid is not null and r.owner_id=uid;
  if not found or not (host or coalesce(r.guest_hash=digest_token,false)) or token is null then raise exception 'Unauthorized'; end if;
  if action='close' and host then
    delete from qinti_chat.rooms where id=room;
  elsif action='send' then
    if payload is null or length(payload) not between 40 and 12000 or message_id is null then raise exception 'Invalid message'; end if;
    insert into qinti_chat.messages(room_id,from_host,packet,msg_id)
      values(room,host,payload,message_id) on conflict(room_id,msg_id) do nothing;
  elsif action='read' then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.seq),'[]'::jsonb) into result from
      (select seq,from_host,packet from qinti_chat.messages where room_id=room and seq>cursor_seq order by seq limit 100) m;
    return jsonb_build_object('messages',result,'joined',r.guest_hash is not null);
  else raise exception 'Invalid action'; end if;
  return 'true'::jsonb;
end $$;
revoke all on function public.qinti_chat(text,uuid,text,text,bigint,uuid) from public;
grant execute on function public.qinti_chat(text,uuid,text,text,bigint,uuid) to anon, authenticated;
commit;

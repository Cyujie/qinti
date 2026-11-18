-- Apply after chat-schema.sql and chat-attachments.sql.
begin;
create table if not exists qinti_chat.groups (
  room_id uuid primary key references qinti_chat.rooms(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 40)
);
create table if not exists qinti_chat.group_invites (
  room_id uuid not null references qinti_chat.groups on delete cascade,
  invite_hash text not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  primary key(room_id, invite_hash)
);
create table if not exists qinti_chat.group_members (
  room_id uuid not null references qinti_chat.groups on delete cascade,
  member_id uuid not null default gen_random_uuid(),
  secret_hash text not null,
  nickname text not null check(char_length(nickname) between 1 and 24),
  primary key(room_id, secret_hash),
  unique(room_id,member_id)
);
alter table qinti_chat.messages add column if not exists group_sender uuid;
alter table qinti_chat.groups enable row level security;
alter table qinti_chat.group_invites enable row level security;
alter table qinti_chat.group_members enable row level security;
revoke all on qinti_chat.groups,qinti_chat.group_invites,qinti_chat.group_members from public,anon,authenticated;

create or replace function public.qinti_group(action text, room uuid, token text default '',
  payload text default '', cursor_seq bigint default 0, message_id uuid default null, nickname text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  uid uuid := auth.uid();
  owner_id uuid;
  title text;
  member uuid;
  token_hash text := encode(sha256(convert_to(token,'UTF8')),'hex');
  result jsonb;
begin
  if action='create' then
    if uid is null then raise exception 'Unauthorized'; end if;
    insert into qinti_chat.rooms(id,owner_id) values(room,uid);
    insert into qinti_chat.groups values(room,btrim(payload));
    return 'true'::jsonb;
  end if;
  select r.owner_id,g.title into owner_id,title from qinti_chat.groups g
    join qinti_chat.rooms r on r.id=g.room_id where g.room_id=room;
  if not found then raise exception 'Unauthorized'; end if;

  if action='join' then
    if token is null or token !~ '^[0-9a-f]{64}$' or payload is null or payload !~ '^[0-9a-f]{64}$' then
      raise exception 'Invalid invitation';
    end if;
    delete from qinti_chat.group_invites i where i.room_id=room and i.invite_hash=token_hash and i.expires_at>now();
    if not found then raise exception 'Invalid invitation'; end if;
    insert into qinti_chat.group_members(room_id,secret_hash,nickname) values(room,payload,btrim(nickname));
    return 'true'::jsonb;
  end if;
  if uid is distinct from owner_id then
    if token is null or token !~ '^[0-9a-f]{64}$' then raise exception 'Unauthorized'; end if;
    select m.member_id into member from qinti_chat.group_members m where m.room_id=room and m.secret_hash=token_hash;
    if not found then raise exception 'Unauthorized'; end if;
  end if;
  if action='check' then return 'true'::jsonb;
  elsif action='invite' and member is null then
    if payload is null or payload !~ '^[0-9a-f]{64}$' then raise exception 'Invalid invitation'; end if;
    delete from qinti_chat.group_invites i where i.room_id=room and expires_at<=now();
    insert into qinti_chat.group_invites(room_id,invite_hash) values(room,payload);
  elsif action='close' and member is null then
    delete from qinti_chat.rooms r where r.id=room;
  elsif action='send' then
    if payload is null or length(payload) not between 40 and 12000 or message_id is null then raise exception 'Invalid message'; end if;
    insert into qinti_chat.messages(room_id,from_host,packet,msg_id,group_sender)
      values(room,member is null,payload,message_id,member) on conflict(room_id,msg_id) do nothing;
  elsif action='read' then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb) into result from
      (select m.seq,m.packet, m.group_sender is not distinct from member as mine,
         coalesce(gm.nickname,'群主') as sender, m.from_host
       from qinti_chat.messages m left join qinti_chat.group_members gm
         on gm.room_id=m.room_id and gm.member_id=m.group_sender
       where m.room_id=room and m.seq>cursor_seq order by m.seq limit 100) x;
    return jsonb_build_object('messages',result,'title',title,'members',
      (select count(*)+1 from qinti_chat.group_members gm where gm.room_id=room));
  else raise exception 'Invalid action'; end if;
  return 'true'::jsonb;
end $$;
revoke all on function public.qinti_group(text,uuid,text,text,bigint,uuid,text) from public;
grant execute on function public.qinti_group(text,uuid,text,text,bigint,uuid,text) to anon, authenticated;

create or replace function public.qinti_chat_part(room uuid, token text, file_id uuid, part integer, content text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  chunk bytea;
begin
  -- Use the same membership check as message reads without fetching history.
  if exists(select 1 from qinti_chat.groups g where g.room_id=room) then
    perform public.qinti_group('check',room,token);
  else
    perform public.qinti_chat('read',room,token,'',9223372036854775807);
  end if;
  if file_id is null or part is null or part not between 0 and 64 then
    raise exception 'Invalid attachment';
  end if;
  if content is not null then
    if length(content) not between 4 and 349528 then raise exception 'Invalid attachment'; end if;
    chunk := decode(content,'base64');
    insert into qinti_chat.attachment_parts values (room,file_id,part,chunk)
      on conflict on constraint attachment_parts_pkey do nothing;
  end if;
  select p.bytes into strict chunk from qinti_chat.attachment_parts p
    where p.room_id=$1 and p.file_id=$3 and p.part=$4;
  if content is null then return replace(encode(chunk,'base64'),chr(10),''); end if;
  if chunk <> decode(content,'base64') then raise exception 'Attachment conflict'; end if;
  return 'ok';
end $$;
revoke all on function public.qinti_chat_part(uuid,text,uuid,integer,text) from public;
grant execute on function public.qinti_chat_part(uuid,text,uuid,integer,text) to anon, authenticated;
commit;

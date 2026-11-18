-- Apply once after chat-inbox.sql. Existing invitations retain their original expiration.
begin;
alter table qinti_chat.rooms add column if not exists invite_issued_at timestamptz;
create or replace function public.qinti_chat(action text, room uuid, token text default '',
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
      and invite_hash=digest_token and coalesce(invite_issued_at,created_at) > now()-interval '24 hours';
    if not found then raise exception 'Invalid invitation'; end if;
    return 'true'::jsonb;
  end if;
  select * into r from qinti_chat.rooms where id=room;
  host := uid is not null and r.owner_id=uid;
  if not found or not (host or coalesce(r.guest_hash=digest_token,false)) or token is null then raise exception 'Unauthorized'; end if;
  if action in ('invite_state','renew_invite') then
    if not host or exists(select from qinti_chat.groups g where g.room_id=room) then raise exception 'Unauthorized'; end if;
    if action='renew_invite' then
      if payload is null or payload !~ '^[a-f0-9]{64}$' then raise exception 'Invalid invitation'; end if;
      update qinti_chat.rooms set invite_hash=payload,invite_issued_at=now()
        where id=room and guest_hash is null and invite_hash=token
        returning * into r;
      if not found then raise exception 'Invitation changed' using errcode='40001'; end if;
    end if;
    return jsonb_build_object('joined',r.guest_hash is not null,'invite_hash',r.invite_hash,
      'invite_valid',coalesce(r.invite_issued_at,r.created_at)>now()-interval '24 hours');
  elsif action='close' and host then
    delete from qinti_chat.rooms where id=room;
  elsif action='send' then
    if payload is null or length(payload) not between 40 and 12000 or message_id is null then raise exception 'Invalid message'; end if;
    insert into qinti_chat.messages(room_id,from_host,packet,msg_id)
      values(room,host,payload,message_id) on conflict(room_id,msg_id) do nothing;
  elsif action='read' then
    select coalesce(jsonb_agg(to_jsonb(m) order by m.seq),'[]'::jsonb) into result from
      (select seq,from_host,packet from qinti_chat.messages where room_id=room and seq>cursor_seq order by seq limit 100) m;
    result:=jsonb_build_object('messages',result,'joined',r.guest_hash is not null);
    if host then
      result:=result || jsonb_build_object('invite_hash',r.invite_hash,
        'invite_valid',coalesce(r.invite_issued_at,r.created_at)>now()-interval '24 hours');
    end if;
    return result;
  else raise exception 'Invalid action'; end if;
  return 'true'::jsonb;
end $$;

-- NULL cursor loads the newest page. Older pages use an exclusive upper bound.
create or replace function public.qinti_history(room uuid,token text default '',before_seq bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  grouped boolean;
  meta jsonb;
  page jsonb;
  oldest bigint;
begin
  select exists(select from qinti_chat.groups g where g.room_id=room) into grouped;
  if grouped then
    meta:=public.qinti_group('read',room,token,'',9223372036854775807);
  else
    meta:=public.qinti_chat('read',room,token,'',9223372036854775807);
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.seq),'[]'::jsonb),min(x.seq)
    into page,oldest from (
      select m.seq,m.packet,m.from_host,
        case when auth.uid()=r.owner_id then m.from_host
             else coalesce(gm.secret_hash=encode(sha256(convert_to(token,'UTF8')),'hex'),false) end as mine,
        coalesce(gm.nickname,'群主') as sender
      from qinti_chat.messages m join qinti_chat.rooms r on r.id=m.room_id
      left join qinti_chat.group_members gm on gm.room_id=m.room_id and gm.member_id=m.group_sender
      where m.room_id=room and (before_seq is null or m.seq<before_seq)
      order by m.seq desc limit 100
    ) x;
  return meta || jsonb_build_object('messages',page,'has_older',
    exists(select from qinti_chat.messages m where m.room_id=room and m.seq<oldest));
end $$;
revoke all on function public.qinti_history(uuid,text,bigint) from public;
grant execute on function public.qinti_history(uuid,text,bigint) to anon,authenticated;
commit;

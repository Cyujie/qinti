-- Run after chat-directory.sql. Preserve existing history; unread tracking starts at installation.
begin;
alter table qinti_chat.messages add column if not exists sent_at timestamptz;
alter table qinti_chat.messages alter column sent_at set default now();
alter table qinti_chat.rooms add column if not exists host_read_seq bigint;
update qinti_chat.rooms r set host_read_seq=coalesce(
  (select max(m.seq) from qinti_chat.messages m where m.room_id=r.id),0)
where r.host_read_seq is null;
alter table qinti_chat.rooms alter column host_read_seq set default 0;
alter table qinti_chat.rooms alter column host_read_seq set not null;

create or replace function public.qinti_inbox()
returns table(room uuid, last_seq bigint, last_at timestamptz, incoming_seq bigint, unread bigint)
language sql stable security definer set search_path='' as $$
  select r.id,coalesce(latest.seq,0),latest.sent_at,coalesce(incoming.newest,0),incoming.total
  from qinti_chat.rooms r
  left join lateral (select m.seq,m.sent_at from qinti_chat.messages m
    where m.room_id=r.id order by m.seq desc limit 1) latest on true
  cross join lateral (select max(m.seq) newest,count(*) total from qinti_chat.messages m
    where m.room_id=r.id and not m.from_host and m.seq>r.host_read_seq) incoming
  where r.owner_id=auth.uid()
$$;

create or replace function public.qinti_mark_read(p_room uuid,p_seq bigint)
returns void language sql security definer set search_path='' as $$
  update qinti_chat.rooms r set host_read_seq=p_seq
  where r.id=p_room and r.owner_id=auth.uid() and r.host_read_seq<p_seq
  and exists(select from qinti_chat.messages m where m.room_id=r.id and m.seq=p_seq)
$$;
revoke all on function public.qinti_inbox(),public.qinti_mark_read(uuid,bigint) from public,anon;
grant execute on function public.qinti_inbox(),public.qinti_mark_read(uuid,bigint) to authenticated;
commit;

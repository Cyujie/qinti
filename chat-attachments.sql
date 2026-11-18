-- Apply after chat-schema.sql. Each part contains encrypted bytes only.
begin;
create table if not exists qinti_chat.attachment_parts (
  room_id uuid not null references qinti_chat.rooms(id) on delete cascade,
  file_id uuid not null,
  part integer not null check (part between 0 and 64),
  bytes bytea not null check (octet_length(bytes) between 1 and 262144),
  primary key (room_id, file_id, part)
);
alter table qinti_chat.attachment_parts enable row level security;
revoke all on qinti_chat.attachment_parts from public, anon, authenticated;

create or replace function public.qinti_chat_part(room uuid, token text, file_id uuid, part integer, content text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  chunk bytea;
begin
  -- Use the same membership check as message reads without fetching history.
  perform public.qinti_chat('read',room,token,'',9223372036854775807);
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

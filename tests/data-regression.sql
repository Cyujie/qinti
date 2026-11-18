-- Exercise synthetic rooms and messages inside a single rolled-back transaction.
begin;
do $$
declare
  u uuid; r uuid:=gen_random_uuid(); gr uuid:=gen_random_uuid();
  raw_old text:=repeat('a',64); raw_new text:=repeat('b',64); guest text:=repeat('c',64);
  old_hash text:=encode(sha256(convert_to(raw_old,'UTF8')),'hex');
  new_hash text:=encode(sha256(convert_to(raw_new,'UTF8')),'hex');
  guest_hash text:=encode(sha256(convert_to(guest,'UTF8')),'hex');
  page jsonb; first_seq bigint; got integer[]; pos integer; rejected boolean;
begin
  select id into strict u from auth.users limit 1;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform public.qinti_chat('create',r,'',old_hash);
  update qinti_chat.rooms set created_at=now()-interval '2 days' where id=r;
  assert (public.qinti_chat('invite_state',r)->>'invite_valid')::boolean=false;
  perform public.qinti_chat('renew_invite',r,old_hash,new_hash);
  assert (public.qinti_chat('invite_state',r)->>'invite_valid')::boolean;
  rejected:=false;
  begin perform public.qinti_chat('renew_invite',r,old_hash,guest_hash);
  exception when serialization_failure then rejected:=true; end;
  assert rejected,'stale renewal must fail';
  perform set_config('request.jwt.claim.sub','',true);
  rejected:=false;
  begin perform public.qinti_chat('join',r,raw_old,guest_hash);
  exception when raise_exception then rejected:=true; end;
  assert rejected,'old invitation must be revoked';
  perform public.qinti_chat('join',r,raw_new,guest_hash);
  rejected:=false;
  begin perform public.qinti_history(r,raw_old);
  exception when raise_exception then rejected:=true; end;
  assert rejected,'only current members may read';
  perform set_config('request.jwt.claim.sub',u::text,true);
  rejected:=false;
  begin perform public.qinti_chat('renew_invite',r,new_hash,guest_hash);
  exception when serialization_failure then rejected:=true; end;
  assert rejected,'claimed room must stay closed to new invitations';
  insert into qinti_chat.messages(room_id,from_host,packet,msg_id)
    select r,true,g.n::text,gen_random_uuid() from generate_series(1,235) g(n) order by g.n;
  perform set_config('request.jwt.claim.sub','',true);
  foreach pos in array array[136,36,1] loop
    page:=public.qinti_history(r,guest,first_seq);
    select array_agg((m->>'packet')::int order by n),min((m->>'seq')::bigint) into got,first_seq
      from jsonb_array_elements(page->'messages') with ordinality e(m,n);
    assert got=array(select generate_series(pos,case when pos=1 then 35 else pos+99 end)), 'incorrect page order or boundary';
    assert (page->>'has_older')::boolean=(pos>1);
  end loop;
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform public.qinti_group('create',gr,'','Test group');
  perform public.qinti_group('send',gr,'',repeat('0',64),0,gen_random_uuid());
  page:=public.qinti_history(gr);
  assert (page#>>'{messages,0,mine}')::boolean and page->>'title'='Test group';
  rejected:=false;
  begin
    perform public.qinti_save_harvest(u,'[{"date":"1800-01-01","amount":30},{"date":"1800-01-01","amount":1}]');
  exception when raise_exception then
    rejected:=sqlerrm like '第 2 条%';
  end;
  assert rejected,'invalid duplicate import row must be identified';
end $$;
rollback;
select 'PASS' as chat_and_harvest_checks;

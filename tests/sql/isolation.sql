begin;
insert into auth.users(id) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
update public.profiles set approved=true where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
set local role authenticated;
set local request.jwt.claim.sub='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ declare p jsonb:='{"tasks":[],"sessions":[],"reviews":[],"materials":[],"events":[],"notes":[],"replacement":[],"mistakes":[],"settings":{},"examScopes":{},"integration":{}}'; result jsonb;
begin
 result:=public.planejamento_write(0,p);
 if result->>'revision'<>'1' then raise exception 'First write did not return revision 1'; end if;
 result:=public.planejamento_write(1,p);
 if result->>'revision'<>'1' then raise exception 'Identical retry incremented revision'; end if;
 begin perform public.planejamento_write(0,p);raise exception 'Stale write was accepted';exception when sqlstate 'PT409' then null;end;
 begin update public.planejamento_documents set payload='{}';raise exception 'Direct update was allowed';exception when insufficient_privilege then null;end;
 begin delete from public.planejamento_documents;raise exception 'Direct delete was allowed';exception when insufficient_privilege then null;end;
 begin perform public.planejamento_write(1,'{}');raise exception 'Malformed payload was accepted';exception when sqlstate '22023' then null;end;
end $$;
set local request.jwt.claim.sub='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$ begin if (select count(*) from public.planejamento_documents)<>0 then raise exception 'Another account can read the first account';end if;end $$;
set local role anon;
do $$ begin
 begin perform count(*) from public.planejamento_documents;raise exception 'Anonymous read allowed';exception when insufficient_privilege then null;end;
 begin perform public.planejamento_write(0,'{}');raise exception 'Anonymous RPC allowed';exception when insufficient_privilege then null;end;
end $$;
set local role authenticated;
set local request.jwt.claim.sub='';
do $$ begin
 begin perform public.planejamento_write(0,'{}');raise exception 'Missing auth identity accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
select count(*)=0 as test_records_rolled_back from public.planejamento_documents;

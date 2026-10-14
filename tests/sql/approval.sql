-- Rollback-only authorization checks; run after both migrations.
begin;
insert into auth.users(id,email,raw_user_meta_data) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','approval-a@example.invalid','{"full_name":"Teste","approved":true}'),('dddddddd-dddd-4ddd-8ddd-dddddddddddd','approval-b@example.invalid','{}');
insert into public.planejamento_documents(user_id,payload) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','{"tasks": [], "sessions": [], "reviews": [], "materials": [], "events": [], "notes": [], "replacement": [], "mistakes": [], "settings": {}, "examScopes": {}, "integration": {}}');
do $$ begin if (select approved from public.profiles where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc') then raise exception 'Metadata bypass'; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);
do $$ begin
 if public.planejamento_is_approved() then raise exception 'Pending approved'; end if;
 if exists(select 1 from public.planejamento_documents) then raise exception 'Pending read allowed'; end if;
 if (select count(*) from public.profiles)<>1 then raise exception 'Profile isolation'; end if;
 begin update public.profiles set approved=true where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';raise exception 'Self approval allowed';exception when insufficient_privilege then null;end;
 begin perform public.planejamento_write(1,'{"tasks": [], "sessions": [], "reviews": [], "materials": [], "events": [], "notes": [], "replacement": [], "mistakes": [], "settings": {}, "examScopes": {}, "integration": {}}');raise exception 'Pending write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.profiles set approved=true where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
update auth.users set raw_user_meta_data='{"full_name":"Novo nome","approved":false}' where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
do $$ begin
 if not public.planejamento_is_approved() then raise exception 'Metadata revoked approval'; end if;
 if (select count(*) from public.planejamento_documents)<>1 then raise exception 'Approved read denied'; end if;
 perform public.planejamento_write(1,'{"tasks": [], "sessions": [], "reviews": [], "materials": [], "events": [], "notes": [], "replacement": [], "mistakes": [], "settings": {}, "examScopes": {}, "integration": {}}');
end $$;
reset role;
update public.profiles set approved=false where id='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
set local role authenticated;
do $$ begin
 if exists(select 1 from public.planejamento_documents) then raise exception 'Revoked read allowed'; end if;
 begin perform public.planejamento_write(1,'{"tasks": [], "sessions": [], "reviews": [], "materials": [], "events": [], "notes": [], "replacement": [], "mistakes": [], "settings": {}, "examScopes": {}, "integration": {}}');raise exception 'Revoked write allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select true as approval_checks_passed;

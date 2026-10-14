-- Manual account approval managed in Supabase Table Editor, like MedReview.
begin;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 name text not null default '',
 email text not null default '',
 approved boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
drop policy if exists planejamento_profile_own on public.profiles;
create policy planejamento_profile_own on public.profiles for select to authenticated using (id=auth.uid());
create or replace function public.planejamento_profile_created()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,name,email)
 values(new.id,left(coalesce(new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'name',''),100),coalesce(new.email,''))
 on conflict(id) do update set name=excluded.name,email=excluded.email;
 return new;
end $$;
revoke all on function public.planejamento_profile_created() from public, anon, authenticated;
drop trigger if exists planejamento_profile_created on auth.users;
create trigger planejamento_profile_created after insert or update of email,raw_user_meta_data on auth.users
 for each row execute function public.planejamento_profile_created();
-- Existing accounts also require the administrator's explicit approval.
insert into public.profiles(id,name,email)
 select id,left(coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',''),100),coalesce(email,'') from auth.users
 on conflict(id) do nothing;
create or replace function public.planejamento_is_approved()
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and approved=true);
$$;
revoke all on function public.planejamento_is_approved() from public,anon;
grant execute on function public.planejamento_is_approved() to authenticated;
drop policy if exists planejamento_read_own on public.planejamento_documents;
create policy planejamento_read_own on public.planejamento_documents for select to authenticated
 using (auth.uid()=user_id and public.planejamento_is_approved());
create or replace function public.planejamento_write(expected_revision bigint, new_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); current_row public.planejamento_documents; field text;
begin
 if owner is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
 if not public.planejamento_is_approved() then raise exception 'Sua conta aguarda aprovação do administrador.' using errcode='42501'; end if;
 if expected_revision is null or expected_revision<0 then raise exception 'Revisão inválida.' using errcode='22023'; end if;
 if jsonb_typeof(new_payload) is distinct from 'object' or octet_length(new_payload::text)>1500000 then
  raise exception 'Dados inválidos ou acima de 1,5 MB.' using errcode='22023'; end if;
 for field in select jsonb_object_keys(new_payload) loop
  if not field=any(array['tasks','sessions','reviews','materials','events','notes','replacement','mistakes','settings','examScopes','integration']) then
   raise exception 'Campo de planejamento inválido.' using errcode='22023'; end if;
 end loop;
 for field in select unnest(array['tasks','sessions','reviews','materials','events','notes','replacement','mistakes']) loop
  if jsonb_typeof(new_payload->field) is distinct from 'array' then raise exception 'Lista ausente ou inválida.' using errcode='22023'; end if;
 end loop;
 for field in select unnest(array['settings','examScopes','integration']) loop
  if jsonb_typeof(new_payload->field) is distinct from 'object' then raise exception 'Objeto ausente ou inválido.' using errcode='22023'; end if;
 end loop;
 perform pg_advisory_xact_lock(hashtextextended('planejamento:'||owner::text,0));
 select * into current_row from public.planejamento_documents where user_id=owner for update;
 if coalesce(current_row.revision,0)<>expected_revision then
  raise exception 'Os registros mudaram em outro dispositivo. Atualize antes de salvar.' using errcode='PT409'; end if;
 if current_row.user_id is not null and current_row.payload=new_payload then
  return jsonb_build_object('revision',current_row.revision,'schema_version',1,'payload',current_row.payload); end if;
 insert into public.planejamento_documents(user_id,revision,payload)
 values(owner,expected_revision+1,new_payload)
 on conflict (user_id) do update set revision=excluded.revision,payload=excluded.payload,updated_at=now()
 returning * into current_row;
 return jsonb_build_object('revision',current_row.revision,'schema_version',1,'payload',current_row.payload);
end $$;
revoke all on function public.planejamento_write(bigint,jsonb) from public,anon;
grant execute on function public.planejamento_write(bigint,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;

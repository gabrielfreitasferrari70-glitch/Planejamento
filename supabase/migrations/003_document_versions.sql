-- Version history for planejamento_documents.
-- Stores previous versions on each write, keeping up to 20 versions per user.
begin;

create table if not exists public.planejamento_document_versions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revision bigint not null,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  saved_at timestamptz not null default now()
);

create index if not exists planejamento_document_versions_user_saved_idx
  on public.planejamento_document_versions(user_id, saved_at desc);

alter table public.planejamento_document_versions enable row level security;
revoke all on public.planejamento_document_versions from public, anon, authenticated;
grant select on public.planejamento_document_versions to authenticated;

drop policy if exists planejamento_versions_read_own on public.planejamento_document_versions;
create policy planejamento_versions_read_own on public.planejamento_document_versions
  for select to authenticated
  using (auth.uid() = user_id and public.planejamento_is_approved());

-- Update planejamento_write to archive the current version before updating
create or replace function public.planejamento_write(expected_revision bigint, new_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner uuid := auth.uid();
  current_row public.planejamento_documents;
  field text;
begin
  if owner is null then raise exception 'Entre na sua conta.' using errcode='42501'; end if;
  if not public.planejamento_is_approved() then raise exception 'Sua conta aguarda aprovação do administrador.' using errcode='42501'; end if;
  if expected_revision is null or expected_revision < 0 then raise exception 'Revisão inválida.' using errcode='22023'; end if;
  if jsonb_typeof(new_payload) is distinct from 'object' or octet_length(new_payload::text) > 1500000 then
    raise exception 'Dados inválidos ou acima de 1,5 MB.' using errcode='22023';
  end if;
  for field in select jsonb_object_keys(new_payload) loop
    if not field = any(array['tasks','sessions','reviews','materials','events','notes','replacement','mistakes','settings','examScopes','integration']) then
      raise exception 'Campo de planejamento inválido.' using errcode='22023';
    end if;
  end loop;
  for field in select unnest(array['tasks','sessions','reviews','materials','events','notes','replacement','mistakes']) loop
    if jsonb_typeof(new_payload->field) is distinct from 'array' then raise exception 'Lista ausente ou inválida.' using errcode='22023'; end if;
  end loop;
  for field in select unnest(array['settings','examScopes','integration']) loop
    if jsonb_typeof(new_payload->field) is distinct from 'object' then raise exception 'Objeto ausente ou inválido.' using errcode='22023'; end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended('planejamento:' || owner::text, 0));
  select * into current_row from public.planejamento_documents where user_id = owner for update;

  if coalesce(current_row.revision, 0) <> expected_revision then
    raise exception 'Os registros mudaram em outro dispositivo. Atualize antes de salvar.' using errcode='PT409';
  end if;

  if current_row.user_id is not null and current_row.payload = new_payload then
    return jsonb_build_object('revision', current_row.revision, 'schema_version', 1, 'payload', current_row.payload);
  end if;

  -- Archive previous version if one exists
  if current_row.user_id is not null then
    insert into public.planejamento_document_versions(user_id, revision, payload, saved_at)
    values(owner, current_row.revision, current_row.payload, current_row.updated_at);

    delete from public.planejamento_document_versions
    where id in (
      select id from public.planejamento_document_versions
      where user_id = owner
      order by saved_at desc, id desc
      offset 20
    );
  end if;

  insert into public.planejamento_documents(user_id, revision, payload)
  values(owner, expected_revision + 1, new_payload)
  on conflict (user_id) do update set revision = excluded.revision, payload = excluded.payload, updated_at = now()
  returning * into current_row;

  return jsonb_build_object('revision', current_row.revision, 'schema_version', 1, 'payload', current_row.payload);
end $$;

revoke all on function public.planejamento_write(bigint, jsonb) from public, anon;
grant execute on function public.planejamento_write(bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;

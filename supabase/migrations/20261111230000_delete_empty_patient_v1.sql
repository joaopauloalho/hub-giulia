-- Exclusão definitiva somente de cadastro sem histórico: nunca deixar
-- as FKs ON DELETE CASCADE / SET NULL apagar dados de pacientes reais.
create or replace function public.delete_empty_patient_v1(p_patient_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_patient public.patients%rowtype;
  v_reference record;
  v_has_reference boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  -- O lock impede que um vínculo com FK seja criado durante a exclusão.
  select p.* into v_patient
  from public.patients p
  where p.id = p_patient_id and p.user_id = v_uid
  for update;

  if not found then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Observações e fotos de perfil também são dados do prontuário.
  if nullif(btrim(coalesce(v_patient.notes, '')), '') is not null
     or nullif(btrim(coalesce(v_patient.photo_url, '')), '') is not null then
    raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode = 'P0001';
  end if;

  -- Verifica TODAS as FKs que apontam para patients.id, inclusive
  -- CASCADE, SET NULL, referências compostas e encaminhamentos.
  -- Novas FKs serão protegidas automaticamente.
  for v_reference in
    select distinct
      child_ns.nspname as schema_name,
      child.relname as table_name,
      child_col.attname as column_name
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class child on child.oid = fk.conrelid
    join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
    join pg_catalog.pg_attribute patient_pk
      on patient_pk.attrelid = fk.confrelid and patient_pk.attname = 'id'
    join pg_catalog.pg_attribute child_col
      on child_col.attrelid = fk.conrelid
      and child_col.attnum = fk.conkey[array_position(fk.confkey, patient_pk.attnum)]
    where fk.contype = 'f'
      and fk.confrelid = 'public.patients'::pg_catalog.regclass
      and array_position(fk.confkey, patient_pk.attnum) is not null
  loop
    execute format(
      'select exists (select 1 from %I.%I where %I = $1)',
      v_reference.schema_name,
      v_reference.table_name,
      v_reference.column_name
    ) into v_has_reference using p_patient_id;

    if v_has_reference then
      raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode = 'P0001';
    end if;
  end loop;

  -- Histórico de edições clínicas usa snapshot, sem FK intencional.
  if exists (
    select 1 from public.procedure_edit_events e
    where e.patient_id_snapshot = p_patient_id
  ) then
    raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode = 'P0001';
  end if;

  delete from public.patients p
  where p.id = p_patient_id and p.user_id = v_uid;

  if not found then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_empty_patient_v1(uuid) from public, anon, authenticated;
grant execute on function public.delete_empty_patient_v1(uuid) to authenticated;

comment on function public.delete_empty_patient_v1(uuid)
is 'Exclui apenas cadastro próprio sem referências clínicas, comerciais ou financeiras; histórico permanece protegido.';

CREATE OR REPLACE FUNCTION public.delete_empty_patient_v1(p_patient_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_patient public.patients%rowtype;
  v_reference record;
  v_version record;
  v_has_reference boolean;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  select p.* into v_patient
  from public.patients p
  where p.id = p_patient_id and p.user_id = v_uid
  for update;
  if not found then
    raise exception 'PATIENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Fotos/observações avulsas do cadastro merecem revisão manual.
  if nullif(btrim(coalesce(v_patient.notes, '')), '') is not null
     or nullif(btrim(coalesce(v_patient.photo_url, '')), '') is not null then
    raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode = 'P0001';
  end if;

  -- Assinaturas digitais são imutáveis e devem ser preservadas.
  if exists (
    select 1 from public.anamnesis_signatures s
    where s.patient_id = p_patient_id
  ) then
    raise exception 'PATIENT_HAS_SIGNED_ANAMNESIS' using errcode = 'P0001';
  end if;

  -- Defense in depth: nunca remover dados de outro usuário,
  -- mesmo se houver um vínculo incorreto no banco.
  if exists (select 1 from public.anamnesis a where a.patient_id=p_patient_id and a.user_id is distinct from v_uid)
     or exists (select 1 from public.anamnesis_versions v where v.patient_id=p_patient_id and v.user_id is distinct from v_uid)
     or exists (select 1 from public.anamnesis_signature_links l where l.patient_id=p_patient_id and l.user_id is distinct from v_uid) then
    raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode='P0001';
  end if;

  -- Rascunhos de injetáveis sem vínculo clínico podem ser descartados.
  -- Bloquear os mapas e aplicações antes de verificar o estado; a FK do
  -- paciente já está protegida pelo FOR UPDATE acima.
  perform m.id from public.injectable_maps m
  where m.patient_id = p_patient_id
  order by m.id for update;
  perform a.id from public.injectable_applications a
  join public.injectable_maps m on m.id = a.map_id
  where m.patient_id = p_patient_id
  order by a.id for update of a;

  delete from public.injectable_maps m
  where m.patient_id = p_patient_id and m.user_id = v_uid
    and m.status = 'draft' and m.source_type = 'v2'
    and m.procedure_id is null and m.finalized_at is null
    and m.voided_at is null and m.finalization_key is null
    and not exists (
      select 1 from public.injectable_record_edits e where e.map_id = m.id
    )
    and not exists (
      select 1 from public.injectable_applications a
      where a.map_id = m.id and (
        a.user_id is distinct from v_uid or a.procedure_item_id is not null
        or nullif(btrim(coalesce(a.label_photo_path, '')), '') is not null
      )
    )
    and not exists (
      select 1 from public.injectable_application_points pt
      where pt.map_id = m.id and pt.user_id is distinct from v_uid
    );
  -- As FKs compostas CASCADE removem aplicações e pontos do rascunho.
  -- Qualquer mapa não elegível permanece e é bloqueado pela checagem geral.
  -- Se outro vínculo bloquear a exclusão, toda a operação é revertida.

  -- Proteger tudo que referencia patients.id, mesmo FKs CASCADE e SET NULL.
  -- A exceção é o conjunto de tabelas da anamnese, apagado transacionalmente
  -- abaixo. Qualquer nova tabela vinculada passa a ser protegida por padrão.
  for v_reference in
    select distinct
      child_ns.nspname as schema_name,
      child.relname as table_name,
      child_col.attname as column_name
    from pg_catalog.pg_constraint fk
    join pg_catalog.pg_class child on child.oid = fk.conrelid
    join pg_catalog.pg_namespace child_ns on child_ns.oid = child.relnamespace
    join pg_catalog.pg_attribute patient_pk
      on patient_pk.attrelid=fk.confrelid and patient_pk.attname='id'
    join pg_catalog.pg_attribute child_col
      on child_col.attrelid=fk.conrelid
      and child_col.attnum=fk.conkey[array_position(fk.confkey, patient_pk.attnum)]
    where fk.contype='f'
      and fk.confrelid='public.patients'::pg_catalog.regclass
      and array_position(fk.confkey, patient_pk.attnum) is not null
  loop
    if v_reference.schema_name = 'public'
       and v_reference.column_name='patient_id'
       and v_reference.table_name in (
         'anamnesis', 'anamnesis_versions', 'anamnesis_signature_links'
       ) then
      continue;
    end if;

    execute format(
      'select exists(select 1 from %I.%I where %I = $1)',
      v_reference.schema_name, v_reference.table_name, v_reference.column_name
    ) into v_has_reference using p_patient_id;

    if v_has_reference then
      raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode='P0001';
    end if;
  end loop;

  -- Histórico de edições clínicas não tem FK intencional.
  if exists (
    select 1 from public.procedure_edit_events e
    where e.patient_id_snapshot=p_patient_id
  ) then
    raise exception 'PATIENT_HAS_RELATED_RECORDS' using errcode='P0001';
  end if;

  -- Checar que não há assinatura também por vínculo de versão (integridade).
  if exists (
    select 1
    from public.anamnesis_signatures s
    join public.anamnesis_versions v on v.id = s.anamnesis_version_id
    where v.patient_id=p_patient_id
  ) then
    raise exception 'PATIENT_HAS_SIGNED_ANAMNESIS' using errcode='P0001';
  end if;

  -- Revoga tokens e links não assinados antes de apagar versões.
  delete from public.anamnesis_signature_links l
  where l.patient_id=p_patient_id and l.user_id=v_uid;

  -- O campo supersedes_version_id aponta para versões anteriores por uma
  -- FK RESTRICT; remover da maior versão para a menor respeita essa cadeia.
  for v_version in
    select v.id from public.anamnesis_versions v
    where v.patient_id=p_patient_id and v.user_id=v_uid
    order by v.version_number desc, v.created_at desc
  loop
    delete from public.anamnesis_versions v where v.id=v_version.id;
  end loop;

  -- Tanto rascunhos quanto anamneses finalizadas ficam removíveis,
  -- desde que não haja assinatura, atendimento ou financeiro vinculados.
  delete from public.anamnesis a
  where a.patient_id=p_patient_id and a.user_id=v_uid;

  delete from public.patients p
  where p.id=p_patient_id and p.user_id=v_uid;
  if not found then
    raise exception 'PATIENT_NOT_FOUND' using errcode='P0002';
  end if;
end;
$function$;

revoke all on function public.delete_empty_patient_v1(uuid) from public, anon;
grant execute on function public.delete_empty_patient_v1(uuid) to authenticated, service_role;

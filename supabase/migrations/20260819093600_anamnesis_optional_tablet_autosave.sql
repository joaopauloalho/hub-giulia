-- Hub Giulia 4.3 — Anamnese opcional, tablet-first e remoção de Última LP.
-- Preserva versões históricas imutáveis e remove somente a obrigatoriedade de conclusão futura.

create or replace function public.anamnesis_assert_v3_complete(
  p_conditions jsonb,
  p_medications text,
  p_medications_status text,
  p_surgical_history jsonb,
  p_habits jsonb,
  p_aesthetics jsonb
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Compatibilidade: a função continua existindo, mas a partir do Hub 4.3
  -- nenhuma resposta clínica é obrigatória para concluir a anamnese.
  return;
end;
$$;

revoke all on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb)
from public, anon, authenticated;
grant execute on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb)
to service_role;

create or replace function public.anamnesis_form_schema_snapshot_v4()
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select public.anamnesis_form_schema_snapshot_v3() as doc
  ), sections as (
    select
      s.ordinality,
      case
        when s.section ->> 'key' = 'skin_review' then
          jsonb_set(
            s.section,
            '{fields}',
            coalesce((
              select jsonb_agg(f.item order by f.ordinality)
              from jsonb_array_elements(s.section -> 'fields') with ordinality as f(item, ordinality)
              where f.item ->> 'key' <> 'ultima_limpeza_pele'
            ), '[]'::jsonb),
            false
          )
        else s.section
      end as section
    from base
    cross join lateral jsonb_array_elements(base.doc -> 'sections') with ordinality as s(section, ordinality)
  )
  select jsonb_set(
    jsonb_set(base.doc, '{version}', to_jsonb(4), false),
    '{sections}',
    coalesce((select jsonb_agg(sections.section order by sections.ordinality) from sections), '[]'::jsonb),
    false
  )
  from base;
$$;

revoke all on function public.anamnesis_form_schema_snapshot_v4() from public;
grant execute on function public.anamnesis_form_schema_snapshot_v4() to authenticated, service_role;

create or replace function public.finalize_anamnesis_v2(p_patient_id uuid, p_expected_revision bigint, p_idempotency_key uuid)
returns table(version_id uuid, version_number integer, completed_at timestamptz, draft_revision bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.anamnesis%rowtype;
  v_existing public.anamnesis_versions%rowtype;
  v_version public.anamnesis_versions%rowtype;
  v_supersedes uuid;
  v_next_version integer;
  v_schema jsonb;
begin
  if v_uid is null then raise exception 'ANAMNESIS_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'ANAMNESIS_IDEMPOTENCY_REQUIRED'; end if;
  if not exists (select 1 from public.patients p where p.id=p_patient_id and p.user_id=v_uid) then
    raise exception 'ANAMNESIS_PATIENT_NOT_FOUND';
  end if;

  select * into v_row from public.anamnesis a
  where a.patient_id=p_patient_id and a.user_id=v_uid for update;
  if not found then raise exception 'ANAMNESIS_DRAFT_NOT_FOUND'; end if;

  select * into v_existing from public.anamnesis_versions v
  where v.anamnesis_id=v_row.id and v.idempotency_key=p_idempotency_key;
  if found then
    return query select v_existing.id,v_existing.version_number,v_existing.completed_at,v_row.draft_revision;
    return;
  end if;

  if p_expected_revision is null or v_row.draft_revision<>p_expected_revision then
    raise exception 'ANAMNESIS_REVISION_CONFLICT';
  end if;

  -- Hub 4.3: conclusão não valida obrigatoriedade de respostas.
  if v_row.form_schema_version >= 4 then
    v_schema := public.anamnesis_form_schema_snapshot_v4();
  elsif v_row.form_schema_version >= 3 then
    v_schema := public.anamnesis_form_schema_snapshot_v3();
  else
    v_schema := public.anamnesis_form_schema_snapshot_v2(v_row.form_schema_version);
  end if;

  select v.id into v_supersedes from public.anamnesis_versions v
  where v.anamnesis_id=v_row.id order by v.version_number desc limit 1;
  v_next_version := v_row.latest_version_number + 1;

  insert into public.anamnesis_versions(
    anamnesis_id,user_id,patient_id,version_number,form_schema_version,
    answers_snapshot,form_schema_snapshot,completed_at,author_user_id,
    source_type,migration_source,supersedes_version_id,idempotency_key
  ) values (
    v_row.id,v_uid,p_patient_id,v_next_version,v_row.form_schema_version,
    jsonb_build_object(
      'conditions',v_row.conditions,'medications',v_row.medications,'medications_status',v_row.medications_status,
      'allergies',v_row.allergies,'allergies_status',v_row.allergies_status,
      'surgical_history',v_row.surgical_history,'habits',v_row.habits,
      'aesthetics',case when v_row.form_schema_version >= 4 then v_row.aesthetics - 'ultima_limpeza_pele' else v_row.aesthetics end
    ),
    v_schema,now(),v_uid,'professional',null,v_supersedes,p_idempotency_key
  ) returning * into v_version;

  update public.anamnesis a set
    status='completed',finalized_at=v_version.completed_at,latest_version_number=v_next_version,
    draft_revision=a.draft_revision+1,last_saved_at=v_version.completed_at,updated_at=v_version.completed_at
  where a.id=v_row.id returning * into v_row;

  return query select v_version.id,v_version.version_number,v_version.completed_at,v_row.draft_revision;
end;
$$;

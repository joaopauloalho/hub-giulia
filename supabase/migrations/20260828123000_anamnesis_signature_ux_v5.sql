-- Hub Giulia 5.0 — Anamnese signature UX + recipient verification + intolerance schema.
-- Additive migration only. Historical snapshots and legacy signature links remain valid.

alter table public.anamnesis_signature_links
  add column if not exists delivery_mode text not null default 'legacy',
  add column if not exists verification_attempts integer not null default 0,
  add column if not exists verification_locked_until timestamptz;

do $$ begin
  alter table public.anamnesis_signature_links
    add constraint anamnesis_signature_links_delivery_mode_check
    check (delivery_mode in ('legacy','in_person','remote'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.anamnesis_signature_links
    add constraint anamnesis_signature_links_verification_attempts_check
    check (verification_attempts between 0 and 5);
exception when duplicate_object then null; end $$;

comment on column public.anamnesis_signature_links.delivery_mode is
  'legacy keeps pre-v5 bearer links compatible; in_person is clinic handoff; remote requires recipient verification.';
comment on column public.anamnesis_signature_links.verification_attempts is
  'Failed recipient-verification attempts for remote links. No verification secret is persisted.';

create or replace function public.anamnesis_form_schema_snapshot_v5()
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select public.anamnesis_form_schema_snapshot_v4() as doc
  ), existing as (
    select (s.ordinality * 2)::bigint as sort_key, s.section
    from base
    cross join lateral jsonb_array_elements(base.doc -> 'sections') with ordinality as s(section, ordinality)
  ), injected as (
    select
      (existing.sort_key + 1)::bigint as sort_key,
      jsonb_build_object(
        'key','intolerances',
        'title','Intolerâncias e restrições alimentares',
        'fields',jsonb_build_array(
          jsonb_build_object('key','intolerancia_lactose','label','Intolerância à lactose?','type','boolean_detail','detail_key','intolerancia_lactose_detalhe'),
          jsonb_build_object('key','doenca_celiaca_sensibilidade_gluten','label','Doença celíaca ou sensibilidade ao glúten?','type','boolean_detail','detail_key','doenca_celiaca_sensibilidade_gluten_detalhe'),
          jsonb_build_object('key','outras_intolerancias_restricoes','label','Outra intolerância ou restrição alimentar?','type','boolean_detail','detail_key','outras_intolerancias_restricoes_detalhe')
        )
      ) as section
    from existing
    where existing.section ->> 'key' = 'allergies'
  ), combined as (
    select * from existing
    union all
    select * from injected
  )
  select jsonb_set(
    jsonb_set(base.doc, '{version}', to_jsonb(5), false),
    '{sections}',
    coalesce((select jsonb_agg(combined.section order by combined.sort_key) from combined), '[]'::jsonb),
    false
  )
  from base;
$$;

revoke all on function public.anamnesis_form_schema_snapshot_v5() from public;
grant execute on function public.anamnesis_form_schema_snapshot_v5() to authenticated, service_role;

-- Promote current tablet/editor clients that still announce schema 4 to schema 5 server-side.
-- This keeps deployment backwards-compatible while making the stored schema explicit and authoritative.
create or replace function public.save_anamnesis_draft_v2(
  p_patient_id uuid,
  p_expected_revision bigint,
  p_answers jsonb,
  p_form_schema_version integer default 2
)
returns table (
  id uuid,
  draft_revision bigint,
  last_saved_at timestamptz,
  status text,
  latest_version_number integer,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.anamnesis%rowtype;
  v_medications_status text;
  v_allergies_status text;
  v_schema_version integer := case when coalesce(p_form_schema_version, 2) >= 4 then 5 else greatest(coalesce(p_form_schema_version, 2), 2) end;
begin
  if v_uid is null then raise exception 'ANAMNESIS_SESSION_REQUIRED'; end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.user_id = v_uid
  ) then
    raise exception 'ANAMNESIS_PATIENT_NOT_FOUND';
  end if;

  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'ANAMNESIS_INVALID_ANSWERS';
  end if;

  if p_answers ? 'conditions' and p_answers->'conditions' <> 'null'::jsonb
     and jsonb_typeof(p_answers->'conditions') <> 'object' then
    raise exception 'ANAMNESIS_INVALID_CONDITIONS';
  end if;
  if p_answers ? 'surgical_history' and p_answers->'surgical_history' <> 'null'::jsonb
     and jsonb_typeof(p_answers->'surgical_history') <> 'object' then
    raise exception 'ANAMNESIS_INVALID_SURGICAL_HISTORY';
  end if;
  if p_answers ? 'habits' and p_answers->'habits' <> 'null'::jsonb
     and jsonb_typeof(p_answers->'habits') <> 'object' then
    raise exception 'ANAMNESIS_INVALID_HABITS';
  end if;
  if p_answers ? 'aesthetics' and p_answers->'aesthetics' <> 'null'::jsonb
     and jsonb_typeof(p_answers->'aesthetics') <> 'object' then
    raise exception 'ANAMNESIS_INVALID_AESTHETICS';
  end if;

  v_medications_status := nullif(p_answers->>'medications_status', '');
  v_allergies_status := nullif(p_answers->>'allergies_status', '');
  if v_medications_status is not null and v_medications_status not in ('reported','none') then
    raise exception 'ANAMNESIS_INVALID_MEDICATIONS_STATUS';
  end if;
  if v_allergies_status is not null and v_allergies_status not in ('reported','none') then
    raise exception 'ANAMNESIS_INVALID_ALLERGIES_STATUS';
  end if;

  select * into v_row
  from public.anamnesis a
  where a.patient_id = p_patient_id and a.user_id = v_uid
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then raise exception 'ANAMNESIS_REVISION_CONFLICT'; end if;

    insert into public.anamnesis (
      patient_id, user_id, conditions, medications, medications_status,
      allergies, allergies_status, surgical_history, habits, aesthetics,
      status, form_schema_version, draft_revision, last_saved_at, updated_at
    ) values (
      p_patient_id,
      v_uid,
      case when jsonb_typeof(p_answers->'conditions') = 'object' then p_answers->'conditions' else '{}'::jsonb end,
      p_answers->>'medications',
      v_medications_status,
      p_answers->>'allergies',
      v_allergies_status,
      case when jsonb_typeof(p_answers->'surgical_history') = 'object' then p_answers->'surgical_history' else '{}'::jsonb end,
      case when jsonb_typeof(p_answers->'habits') = 'object' then p_answers->'habits' else '{}'::jsonb end,
      case when jsonb_typeof(p_answers->'aesthetics') = 'object' then p_answers->'aesthetics' else '{}'::jsonb end,
      'draft',
      v_schema_version,
      1,
      now(),
      now()
    ) returning * into v_row;
  else
    if p_expected_revision is null or v_row.draft_revision <> p_expected_revision then
      raise exception 'ANAMNESIS_REVISION_CONFLICT';
    end if;

    update public.anamnesis a
    set
      conditions = case when jsonb_typeof(p_answers->'conditions') = 'object' then p_answers->'conditions' else '{}'::jsonb end,
      medications = p_answers->>'medications',
      medications_status = v_medications_status,
      allergies = p_answers->>'allergies',
      allergies_status = v_allergies_status,
      surgical_history = case when jsonb_typeof(p_answers->'surgical_history') = 'object' then p_answers->'surgical_history' else '{}'::jsonb end,
      habits = case when jsonb_typeof(p_answers->'habits') = 'object' then p_answers->'habits' else '{}'::jsonb end,
      aesthetics = case when jsonb_typeof(p_answers->'aesthetics') = 'object' then p_answers->'aesthetics' else '{}'::jsonb end,
      status = 'draft',
      form_schema_version = v_schema_version,
      draft_revision = a.draft_revision + 1,
      last_saved_at = now(),
      updated_at = now()
    where a.id = v_row.id
    returning * into v_row;
  end if;

  return query
  select v_row.id, v_row.draft_revision, v_row.last_saved_at, v_row.status, v_row.latest_version_number, v_row.updated_at;
end;
$$;

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

  if p_expected_revision is null or v_row.draft_revision <> p_expected_revision then
    raise exception 'ANAMNESIS_REVISION_CONFLICT';
  end if;

  if v_row.form_schema_version >= 5 then
    v_schema := public.anamnesis_form_schema_snapshot_v5();
  elsif v_row.form_schema_version >= 4 then
    v_schema := public.anamnesis_form_schema_snapshot_v4();
  else v_row.form_schema_version >= 3 then
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

-- Hub Giulia 2.1 — Anamnese 2.0
-- Backward-compatible hardening, drafts, immutable completed versions and Patient 360 v2 read models.

do $$
begin
  if exists (
    select 1
    from public.anamnesis
    group by user_id, patient_id
    having count(*) > 1
  ) then
    raise exception 'ANAMNESIS_V2_DUPLICATE_CURRENT_ROWS';
  end if;
end
$$;

alter table public.anamnesis
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists status text not null default 'draft',
  add column if not exists form_schema_version integer not null default 2,
  add column if not exists draft_revision bigint not null default 0,
  add column if not exists last_saved_at timestamptz,
  add column if not exists finalized_at timestamptz,
  add column if not exists latest_version_number integer not null default 0,
  add column if not exists medications_status text,
  add column if not exists allergies_status text;

update public.anamnesis
set
  created_at = updated_at,
  status = 'completed',
  form_schema_version = 1,
  draft_revision = greatest(draft_revision, 1),
  last_saved_at = coalesce(last_saved_at, updated_at),
  finalized_at = coalesce(finalized_at, updated_at),
  latest_version_number = greatest(latest_version_number, 1)
where latest_version_number = 0;

alter table public.anamnesis
  drop constraint if exists anamnesis_status_check,
  add constraint anamnesis_status_check check (status in ('draft', 'completed')),
  drop constraint if exists anamnesis_form_schema_version_check,
  add constraint anamnesis_form_schema_version_check check (form_schema_version > 0),
  drop constraint if exists anamnesis_draft_revision_check,
  add constraint anamnesis_draft_revision_check check (draft_revision >= 0),
  drop constraint if exists anamnesis_latest_version_number_check,
  add constraint anamnesis_latest_version_number_check check (latest_version_number >= 0),
  drop constraint if exists anamnesis_medications_status_check,
  add constraint anamnesis_medications_status_check check (medications_status is null or medications_status in ('reported', 'none')),
  drop constraint if exists anamnesis_allergies_status_check,
  add constraint anamnesis_allergies_status_check check (allergies_status is null or allergies_status in ('reported', 'none'));

alter table public.anamnesis
  drop constraint if exists anamnesis_patient_id_fkey;

alter table public.anamnesis
  drop constraint if exists anamnesis_patient_owner_fkey;

alter table public.anamnesis
  add constraint anamnesis_patient_owner_fkey
  foreign key (patient_id, user_id)
  references public.patients(id, user_id)
  on delete restrict;

drop index if exists public.anamnesis_user_patient_updated_idx;
create unique index if not exists anamnesis_patient_user_uidx
  on public.anamnesis(patient_id, user_id);

create table if not exists public.anamnesis_versions (
  id uuid primary key default gen_random_uuid(),
  anamnesis_id uuid not null,
  user_id uuid not null,
  patient_id uuid not null,
  version_number integer not null,
  form_schema_version integer not null,
  answers_snapshot jsonb not null,
  form_schema_snapshot jsonb not null,
  completed_at timestamptz not null,
  author_user_id uuid,
  source_type text,
  migration_source text,
  supersedes_version_id uuid,
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  constraint anamnesis_versions_version_number_check check (version_number > 0),
  constraint anamnesis_versions_form_schema_version_check check (form_schema_version > 0),
  constraint anamnesis_versions_answers_object_check check (jsonb_typeof(answers_snapshot) = 'object'),
  constraint anamnesis_versions_schema_object_check check (jsonb_typeof(form_schema_snapshot) = 'object'),
  constraint anamnesis_versions_source_type_check check (source_type is null or source_type in ('professional', 'patient', 'companion')),
  constraint anamnesis_versions_migration_source_check check (migration_source is null or migration_source = 'legacy'),
  constraint anamnesis_versions_anamnesis_fkey foreign key (anamnesis_id) references public.anamnesis(id) on delete restrict,
  constraint anamnesis_versions_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id) on delete restrict,
  constraint anamnesis_versions_author_fkey foreign key (author_user_id) references auth.users(id) on delete set null,
  constraint anamnesis_versions_supersedes_fkey foreign key (supersedes_version_id) references public.anamnesis_versions(id) on delete restrict,
  constraint anamnesis_versions_anamnesis_version_uidx unique (anamnesis_id, version_number),
  constraint anamnesis_versions_idempotency_uidx unique (anamnesis_id, idempotency_key)
);

create index if not exists anamnesis_versions_patient_completed_idx
  on public.anamnesis_versions(patient_id, user_id, completed_at desc, version_number desc);

create or replace function public.anamnesis_form_schema_snapshot_v2(p_version integer)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'version', p_version,
    'sections', jsonb_build_array(
      jsonb_build_object('key','conditions','title','Condições de Saúde','fields',jsonb_build_array(
        jsonb_build_object('key','hipertensao','label','Hipertensão','type','boolean'),
        jsonb_build_object('key','hipotensao','label','Hipotensão','type','boolean'),
        jsonb_build_object('key','diabetes','label','Diabetes','type','boolean'),
        jsonb_build_object('key','cancer','label','Câncer','type','boolean'),
        jsonb_build_object('key','problemas_cardiacos','label','Problemas cardíacos','type','boolean'),
        jsonb_build_object('key','disfuncao_renal','label','Disfunção renal','type','boolean'),
        jsonb_build_object('key','problemas_vasculares','label','Problemas vasculares','type','boolean'),
        jsonb_build_object('key','epilepsia','label','Epilepsia','type','boolean'),
        jsonb_build_object('key','problemas_respiratorios','label','Problemas respiratórios','type','boolean'),
        jsonb_build_object('key','problemas_tireoide','label','Problemas de tireoide','type','boolean'),
        jsonb_build_object('key','problemas_coagulacao','label','Problemas de coagulação','type','boolean'),
        jsonb_build_object('key','marcapasso','label','Marcapasso','type','boolean'),
        jsonb_build_object('key','fumante','label','Fumante','type','boolean'),
        jsonb_build_object('key','hiv_aids','label','HIV/AIDS','type','boolean'),
        jsonb_build_object('key','hepatite','label','Hepatite','type','boolean')
      )),
      jsonb_build_object('key','medications_allergies','title','Medicamentos e Alergias','fields',jsonb_build_array(
        jsonb_build_object('key','medications','label','Medicamentos em uso','type',case when p_version >= 2 then 'status_text' else 'text_legacy' end),
        jsonb_build_object('key','allergies','label','Alergias conhecidas','type',case when p_version >= 2 then 'status_text' else 'text_legacy' end)
      )),
      jsonb_build_object('key','medical_history','title','Histórico Médico','fields',jsonb_build_array(
        jsonb_build_object('key','cirurgias_recentes','label','Cirurgias recentes','type','boolean_detail','detail_key','cirurgias_recentes_detalhe'),
        jsonb_build_object('key','protese_metalica','label','Prótese metálica','type','boolean_detail','detail_key','protese_metalica_regiao'),
        jsonb_build_object('key','desmaios','label','Desmaios/convulsões','type','boolean_detail','detail_key','desmaio_porque'),
        jsonb_build_object('key','herpes','label','Herpes','type','boolean_detail','detail_key','herpes_detalhe'),
        jsonb_build_object('key','alergia_anestesia','label','Alergia a anestesia','type','boolean_detail','detail_key','alergia_anestesia_detalhe'),
        jsonb_build_object('key','alergia_abelha','label','Alergia a abelha/insetos','type','boolean_detail','detail_key','alergia_abelha_detalhe'),
        jsonb_build_object('key','tratamento_medico','label','Em tratamento médico','type','boolean_detail','detail_key','tratamento_medico_detalhe'),
        jsonb_build_object('key','ansioso','label','Ansiedade','type','boolean'),
        jsonb_build_object('key','estressado','label','Estresse elevado','type','boolean'),
        jsonb_build_object('key','enxaqueca','label','Enxaqueca','type','boolean'),
        jsonb_build_object('key','intestino_regular','label','Intestino regular','type','boolean')
      )),
      jsonb_build_object('key','womens_health','title','Saúde Feminina','fields',jsonb_build_array(
        jsonb_build_object('key','gestante','label','Gestante?','type','choice','options',jsonb_build_array('sim','não','tentando')),
        jsonb_build_object('key','quantas_gestacoes','label','Quantas gestações?','type','text','when','gestante=sim'),
        jsonb_build_object('key','tipo_parto','label','Tipo de parto','type','text','when','gestante=sim'),
        jsonb_build_object('key','menstruacao_regular','label','Menstruação regular','type','boolean'),
        jsonb_build_object('key','metodo_contraceptivo','label','Método contraceptivo','type','text'),
        jsonb_build_object('key','tpm','label','TPM intensa','type','boolean_detail','detail_key','tpm_o_que_faz')
      )),
      jsonb_build_object('key','habits','title','Hábitos Alimentares','fields',jsonb_build_array(
        jsonb_build_object('key','refrigerante','label','Refrigerante','type','boolean'),
        jsonb_build_object('key','fast_food','label','Fast food','type','boolean'),
        jsonb_build_object('key','doces','label','Doces','type','boolean'),
        jsonb_build_object('key','frituras','label','Frituras','type','boolean'),
        jsonb_build_object('key','cigarros','label','Cigarros','type','boolean'),
        jsonb_build_object('key','bebidas_alcoolicas','label','Bebidas alcoólicas','type','boolean'),
        jsonb_build_object('key','alimentacao_especial','label','Alimentação especial / dieta','type','boolean_detail','detail_key','alimentacao_especial_qual'),
        jsonb_build_object('key','suplemento','label','Suplementação','type','boolean_detail','detail_key','suplemento_quais'),
        jsonb_build_object('key','atividade_fisica','label','Atividade física','type','boolean_detail','detail_key','atividade_fisica_detalhe'),
        jsonb_build_object('key','quantidade_agua','label','Quantidade de água por dia','type','text')
      )),
      jsonb_build_object('key','aesthetics','title','Rotina Estética','fields',jsonb_build_array(
        jsonb_build_object('key','cuidados_diarios','label','Cuidados diários em casa','type','text'),
        jsonb_build_object('key','produtos_em_uso','label','Produtos em uso no rosto','type','text'),
        jsonb_build_object('key','produto_com_acido','label','Usa produto com ácido','type','boolean_detail','detail_key','produto_com_acido_detalhe'),
        jsonb_build_object('key','limpeza_pele','label','Limpeza de pele recente','type','boolean_detail','detail_key','limpeza_pele_data'),
        jsonb_build_object('key','microagulhamento','label','Microagulhamento recente','type','boolean_detail','detail_key','microagulhamento_data'),
        jsonb_build_object('key','peeling','label','Peeling recente','type','boolean_detail','detail_key','peeling_detalhe'),
        jsonb_build_object('key','toxina_botulinica','label','Toxina botulínica','type','boolean_detail','detail_key','toxina_botulinica_data'),
        jsonb_build_object('key','fios_sustentacao','label','Fios de sustentação','type','boolean_detail','detail_key','fios_sustentacao_data'),
        jsonb_build_object('key','preenchimento_hialuronico','label','Preenchimento com ácido hialurônico','type','boolean_detail','detail_key','preenchimento_hialuronico_data'),
        jsonb_build_object('key','bioestimulador','label','Bioestimulador','type','boolean_detail','detail_key','bioestimulador_data'),
        jsonb_build_object('key','plastica_facial','label','Plástica facial','type','boolean_detail','detail_key','plastica_facial_detalhe'),
        jsonb_build_object('key','pmma','label','PMMA','type','boolean_detail','detail_key','pmma_regiao'),
        jsonb_build_object('key','outros_tratamentos','label','Outros tratamentos estéticos','type','boolean_detail','detail_key','outros_tratamentos_detalhe'),
        jsonb_build_object('key','alteracoes_recentes','label','Alterações recentes na pele','type','boolean_detail','detail_key','alteracoes_recentes_detalhe')
      ))
    )
  );
$$;

revoke all on function public.anamnesis_form_schema_snapshot_v2(integer) from public, anon, authenticated;

insert into public.anamnesis_versions (
  anamnesis_id, user_id, patient_id, version_number, form_schema_version,
  answers_snapshot, form_schema_snapshot, completed_at, author_user_id,
  source_type, migration_source, supersedes_version_id, idempotency_key, created_at
)
select
  a.id,
  a.user_id,
  a.patient_id,
  1,
  1,
  jsonb_build_object(
    'conditions', a.conditions,
    'medications', a.medications,
    'medications_status', null,
    'allergies', a.allergies,
    'allergies_status', null,
    'surgical_history', a.surgical_history,
    'habits', a.habits,
    'aesthetics', a.aesthetics
  ),
  public.anamnesis_form_schema_snapshot_v2(1),
  a.updated_at,
  null,
  null,
  'legacy',
  null,
  gen_random_uuid(),
  a.updated_at
from public.anamnesis a
where not exists (
  select 1 from public.anamnesis_versions v
  where v.anamnesis_id = a.id and v.version_number = 1
);

create or replace function public.anamnesis_guard_direct_write_v2()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if current_user = 'authenticated' then
      new.user_id := auth.uid();
      new.status := 'draft';
      new.form_schema_version := greatest(coalesce(new.form_schema_version, 2), 2);
      new.draft_revision := greatest(coalesce(new.draft_revision, 0), 1);
      new.last_saved_at := coalesce(new.last_saved_at, now());
      new.finalized_at := null;
      new.latest_version_number := 0;
      new.created_at := coalesce(new.created_at, now());
      new.updated_at := now();
    end if;
    return new;
  end if;

  if current_user = 'authenticated' then
    new.user_id := old.user_id;
    new.patient_id := old.patient_id;
    new.latest_version_number := old.latest_version_number;
    new.finalized_at := old.finalized_at;

    if new.conditions is distinct from old.conditions
      or new.medications is distinct from old.medications
      or new.medications_status is distinct from old.medications_status
      or new.allergies is distinct from old.allergies
      or new.allergies_status is distinct from old.allergies_status
      or new.surgical_history is distinct from old.surgical_history
      or new.habits is distinct from old.habits
      or new.aesthetics is distinct from old.aesthetics then
      new.status := 'draft';
      new.form_schema_version := greatest(coalesce(new.form_schema_version, 2), 2);
      new.draft_revision := old.draft_revision + 1;
      new.last_saved_at := now();
      new.updated_at := now();
    else
      new.status := old.status;
      new.form_schema_version := old.form_schema_version;
      new.draft_revision := old.draft_revision;
      new.last_saved_at := old.last_saved_at;
      new.updated_at := old.updated_at;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists anamnesis_guard_direct_write_v2 on public.anamnesis;
create trigger anamnesis_guard_direct_write_v2
before insert or update on public.anamnesis
for each row execute function public.anamnesis_guard_direct_write_v2();

alter table public.anamnesis enable row level security;
drop policy if exists anamnesis_own on public.anamnesis;
drop policy if exists anamnesis_select_own_v2 on public.anamnesis;
drop policy if exists anamnesis_insert_own_v2 on public.anamnesis;
drop policy if exists anamnesis_update_own_v2 on public.anamnesis;

create policy anamnesis_select_own_v2
on public.anamnesis
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy anamnesis_insert_own_v2
on public.anamnesis
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = (select auth.uid())
  )
);

create policy anamnesis_update_own_v2
on public.anamnesis
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.patients p
    where p.id = patient_id and p.user_id = (select auth.uid())
  )
);

revoke all on table public.anamnesis from anon, authenticated;
grant select, insert, update on table public.anamnesis to authenticated;

alter table public.anamnesis_versions enable row level security;
drop policy if exists anamnesis_versions_select_own_v2 on public.anamnesis_versions;
create policy anamnesis_versions_select_own_v2
on public.anamnesis_versions
for select
to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.anamnesis_versions from anon, authenticated;
grant select on table public.anamnesis_versions to authenticated;

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
begin
  if v_uid is null then
    raise exception 'ANAMNESIS_SESSION_REQUIRED';
  end if;

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

  select *
  into v_row
  from public.anamnesis a
  where a.patient_id = p_patient_id and a.user_id = v_uid
  for update;

  if not found then
    if coalesce(p_expected_revision, 0) <> 0 then
      raise exception 'ANAMNESIS_REVISION_CONFLICT';
    end if;

    insert into public.anamnesis (
      patient_id, user_id, conditions, medications, medications_status,
      allergies, allergies_status, surgical_history, habits, aesthetics,
      status, form_schema_version, draft_revision, last_saved_at, updated_at
    )
    values (
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
      greatest(coalesce(p_form_schema_version, 2), 2),
      1,
      now(),
      now()
    )
    returning * into v_row;
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
      form_schema_version = greatest(coalesce(p_form_schema_version, 2), 2),
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

create or replace function public.finalize_anamnesis_v2(
  p_patient_id uuid,
  p_expected_revision bigint,
  p_idempotency_key uuid
)
returns table (
  version_id uuid,
  version_number integer,
  completed_at timestamptz,
  draft_revision bigint
)
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
begin
  if v_uid is null then
    raise exception 'ANAMNESIS_SESSION_REQUIRED';
  end if;
  if p_idempotency_key is null then
    raise exception 'ANAMNESIS_IDEMPOTENCY_REQUIRED';
  end if;

  if not exists (
    select 1 from public.patients p
    where p.id = p_patient_id and p.user_id = v_uid
  ) then
    raise exception 'ANAMNESIS_PATIENT_NOT_FOUND';
  end if;

  select *
  into v_row
  from public.anamnesis a
  where a.patient_id = p_patient_id and a.user_id = v_uid
  for update;

  if not found then
    raise exception 'ANAMNESIS_DRAFT_NOT_FOUND';
  end if;

  select *
  into v_existing
  from public.anamnesis_versions v
  where v.anamnesis_id = v_row.id
    and v.idempotency_key = p_idempotency_key;

  if found then
    return query
    select v_existing.id, v_existing.version_number, v_existing.completed_at, v_row.draft_revision;
    return;
  end if;

  if p_expected_revision is null or v_row.draft_revision <> p_expected_revision then
    raise exception 'ANAMNESIS_REVISION_CONFLICT';
  end if;

  select v.id
  into v_supersedes
  from public.anamnesis_versions v
  where v.anamnesis_id = v_row.id
  order by v.version_number desc
  limit 1;

  v_next_version := v_row.latest_version_number + 1;

  insert into public.anamnesis_versions (
    anamnesis_id, user_id, patient_id, version_number, form_schema_version,
    answers_snapshot, form_schema_snapshot, completed_at, author_user_id,
    source_type, migration_source, supersedes_version_id, idempotency_key
  )
  values (
    v_row.id,
    v_uid,
    p_patient_id,
    v_next_version,
    v_row.form_schema_version,
    jsonb_build_object(
      'conditions', v_row.conditions,
      'medications', v_row.medications,
      'medications_status', v_row.medications_status,
      'allergies', v_row.allergies,
      'allergies_status', v_row.allergies_status,
      'surgical_history', v_row.surgical_history,
      'habits', v_row.habits,
      'aesthetics', v_row.aesthetics
    ),
    public.anamnesis_form_schema_snapshot_v2(v_row.form_schema_version),
    now(),
    v_uid,
    'professional',
    null,
    v_supersedes,
    p_idempotency_key
  )
  returning * into v_version;

  update public.anamnesis a
  set
    status = 'completed',
    finalized_at = v_version.completed_at,
    latest_version_number = v_next_version,
    draft_revision = a.draft_revision + 1,
    last_saved_at = v_version.completed_at,
    updated_at = v_version.completed_at
  where a.id = v_row.id
  returning * into v_row;

  return query
  select v_version.id, v_version.version_number, v_version.completed_at, v_row.draft_revision;
end;
$$;

revoke all on function public.save_anamnesis_draft_v2(uuid, bigint, jsonb, integer) from public, anon;
grant execute on function public.save_anamnesis_draft_v2(uuid, bigint, jsonb, integer) to authenticated;
revoke all on function public.finalize_anamnesis_v2(uuid, bigint, uuid) from public, anon;
grant execute on function public.finalize_anamnesis_v2(uuid, bigint, uuid) to authenticated;

create or replace function public.get_patient_360_overview_v2(p_patient_id uuid)
returns table (
  next_appointment jsonb,
  last_procedure jsonb,
  active_returns_count bigint,
  priority_return jsonb,
  financial_summary jsonb,
  open_notes_count bigint,
  overdue_notes_count bigint,
  anamnesis_summary jsonb
)
language sql
security invoker
set search_path = public
as $$
  with base as (
    select * from public.get_patient_360_overview_v1(p_patient_id)
  ),
  latest_version as (
    select v.*
    from public.anamnesis_versions v
    where v.patient_id = p_patient_id
      and v.user_id = auth.uid()
    order by v.version_number desc
    limit 1
  ),
  draft as (
    select a.*
    from public.anamnesis a
    where a.patient_id = p_patient_id
      and a.user_id = auth.uid()
    limit 1
  )
  select
    b.next_appointment,
    b.last_procedure,
    b.active_returns_count,
    b.priority_return,
    b.financial_summary,
    b.open_notes_count,
    b.overdue_notes_count,
    case
      when lv.id is null then jsonb_build_object(
        'completed', false,
        'allergies', null,
        'medications', null,
        'updated_at', null,
        'version_number', null,
        'draft_in_progress', coalesce(d.status = 'draft', false),
        'draft_saved_at', d.last_saved_at
      )
      else jsonb_build_object(
        'completed', true,
        'allergies',
          case
            when lv.answers_snapshot ? 'allergies_status'
              and lv.answers_snapshot->>'allergies_status' is not null
              then case when lv.answers_snapshot->>'allergies_status' = 'reported'
                then nullif(btrim(lv.answers_snapshot->>'allergies'), '') else null end
            else nullif(btrim(lv.answers_snapshot->>'allergies'), '')
          end,
        'medications',
          case
            when lv.answers_snapshot ? 'medications_status'
              and lv.answers_snapshot->>'medications_status' is not null
              then case when lv.answers_snapshot->>'medications_status' = 'reported'
                then nullif(btrim(lv.answers_snapshot->>'medications'), '') else null end
            else nullif(btrim(lv.answers_snapshot->>'medications'), '')
          end,
        'updated_at', lv.completed_at,
        'version_number', lv.version_number,
        'draft_in_progress', coalesce(d.status = 'draft', false),
        'draft_saved_at', d.last_saved_at
      )
    end
  from base b
  left join latest_version lv on true
  left join draft d on true;
$$;

create or replace function public.list_patient_timeline_v2(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table (
  event_key text,
  event_type text,
  occurred_at timestamptz,
  title text,
  subtitle text,
  source_id uuid,
  metadata jsonb
)
language sql
security invoker
set search_path = public
as $$
  with params as (
    select least(greatest(coalesce(p_limit, 20), 1), 49) as lim
  ),
  existing_events as (
    select e.*
    from params p
    cross join lateral public.list_patient_timeline_v1(
      p_patient_id,
      p.lim + 1,
      p_cursor_at,
      p_cursor_key
    ) e
    where e.event_type <> 'anamnesis'
  ),
  version_events as (
    select
      'anamnesis-version:' || v.id::text as event_key,
      'anamnesis'::text as event_type,
      v.completed_at as occurred_at,
      ('Anamnese concluída — versão ' || v.version_number)::text as title,
      null::text as subtitle,
      v.id as source_id,
      jsonb_build_object(
        'version_number', v.version_number,
        'form_schema_version', v.form_schema_version
      ) as metadata
    from public.anamnesis_versions v
    where v.patient_id = p_patient_id
      and v.user_id = auth.uid()
  ),
  events as (
    select * from existing_events
    union all
    select * from version_events
  )
  select e.event_key, e.event_type, e.occurred_at, e.title, e.subtitle, e.source_id, e.metadata
  from events e, params p
  where e.occurred_at is not null
    and (
      p_cursor_at is null
      or e.occurred_at < p_cursor_at
      or (e.occurred_at = p_cursor_at and e.event_key < coalesce(p_cursor_key, ''))
    )
  order by e.occurred_at desc, e.event_key desc
  limit (select lim from params);
$$;

revoke all on function public.get_patient_360_overview_v2(uuid) from public, anon;
grant execute on function public.get_patient_360_overview_v2(uuid) to authenticated;
revoke all on function public.list_patient_timeline_v2(uuid, integer, timestamptz, text) from public, anon;
grant execute on function public.list_patient_timeline_v2(uuid, integer, timestamptz, text) to authenticated;

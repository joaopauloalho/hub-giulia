-- Hub Giulia 3.9.1 / Anamnese clinical UX v3 + scoped remote signature
-- New migration only: preserves every historical v1/v2 snapshot and never fabricates answers.

create or replace function public.anamnesis_form_schema_snapshot_v3()
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'version', 3,
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
      jsonb_build_object('key','medications','title','Medicamentos','fields',jsonb_build_array(
        jsonb_build_object('key','medications','label','Faz uso contínuo de algum medicamento?','type','status_text','detail_label','Qual(is)?')
      )),
      jsonb_build_object('key','allergies','title','Alergias','fields',jsonb_build_array(
        jsonb_build_object('key','alergia_medicamento','label','Alergia a medicamento?','type','boolean_detail','detail_key','alergia_medicamento_detalhe'),
        jsonb_build_object('key','alergia_frutos_mar','label','Alergia a frutos do mar?','type','boolean_detail','detail_key','alergia_frutos_mar_detalhe'),
        jsonb_build_object('key','alergia_abelha','label','Alergia a picada de abelha/insetos?','type','boolean_detail','detail_key','alergia_abelha_detalhe'),
        jsonb_build_object('key','outras_alergias','label','Outras alergias?','type','boolean_detail','detail_key','outras_alergias_detalhe')
      )),
      jsonb_build_object('key','medical_history','title','Histórico Médico','fields',jsonb_build_array(
        jsonb_build_object('key','recebeu_anestesia','label','Já recebeu anestesia alguma vez?','type','boolean_detail','detail_key','recebeu_anestesia_detalhe','help','Incluindo anestesia odontológica.'),
        jsonb_build_object('key','cirurgias_recentes','label','Cirurgias recentes','type','boolean_detail','detail_key','cirurgias_recentes_detalhe'),
        jsonb_build_object('key','protese_metalica','label','Prótese metálica','type','boolean_detail','detail_key','protese_metalica_regiao'),
        jsonb_build_object('key','desmaios','label','Desmaios/convulsões','type','boolean_detail','detail_key','desmaio_porque'),
        jsonb_build_object('key','herpes','label','Herpes','type','boolean_detail','detail_key','herpes_detalhe'),
        jsonb_build_object('key','tratamento_medico','label','Em tratamento médico','type','boolean_detail','detail_key','tratamento_medico_detalhe'),
        jsonb_build_object('key','acne','label','Tem acne?','type','boolean_detail','detail_key','acne_detalhe'),
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
        jsonb_build_object('key','colica_menstrual','label','Tem cólica menstrual?','type','boolean_detail','detail_key','colica_menstrual_detalhe')
      )),
      jsonb_build_object('key','food','title','Alimentação','fields',jsonb_build_array(
        jsonb_build_object('key','leite_derivados','label','Leite e derivados','type','boolean_frequency','detail_key','leite_derivados_frequencia'),
        jsonb_build_object('key','doces','label','Açúcar / doces','type','boolean_frequency','detail_key','doces_frequencia'),
        jsonb_build_object('key','refrigerante','label','Refrigerante','type','boolean_frequency','detail_key','refrigerante_frequencia'),
        jsonb_build_object('key','fast_food','label','Fast food','type','boolean_frequency','detail_key','fast_food_frequencia'),
        jsonb_build_object('key','frituras','label','Frituras','type','boolean_frequency','detail_key','frituras_frequencia'),
        jsonb_build_object('key','bebidas_alcoolicas','label','Bebidas alcoólicas','type','boolean_frequency','detail_key','bebidas_alcoolicas_frequencia'),
        jsonb_build_object('key','cigarros','label','Cigarros','type','boolean'),
        jsonb_build_object('key','quantidade_agua','label','Quantidade de água por dia','type','text')
      )),
      jsonb_build_object('key','routine','title','Hábitos / Rotina','fields',jsonb_build_array(
        jsonb_build_object('key','alimentacao_especial','label','Segue alguma dieta específica?','type','boolean_detail','detail_key','alimentacao_especial_qual'),
        jsonb_build_object('key','suplemento','label','Faz uso de suplementos?','type','boolean_detail','detail_key','suplemento_quais'),
        jsonb_build_object('key','atividade_fisica','label','Pratica atividade física?','type','boolean_detail','detail_key','atividade_fisica_detalhe')
      )),
      jsonb_build_object('key','procedures','title','Procedimentos anteriores','fields',jsonb_build_array(
        jsonb_build_object('key','limpeza_pele','label','Limpeza de pele','type','procedure_note','detail_key','limpeza_pele_data'),
        jsonb_build_object('key','microagulhamento','label','Microagulhamento','type','procedure_note','detail_key','microagulhamento_data'),
        jsonb_build_object('key','peeling','label','Peeling','type','procedure_note','detail_key','peeling_detalhe'),
        jsonb_build_object('key','laser','label','Laser','type','procedure_note','detail_key','laser_detalhe'),
        jsonb_build_object('key','toxina_botulinica','label','Toxina botulínica','type','procedure_note','detail_key','toxina_botulinica_data'),
        jsonb_build_object('key','fios_sustentacao','label','Fios de sustentação','type','procedure_note','detail_key','fios_sustentacao_data'),
        jsonb_build_object('key','preenchimento_hialuronico','label','Preenchimento com ácido hialurônico','type','procedure_note','detail_key','preenchimento_hialuronico_data'),
        jsonb_build_object('key','bioestimulador','label','Bioestimulador','type','procedure_note','detail_key','bioestimulador_data'),
        jsonb_build_object('key','plastica_facial','label','Plástica facial','type','procedure_note','detail_key','plastica_facial_detalhe'),
        jsonb_build_object('key','pmma','label','PMMA','type','procedure_note','detail_key','pmma_regiao'),
        jsonb_build_object('key','outros_tratamentos','label','Outros tratamentos estéticos','type','procedure_note','detail_key','outros_tratamentos_detalhe')
      )),
      jsonb_build_object('key','skin_review','title','Pele e recomendações','fields',jsonb_build_array(
        jsonb_build_object('key','produto_com_acido','label','Usa produto com ácido?','type','boolean_detail','detail_key','produto_com_acido_detalhe'),
        jsonb_build_object('key','alteracoes_recentes','label','Alterações recentes na pele?','type','boolean_detail','detail_key','alteracoes_recentes_detalhe'),
        jsonb_build_object('key','ultima_limpeza_pele','label','Última LP / última limpeza de pele','type','text'),
        jsonb_build_object('key','pele_paciente','label','Pele da paciente','type','long_text'),
        jsonb_build_object('key','observacoes_gerais','label','Observações gerais','type','long_text'),
        jsonb_build_object('key','minhas_recomendacoes','label','Minhas recomendações','type','long_text')
      ))
    )
  );
$$;

revoke all on function public.anamnesis_form_schema_snapshot_v3() from public;
grant execute on function public.anamnesis_form_schema_snapshot_v3() to authenticated, service_role;

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
declare
  v_key text;
  v_pair text[];
begin
  foreach v_key in array array[
    'hipertensao','hipotensao','diabetes','cancer','problemas_cardiacos','disfuncao_renal',
    'problemas_vasculares','epilepsia','problemas_respiratorios','problemas_tireoide',
    'problemas_coagulacao','marcapasso','fumante','hiv_aids','hepatite'
  ] loop
    if jsonb_typeof(p_conditions -> v_key) <> 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  if p_medications_status is null or p_medications_status not in ('reported','none') then
    raise exception 'ANAMNESIS_REQUIRED_BINARY:medications';
  end if;
  if p_medications_status = 'reported' and nullif(btrim(coalesce(p_medications,'')), '') is null then
    raise exception 'ANAMNESIS_REQUIRED_DETAIL:medications';
  end if;

  foreach v_key in array array[
    'alergia_medicamento','alergia_frutos_mar','alergia_abelha','outras_alergias',
    'recebeu_anestesia','cirurgias_recentes','protese_metalica','desmaios','herpes','tratamento_medico',
    'acne','ansioso','estressado','enxaqueca','intestino_regular','menstruacao_regular','colica_menstrual'
  ] loop
    if jsonb_typeof(p_surgical_history -> v_key) <> 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  if coalesce(p_surgical_history ->> 'gestante','') not in ('sim','não','tentando') then
    raise exception 'ANAMNESIS_REQUIRED_CHOICE:gestante';
  end if;

  foreach v_pair slice 1 in array array[
    array['alergia_medicamento','alergia_medicamento_detalhe'],
    array['alergia_frutos_mar','alergia_frutos_mar_detalhe'],
    array['alergia_abelha','alergia_abelha_detalhe'],
    array['outras_alergias','outras_alergias_detalhe'],
    array['recebeu_anestesia','recebeu_anestesia_detalhe'],
    array['cirurgias_recentes','cirurgias_recentes_detalhe'],
    array['protese_metalica','protese_metalica_regiao'],
    array['desmaios','desmaio_porque'],
    array['herpes','herpes_detalhe'],
    array['tratamento_medico','tratamento_medico_detalhe'],
    array['acne','acne_detalhe'],
    array['colica_menstrual','colica_menstrual_detalhe']
  ] loop
    if p_surgical_history ->> v_pair[1] = 'true' and nullif(btrim(coalesce(p_surgical_history ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;

  foreach v_key in array array['leite_derivados','doces','refrigerante','fast_food','frituras','bebidas_alcoolicas','cigarros','alimentacao_especial','suplemento','atividade_fisica'] loop
    if jsonb_typeof(p_habits -> v_key) <> 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  foreach v_pair slice 1 in array array[
    array['leite_derivados','leite_derivados_frequencia'],
    array['doces','doces_frequencia'],
    array['refrigerante','refrigerante_frequencia'],
    array['fast_food','fast_food_frequencia'],
    array['frituras','frituras_frequencia'],
    array['bebidas_alcoolicas','bebidas_alcoolicas_frequencia'],
    array['alimentacao_especial','alimentacao_especial_qual'],
    array['suplemento','suplemento_quais'],
    array['atividade_fisica','atividade_fisica_detalhe']
  ] loop
    if p_habits ->> v_pair[1] = 'true' and nullif(btrim(coalesce(p_habits ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;

  foreach v_key in array array[
    'produto_com_acido','alteracoes_recentes','limpeza_pele','microagulhamento','peeling','laser',
    'toxina_botulinica','fios_sustentacao','preenchimento_hialuronico','bioestimulador',
    'plastica_facial','pmma','outros_tratamentos'
  ] loop
    if jsonb_typeof(p_aesthetics -> v_key) <> 'boolean' then
      raise exception 'ANAMNESIS_REQUIRED_BINARY:%', v_key;
    end if;
  end loop;

  foreach v_pair slice 1 in array array[
    array['produto_com_acido','produto_com_acido_detalhe'],
    array['alteracoes_recentes','alteracoes_recentes_detalhe'],
    array['limpeza_pele','limpeza_pele_data'],
    array['microagulhamento','microagulhamento_data'],
    array['peeling','peeling_detalhe'],
    array['laser','laser_detalhe'],
    array['toxina_botulinica','toxina_botulinica_data'],
    array['fios_sustentacao','fios_sustentacao_data'],
    array['preenchimento_hialuronico','preenchimento_hialuronico_data'],
    array['bioestimulador','bioestimulador_data'],
    array['plastica_facial','plastica_facial_detalhe'],
    array['pmma','pmma_regiao'],
    array['outros_tratamentos','outros_tratamentos_detalhe']
  ] loop
    if p_aesthetics ->> v_pair[1] = 'true' and nullif(btrim(coalesce(p_aesthetics ->> v_pair[2],'')), '') is null then
      raise exception 'ANAMNESIS_REQUIRED_DETAIL:%', v_pair[1];
    end if;
  end loop;
end;
$$;

revoke all on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.anamnesis_assert_v3_complete(jsonb,text,text,jsonb,jsonb,jsonb) to service_role;

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

  if v_row.form_schema_version >= 3 then
    perform public.anamnesis_assert_v3_complete(
      v_row.conditions,v_row.medications,v_row.medications_status,
      v_row.surgical_history,v_row.habits,v_row.aesthetics
    );
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
      'surgical_history',v_row.surgical_history,'habits',v_row.habits,'aesthetics',v_row.aesthetics
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

-- Remote signing is bound to one immutable anamnesis_versions row.
create table public.anamnesis_signature_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  anamnesis_version_id uuid not null references public.anamnesis_versions(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  consumed_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index anamnesis_signature_links_owner_version_idx on public.anamnesis_signature_links(user_id, anamnesis_version_id, created_at desc);
create index anamnesis_signature_links_patient_idx on public.anamnesis_signature_links(user_id, patient_id, created_at desc);

alter table public.anamnesis_signature_links enable row level security;
create policy anamnesis_signature_links_select_own_v1 on public.anamnesis_signature_links
for select to authenticated using (user_id = auth.uid());

create table public.anamnesis_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  patient_id uuid not null references public.patients(id) on delete cascade,
  anamnesis_version_id uuid not null unique references public.anamnesis_versions(id) on delete restrict,
  signature_path text not null,
  signature_sha256 text not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null default now(),
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index anamnesis_signatures_owner_patient_idx on public.anamnesis_signatures(user_id, patient_id, signed_at desc);
alter table public.anamnesis_signatures enable row level security;
create policy anamnesis_signatures_select_own_v1 on public.anamnesis_signatures
for select to authenticated using (user_id = auth.uid());

create or replace function public.anamnesis_signature_immutable_guard_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  raise exception 'ANAMNESIS_SIGNATURE_IMMUTABLE';
end; $$;
create trigger anamnesis_signature_immutable_v1 before update or delete on public.anamnesis_signatures
for each row execute function public.anamnesis_signature_immutable_guard_v1();

create or replace function public.anamnesis_version_content_sha256_v1(p_version_id uuid)
returns text
language sql
stable
security definer
set search_path=public,extensions,pg_temp
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'version_id',v.id,
    'version_number',v.version_number,
    'form_schema_version',v.form_schema_version,
    'answers_snapshot',v.answers_snapshot,
    'form_schema_snapshot',v.form_schema_snapshot,
    'completed_at',v.completed_at
  )::text,'UTF8'),'sha256'),'hex')
  from public.anamnesis_versions v where v.id=p_version_id;
$$;
revoke all on function public.anamnesis_version_content_sha256_v1(uuid) from public, anon, authenticated;
grant execute on function public.anamnesis_version_content_sha256_v1(uuid) to service_role;

create or replace function public.consume_anamnesis_signature_link_v1(
  p_link_id uuid,
  p_signature_path text,
  p_signature_sha256 text,
  p_audit_metadata jsonb default '{}'::jsonb
)
returns table(signature_id uuid, signed_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_link public.anamnesis_signature_links%rowtype;
  v_sig public.anamnesis_signatures%rowtype;
begin
  select * into v_link from public.anamnesis_signature_links where id=p_link_id for update;
  if not found then raise exception 'SIGNATURE_LINK_INVALID'; end if;

  select * into v_sig from public.anamnesis_signatures where anamnesis_version_id=v_link.anamnesis_version_id;
  if found then
    return query select v_sig.id,v_sig.signed_at;
    return;
  end if;

  if v_link.revoked_at is not null then raise exception 'SIGNATURE_LINK_REVOKED'; end if;
  if v_link.expires_at <= now() then raise exception 'SIGNATURE_LINK_EXPIRED'; end if;
  if v_link.consumed_at is not null then raise exception 'SIGNATURE_LINK_CONSUMED'; end if;
  if nullif(btrim(coalesce(p_signature_path,'')),'') is null or p_signature_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'SIGNATURE_ARTIFACT_INVALID';
  end if;

  insert into public.anamnesis_signatures(
    user_id,patient_id,anamnesis_version_id,signature_path,signature_sha256,content_sha256,audit_metadata
  ) values (
    v_link.user_id,v_link.patient_id,v_link.anamnesis_version_id,p_signature_path,p_signature_sha256,v_link.content_sha256,
    jsonb_strip_nulls(coalesce(p_audit_metadata,'{}'::jsonb))
  ) returning * into v_sig;

  update public.anamnesis_signature_links set consumed_at=v_sig.signed_at where id=v_link.id;
  return query select v_sig.id,v_sig.signed_at;
end;
$$;
revoke all on function public.consume_anamnesis_signature_link_v1(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.consume_anamnesis_signature_link_v1(uuid,text,text,jsonb) to service_role;

-- No anonymous grants on clinical/signature tables. Public access is exclusively through the scoped Edge Function.
revoke all on table public.anamnesis_signature_links from anon;
revoke all on table public.anamnesis_signatures from anon;

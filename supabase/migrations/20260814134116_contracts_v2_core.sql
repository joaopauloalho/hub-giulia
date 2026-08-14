-- Hub Giulia 2.2 — Contratos 2.0 / Core
-- Additive and backward-compatible with the legacy signing UI during rollout.

create table if not exists public.professional_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  display_name text not null,
  profession text,
  professional_registration text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint professional_profiles_display_name_check check (char_length(btrim(display_name)) between 1 and 160),
  constraint professional_profiles_profession_check check (profession is null or char_length(profession) <= 160),
  constraint professional_profiles_registration_check check (professional_registration is null or char_length(professional_registration) <= 160)
);

alter table public.contract_templates
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists current_version_id uuid;

create table if not exists public.contract_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  user_id uuid not null default auth.uid(),
  version_number integer not null check (version_number > 0),
  name_snapshot text not null,
  body text not null,
  variables jsonb not null default '[]'::jsonb,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint contract_template_versions_template_owner_fkey
    foreign key (template_id, user_id)
    references public.contract_templates(id, user_id)
    on delete restrict,
  constraint contract_template_versions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade,
  constraint contract_template_versions_number_key unique (template_id, version_number),
  constraint contract_template_versions_owner_key unique (id, user_id),
  constraint contract_template_versions_template_owner_key unique (id, template_id, user_id),
  constraint contract_template_versions_name_check check (char_length(btrim(name_snapshot)) between 1 and 200),
  constraint contract_template_versions_body_check check (char_length(body) between 1 and 50000),
  constraint contract_template_versions_variables_check check (jsonb_typeof(variables) = 'array')
);

create or replace function public.contract_template_variables_v2(p_body text)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(token order by token), '[]'::jsonb)
  from (
    select distinct lower(m[1]) as token
    from regexp_matches(coalesce(p_body, ''), '\{\{\s*([a-zA-Z0-9_]+)\s*\}\}', 'g') as m
  ) vars;
$$;

create or replace function public.contract_assert_template_placeholders_v2(p_body text)
returns void
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_token text;
  v_allowed constant text[] := array[
    'patient_name','patient_cpf',
    'professional_name','professional_registration','professional_profession',
    'service_name','services','total_value','procedure_date','current_date',
    'nome','cpf','profissional','servico','valor','data'
  ];
begin
  if p_body is null or char_length(btrim(p_body)) = 0 then
    raise exception 'CONTRACT_TEMPLATE_BODY_REQUIRED';
  end if;
  if char_length(p_body) > 50000 then
    raise exception 'CONTRACT_TEMPLATE_BODY_TOO_LARGE';
  end if;

  for v_token in
    select jsonb_array_elements_text(public.contract_template_variables_v2(p_body))
  loop
    if not (v_token = any(v_allowed)) then
      raise exception 'CONTRACT_TEMPLATE_UNKNOWN_PLACEHOLDER:%', v_token;
    end if;
  end loop;
end;
$$;

create or replace function public.contract_render_v2(p_body text, p_variables jsonb)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v_rendered text := p_body;
  v_match text[];
  v_token text;
  v_value text;
  v_missing text[] := array[]::text[];
begin
  perform public.contract_assert_template_placeholders_v2(p_body);

  for v_match in
    select regexp_matches(p_body, '(\{\{\s*([a-zA-Z0-9_]+)\s*\}\})', 'g')
  loop
    v_token := lower(v_match[2]);
    v_value := p_variables ->> v_token;
    if v_value is null or btrim(v_value) = '' then
      if not (v_token = any(v_missing)) then
        v_missing := array_append(v_missing, v_token);
      end if;
    else
      v_rendered := replace(v_rendered, v_match[1], v_value);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'CONTRACT_MISSING_VARIABLES:%', array_to_string(v_missing, ',');
  end if;
  return v_rendered;
end;
$$;

-- Safe generic backfill for templates that may exist in another environment.
insert into public.contract_template_versions (
  template_id, user_id, version_number, name_snapshot, body, variables, created_by, created_at
)
select
  ct.id, ct.user_id, 1, ct.name, ct.body,
  public.contract_template_variables_v2(ct.body),
  ct.user_id, ct.created_at
from public.contract_templates ct
where not exists (
  select 1 from public.contract_template_versions v where v.template_id = ct.id
);

update public.contract_templates ct
set current_version_id = v.id,
    updated_at = greatest(ct.created_at, coalesce(ct.updated_at, ct.created_at))
from public.contract_template_versions v
where v.template_id = ct.id
  and v.version_number = 1
  and ct.current_version_id is null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contract_templates_current_version_fkey') then
    alter table public.contract_templates
      add constraint contract_templates_current_version_fkey
      foreign key (current_version_id) references public.contract_template_versions(id) on delete restrict;
  end if;
end $$;

alter table public.contracts alter column signed_at drop not null;

alter table public.contracts
  add column if not exists status text not null default 'signed',
  add column if not exists appointment_id uuid,
  add column if not exists procedure_id uuid,
  add column if not exists template_version_id uuid,
  add column if not exists document_name_snapshot text,
  add column if not exists patient_snapshot jsonb,
  add column if not exists professional_snapshot jsonb,
  add column if not exists services_snapshot jsonb,
  add column if not exists financial_snapshot jsonb,
  add column if not exists context_snapshot jsonb,
  add column if not exists variables_snapshot jsonb,
  add column if not exists rendered_content_snapshot text,
  add column if not exists content_sha256 text,
  add column if not exists signature_path text,
  add column if not exists signature_sha256 text,
  add column if not exists pdf_path text,
  add column if not exists pdf_sha256 text,
  add column if not exists ready_at timestamptz,
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text,
  add column if not exists document_schema_version integer not null default 1,
  add column if not exists source_type text not null default 'legacy',
  add column if not exists prepare_idempotency_key uuid,
  add column if not exists prepare_payload_hash text,
  add column if not exists finalize_idempotency_key uuid,
  add column if not exists created_at timestamptz;

update public.contracts
set status = 'signed',
    source_type = 'legacy',
    document_schema_version = 1,
    pdf_path = coalesce(pdf_path, pdf_url),
    created_at = coalesce(created_at, signed_at)
where source_type = 'legacy';

alter table public.contracts alter column created_at set default now();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contracts_status_check') then
    alter table public.contracts add constraint contracts_status_check
      check (status in ('draft','ready','signed','voided'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_source_type_check') then
    alter table public.contracts add constraint contracts_source_type_check
      check (source_type in ('legacy','v2'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_schema_version_check') then
    alter table public.contracts add constraint contracts_schema_version_check
      check (document_schema_version >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_appointment_owner_fkey') then
    alter table public.contracts add constraint contracts_appointment_owner_fkey
      foreign key (appointment_id, user_id) references public.appointments(id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_procedure_owner_fkey') then
    alter table public.contracts add constraint contracts_procedure_owner_fkey
      foreign key (procedure_id, user_id) references public.procedures(id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'contracts_template_version_owner_fkey') then
    alter table public.contracts add constraint contracts_template_version_owner_fkey
      foreign key (template_version_id, template_id, user_id)
      references public.contract_template_versions(id, template_id, user_id);
  end if;
end $$;

create unique index if not exists contracts_prepare_idempotency_uidx
  on public.contracts(user_id, prepare_idempotency_key)
  where prepare_idempotency_key is not null;
create unique index if not exists contracts_finalize_idempotency_uidx
  on public.contracts(user_id, finalize_idempotency_key)
  where finalize_idempotency_key is not null;
create index if not exists contracts_user_patient_status_created_idx
  on public.contracts(user_id, patient_id, status, created_at desc);
create index if not exists contracts_user_procedure_created_idx
  on public.contracts(user_id, procedure_id, created_at desc)
  where procedure_id is not null;
create index if not exists contracts_user_appointment_created_idx
  on public.contracts(user_id, appointment_id, created_at desc)
  where appointment_id is not null;
create index if not exists contract_template_versions_user_template_version_idx
  on public.contract_template_versions(user_id, template_id, version_number desc);

create or replace function public.save_contract_template_v2(
  p_template_id uuid,
  p_name text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_template public.contract_templates%rowtype;
  v_version public.contract_template_versions%rowtype;
  v_next integer;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  if char_length(v_name) = 0 or char_length(v_name) > 200 then
    raise exception 'CONTRACT_TEMPLATE_NAME_INVALID';
  end if;
  perform public.contract_assert_template_placeholders_v2(p_body);

  if p_template_id is null then
    insert into public.contract_templates(user_id, name, body, active, created_at, updated_at)
    values (v_uid, v_name, p_body, true, now(), now())
    returning * into v_template;
    v_next := 1;
  else
    select * into v_template
    from public.contract_templates
    where id = p_template_id and user_id = v_uid
    for update;
    if not found then raise exception 'CONTRACT_TEMPLATE_NOT_FOUND'; end if;

    if v_template.name = v_name and v_template.body = p_body and v_template.current_version_id is not null then
      select * into v_version from public.contract_template_versions where id = v_template.current_version_id;
      return jsonb_build_object(
        'template_id', v_template.id,
        'version_id', v_version.id,
        'version_number', v_version.version_number,
        'unchanged', true
      );
    end if;

    select coalesce(max(version_number), 0) + 1 into v_next
    from public.contract_template_versions
    where template_id = v_template.id;
  end if;

  insert into public.contract_template_versions(
    template_id, user_id, version_number, name_snapshot, body, variables, created_by
  ) values (
    v_template.id, v_uid, v_next, v_name, p_body,
    public.contract_template_variables_v2(p_body), v_uid
  ) returning * into v_version;

  update public.contract_templates
  set name = v_name,
      body = p_body,
      current_version_id = v_version.id,
      updated_at = now()
  where id = v_template.id and user_id = v_uid;

  return jsonb_build_object(
    'template_id', v_template.id,
    'version_id', v_version.id,
    'version_number', v_version.version_number,
    'unchanged', false
  );
end;
$$;

create or replace function public.set_contract_template_active_v2(p_template_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  update public.contract_templates
  set active = coalesce(p_active, false), updated_at = now()
  where id = p_template_id and user_id = v_uid;
  if not found then raise exception 'CONTRACT_TEMPLATE_NOT_FOUND'; end if;
end;
$$;

create or replace function public.upsert_professional_profile_v2(
  p_display_name text,
  p_profession text,
  p_professional_registration text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_profession text := nullif(btrim(coalesce(p_profession, '')), '');
  v_registration text := nullif(btrim(coalesce(p_professional_registration, '')), '');
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  if char_length(v_name) = 0 or char_length(v_name) > 160 then
    raise exception 'PROFESSIONAL_NAME_REQUIRED';
  end if;
  if char_length(coalesce(v_profession, '')) > 160 or char_length(coalesce(v_registration, '')) > 160 then
    raise exception 'PROFESSIONAL_PROFILE_TOO_LARGE';
  end if;

  insert into public.professional_profiles(user_id, display_name, profession, professional_registration, updated_at)
  values (v_uid, v_name, v_profession, v_registration, now())
  on conflict (user_id) do update
  set display_name = excluded.display_name,
      profession = excluded.profession,
      professional_registration = excluded.professional_registration,
      updated_at = now();

  return jsonb_build_object(
    'display_name', v_name,
    'profession', v_profession,
    'professional_registration', v_registration
  );
end;
$$;

create or replace function public.prepare_contract_v2(
  p_patient_id uuid,
  p_template_id uuid,
  p_procedure_id uuid default null,
  p_appointment_id uuid default null,
  p_idempotency_key uuid default gen_random_uuid()
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_patient public.patients%rowtype;
  v_template public.contract_templates%rowtype;
  v_version public.contract_template_versions%rowtype;
  v_profile public.professional_profiles%rowtype;
  v_proc public.procedures%rowtype;
  v_appointment record;
  v_services jsonb := '[]'::jsonb;
  v_service_label text := '';
  v_total numeric;
  v_context_ts timestamptz;
  v_context jsonb := jsonb_build_object('type', 'patient');
  v_patient_snapshot jsonb;
  v_professional_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_variables jsonb;
  v_rendered text;
  v_content_payload jsonb;
  v_content_hash text;
  v_prepare_hash text;
  v_existing public.contracts%rowtype;
  v_contract public.contracts%rowtype;
  v_money text;
  v_date text;
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  if p_template_id is null then raise exception 'CONTRACT_TEMPLATE_REQUIRED'; end if;
  if p_procedure_id is not null and p_appointment_id is not null then
    raise exception 'CONTRACT_CONTEXT_AMBIGUOUS';
  end if;

  select * into v_patient from public.patients
  where id = p_patient_id and user_id = v_uid;
  if not found then raise exception 'CONTRACT_PATIENT_NOT_FOUND'; end if;

  select * into v_template from public.contract_templates
  where id = p_template_id and user_id = v_uid and active;
  if not found then raise exception 'CONTRACT_TEMPLATE_NOT_FOUND'; end if;

  select * into v_version from public.contract_template_versions
  where id = v_template.current_version_id
    and template_id = v_template.id
    and user_id = v_uid;
  if not found then raise exception 'CONTRACT_TEMPLATE_VERSION_NOT_FOUND'; end if;

  select * into v_profile from public.professional_profiles where user_id = v_uid;

  if p_procedure_id is not null then
    select * into v_proc from public.procedures
    where id = p_procedure_id and user_id = v_uid and patient_id = p_patient_id;
    if not found then raise exception 'CONTRACT_PROCEDURE_NOT_FOUND'; end if;

    select
      coalesce(jsonb_agg(jsonb_build_object(
        'procedure_item_id', pi.id,
        'service_id', pi.service_id,
        'name', pi.name,
        'quantity', pi.qty,
        'list_price', pi.list_price,
        'final_price', pi.final_price,
        'discount', pi.discount
      ) order by pi.created_at, pi.id), '[]'::jsonb),
      coalesce(string_agg(
        case when pi.qty > 1 then pi.qty::text || '× ' || pi.name else pi.name end,
        ' + ' order by pi.created_at, pi.id
      ), '')
    into v_services, v_service_label
    from public.procedure_items pi
    where pi.procedure_id = v_proc.id and pi.user_id = v_uid;

    v_total := v_proc.total_value;
    v_context_ts := v_proc.performed_at;
    v_context := jsonb_build_object(
      'type', 'procedure',
      'procedure_id', v_proc.id,
      'appointment_id', v_proc.appointment_id,
      'performed_at', v_proc.performed_at
    );
  elsif p_appointment_id is not null then
    select a.id, a.service_id, a.scheduled_at, a.status, s.name as service_name, s.price as service_price
    into v_appointment
    from public.appointments a
    left join public.services s on s.id = a.service_id and s.user_id = v_uid
    where a.id = p_appointment_id and a.user_id = v_uid and a.patient_id = p_patient_id;
    if not found then raise exception 'CONTRACT_APPOINTMENT_NOT_FOUND'; end if;

    if v_appointment.service_id is not null then
      v_services := jsonb_build_array(jsonb_build_object(
        'service_id', v_appointment.service_id,
        'name', coalesce(v_appointment.service_name, 'Serviço'),
        'quantity', 1,
        'final_price', v_appointment.service_price
      ));
      v_service_label := coalesce(v_appointment.service_name, 'Serviço');
      v_total := v_appointment.service_price;
    end if;
    v_context_ts := v_appointment.scheduled_at;
    v_context := jsonb_build_object(
      'type', 'appointment',
      'appointment_id', v_appointment.id,
      'scheduled_at', v_appointment.scheduled_at,
      'appointment_status', v_appointment.status
    );
  end if;

  v_patient_snapshot := jsonb_build_object(
    'name', v_patient.name,
    'cpf', v_patient.cpf
  );
  v_professional_snapshot := jsonb_build_object(
    'display_name', coalesce(v_profile.display_name, ''),
    'profession', coalesce(v_profile.profession, ''),
    'professional_registration', coalesce(v_profile.professional_registration, '')
  );
  v_financial_snapshot := case when v_total is null then null else jsonb_build_object(
    'currency', 'BRL', 'total_value', v_total
  ) end;
  v_money := case when v_total is null then '' else 'R$ ' || replace(to_char(v_total, 'FM999999990.00'), '.', ',') end;
  v_date := case when v_context_ts is null then '' else to_char(timezone('America/Sao_Paulo', v_context_ts), 'DD/MM/YYYY') end;

  v_variables := jsonb_build_object(
    'patient_name', v_patient.name,
    'patient_cpf', coalesce(v_patient.cpf, ''),
    'professional_name', coalesce(v_profile.display_name, ''),
    'professional_registration', coalesce(v_profile.professional_registration, ''),
    'professional_profession', coalesce(v_profile.profession, ''),
    'service_name', v_service_label,
    'services', v_service_label,
    'total_value', v_money,
    'procedure_date', v_date,
    'current_date', to_char(timezone('America/Sao_Paulo', now()), 'DD/MM/YYYY'),
    'nome', v_patient.name,
    'cpf', coalesce(v_patient.cpf, ''),
    'profissional', coalesce(v_profile.display_name, ''),
    'servico', v_service_label,
    'valor', v_money,
    'data', to_char(timezone('America/Sao_Paulo', now()), 'DD/MM/YYYY')
  );

  v_rendered := public.contract_render_v2(v_version.body, v_variables);
  v_content_payload := jsonb_build_object(
    'schema_version', 2,
    'template_version_id', v_version.id,
    'document_name', v_version.name_snapshot,
    'rendered_content', v_rendered,
    'patient', v_patient_snapshot,
    'professional', v_professional_snapshot,
    'services', v_services,
    'financial', v_financial_snapshot,
    'context', v_context,
    'variables', v_variables
  );
  v_content_hash := encode(extensions.digest(v_content_payload::text, 'sha256'), 'hex');
  v_prepare_hash := encode(extensions.digest(jsonb_build_object(
    'patient_id', p_patient_id,
    'template_id', p_template_id,
    'template_version_id', v_version.id,
    'procedure_id', p_procedure_id,
    'appointment_id', p_appointment_id
  )::text, 'sha256'), 'hex');

  if p_idempotency_key is not null then
    select * into v_existing from public.contracts
    where user_id = v_uid and prepare_idempotency_key = p_idempotency_key;
    if found then
      if v_existing.prepare_payload_hash is distinct from v_prepare_hash then
        raise exception 'CONTRACT_IDEMPOTENCY_MISMATCH';
      end if;
      return jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'template_id', v_existing.template_id,
        'template_version_id', v_existing.template_version_id,
        'document_name', v_existing.document_name_snapshot,
        'rendered_content', v_existing.rendered_content_snapshot,
        'patient_snapshot', v_existing.patient_snapshot,
        'professional_snapshot', v_existing.professional_snapshot,
        'services_snapshot', v_existing.services_snapshot,
        'financial_snapshot', v_existing.financial_snapshot,
        'context_snapshot', v_existing.context_snapshot,
        'content_sha256', v_existing.content_sha256,
        'ready_at', v_existing.ready_at
      );
    end if;
  end if;

  insert into public.contracts(
    patient_id, user_id, template_id, template_version_id,
    appointment_id, procedure_id, status, source_type, document_schema_version,
    document_name_snapshot, patient_snapshot, professional_snapshot,
    services_snapshot, financial_snapshot, context_snapshot, variables_snapshot,
    rendered_content_snapshot, content_sha256,
    signed_at, ready_at, created_at,
    prepare_idempotency_key, prepare_payload_hash,
    signature_data, pdf_url
  ) values (
    p_patient_id, v_uid, p_template_id, v_version.id,
    p_appointment_id, p_procedure_id, 'ready', 'v2', 2,
    v_version.name_snapshot, v_patient_snapshot, v_professional_snapshot,
    v_services, v_financial_snapshot, v_context, v_variables,
    v_rendered, v_content_hash,
    null, now(), now(),
    p_idempotency_key, v_prepare_hash,
    null, null
  ) returning * into v_contract;

  return jsonb_build_object(
    'id', v_contract.id,
    'status', v_contract.status,
    'template_id', v_contract.template_id,
    'template_version_id', v_contract.template_version_id,
    'document_name', v_contract.document_name_snapshot,
    'rendered_content', v_contract.rendered_content_snapshot,
    'patient_snapshot', v_contract.patient_snapshot,
    'professional_snapshot', v_contract.professional_snapshot,
    'services_snapshot', v_contract.services_snapshot,
    'financial_snapshot', v_contract.financial_snapshot,
    'context_snapshot', v_contract.context_snapshot,
    'content_sha256', v_contract.content_sha256,
    'ready_at', v_contract.ready_at
  );
exception
  when unique_violation then
    if p_idempotency_key is not null then
      select * into v_existing from public.contracts
      where user_id = v_uid and prepare_idempotency_key = p_idempotency_key;
      if found and v_existing.prepare_payload_hash = v_prepare_hash then
        return jsonb_build_object(
          'id', v_existing.id,
          'status', v_existing.status,
          'template_id', v_existing.template_id,
          'template_version_id', v_existing.template_version_id,
          'document_name', v_existing.document_name_snapshot,
          'rendered_content', v_existing.rendered_content_snapshot,
          'patient_snapshot', v_existing.patient_snapshot,
          'professional_snapshot', v_existing.professional_snapshot,
          'services_snapshot', v_existing.services_snapshot,
          'financial_snapshot', v_existing.financial_snapshot,
          'context_snapshot', v_existing.context_snapshot,
          'content_sha256', v_existing.content_sha256,
          'ready_at', v_existing.ready_at
        );
      end if;
    end if;
    raise;
end;
$$;

create or replace function public.finalize_contract_v2(
  p_contract_id uuid,
  p_signature_path text,
  p_signature_sha256 text,
  p_pdf_path text,
  p_pdf_sha256 text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_contract public.contracts%rowtype;
  v_expected_signature text;
  v_expected_pdf text;
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  if p_idempotency_key is null then raise exception 'CONTRACT_FINALIZE_IDEMPOTENCY_REQUIRED'; end if;
  if p_signature_sha256 !~ '^[0-9a-f]{64}$' or p_pdf_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'CONTRACT_ARTIFACT_HASH_INVALID';
  end if;

  select * into v_contract from public.contracts
  where id = p_contract_id and user_id = v_uid
  for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;

  if v_contract.status = 'signed' then
    if v_contract.finalize_idempotency_key = p_idempotency_key then
      return jsonb_build_object('id', v_contract.id, 'status', v_contract.status, 'signed_at', v_contract.signed_at, 'pdf_path', v_contract.pdf_path);
    end if;
    raise exception 'CONTRACT_ALREADY_FINALIZED';
  end if;
  if v_contract.status <> 'ready' or v_contract.source_type <> 'v2' then
    raise exception 'CONTRACT_NOT_READY';
  end if;

  v_expected_signature := v_uid::text || '/' || p_contract_id::text || '/signature.png';
  v_expected_pdf := v_uid::text || '/' || p_contract_id::text || '/document.pdf';
  if p_signature_path <> v_expected_signature or p_pdf_path <> v_expected_pdf then
    raise exception 'CONTRACT_ARTIFACT_PATH_INVALID';
  end if;

  if not exists (select 1 from storage.objects where bucket_id = 'contracts' and name = v_expected_signature) then
    raise exception 'CONTRACT_SIGNATURE_NOT_FOUND';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'contracts' and name = v_expected_pdf) then
    raise exception 'CONTRACT_PDF_NOT_FOUND';
  end if;

  update public.contracts
  set signature_path = p_signature_path,
      signature_sha256 = p_signature_sha256,
      pdf_path = p_pdf_path,
      pdf_url = p_pdf_path,
      pdf_sha256 = p_pdf_sha256,
      finalize_idempotency_key = p_idempotency_key,
      signed_at = now(),
      status = 'signed'
  where id = p_contract_id and user_id = v_uid
  returning * into v_contract;

  return jsonb_build_object(
    'id', v_contract.id,
    'status', v_contract.status,
    'signed_at', v_contract.signed_at,
    'pdf_path', v_contract.pdf_path,
    'content_sha256', v_contract.content_sha256,
    'signature_sha256', v_contract.signature_sha256,
    'pdf_sha256', v_contract.pdf_sha256
  );
end;
$$;

create or replace function public.void_contract_v2(p_contract_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_contract public.contracts%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'CONTRACT_SESSION_REQUIRED'; end if;
  if char_length(v_reason) = 0 or char_length(v_reason) > 1000 then
    raise exception 'CONTRACT_VOID_REASON_REQUIRED';
  end if;

  select * into v_contract from public.contracts
  where id = p_contract_id and user_id = v_uid
  for update;
  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status = 'voided' then
    return jsonb_build_object('id', v_contract.id, 'status', v_contract.status, 'voided_at', v_contract.voided_at);
  end if;

  update public.contracts
  set status = 'voided', voided_at = now(), void_reason = v_reason
  where id = p_contract_id and user_id = v_uid
  returning * into v_contract;

  return jsonb_build_object('id', v_contract.id, 'status', v_contract.status, 'voided_at', v_contract.voided_at);
end;
$$;

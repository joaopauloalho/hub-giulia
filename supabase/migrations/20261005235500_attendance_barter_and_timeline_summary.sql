-- Hub Giulia — permutas no atendimento + resumo no Histórico 360
-- Mantém o fluxo financeiro existente: a venda continua pelo valor cobrado,
-- pagamentos registram somente dinheiro efetivamente recebido/a receber e
-- a permuta fica separada para gestão.

alter table public.procedures
  add column if not exists barter_value numeric(14,2) not null default 0,
  add column if not exists barter_description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'procedures_barter_value_check'
      and conrelid = 'public.procedures'::regclass
  ) then
    alter table public.procedures
      add constraint procedures_barter_value_check
      check (barter_value >= 0 and barter_value <= total_value + 0.02);
  end if;
end $$;

create or replace function public.create_procedure_v6(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_injectable_maps jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_barter_value numeric,
  p_barter_description text
)
returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_barter numeric(14,2) := round(greatest(coalesce(p_barter_value, 0), 0), 2);
  v_description text := nullif(btrim(coalesce(p_barter_description, '')), '');
  v_payments jsonb := coalesce(p_payment_entries, '[]'::jsonb);
  v_sentinel date := date '0001-01-01';
  v_result public.procedures;
  v_removed uuid;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(v_payments) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;

  if v_barter > 0 then
    v_payments := v_payments || jsonb_build_array(jsonb_build_object(
      'method', 'dinheiro',
      'base_amount', v_barter,
      'amount', v_barter,
      'card_brand', null,
      'installments', 1,
      'fee_pct', null,
      'fee_value', 0,
      'net_amount', v_barter,
      'absorve_taxa', true,
      'scheduled_date', v_sentinel
    ));
  end if;

  select * into v_result
  from public.create_procedure_v5(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_payments,
    coalesce(p_injectable_maps, '[]'::jsonb),
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes
  );

  if coalesce(v_result.barter_value, 0) > 0 then
    if abs(v_result.barter_value - v_barter) > 0.02
       or coalesce(btrim(v_result.barter_description), '') <> coalesce(v_description, '') then
      raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_result;
  end if;

  if v_barter <= 0 then
    return v_result;
  end if;

  if v_barter > v_result.total_value + 0.02 then
    raise exception using errcode='22023', message='ATTENDANCE_BARTER_EXCEEDS_VALUE';
  end if;

  delete from public.procedure_payments
  where id = (
    select pp.id
    from public.procedure_payments pp
    where pp.procedure_id = v_result.id
      and pp.user_id = v_user_id
      and pp.method = 'dinheiro'
      and pp.scheduled_date = v_sentinel
      and abs(pp.amount - v_barter) <= 0.02
    order by pp.created_at desc, pp.id desc
    limit 1
  )
  returning id into v_removed;

  if v_removed is null then
    raise exception using errcode='P0001', message='ATTENDANCE_BARTER_ALLOCATION_MISSING';
  end if;

  update public.procedures p
  set barter_value = v_barter,
      barter_description = v_description,
      payment_method = 'split',
      net_value = coalesce((
        select round(sum(pp.net_amount), 2)
        from public.procedure_payments pp
        where pp.procedure_id = p.id
          and pp.user_id = v_user_id
          and pp.paid_at is not null
      ), 0)
  where p.id = v_result.id
    and p.user_id = v_user_id
  returning p.* into v_result;

  return v_result;
end;
$function$;

create or replace function public.create_procedure_with_injectable_draft_v6(
  p_idempotency_key uuid,
  p_patient_id uuid,
  p_appointment_id uuid,
  p_performed_at timestamptz,
  p_items jsonb,
  p_payment_entries jsonb,
  p_coverages jsonb,
  p_materials jsonb,
  p_clinical_minutes integer,
  p_notes text,
  p_draft_id uuid,
  p_draft_revision bigint,
  p_barter_value numeric,
  p_barter_description text
)
returns public.procedures
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_barter numeric(14,2) := round(greatest(coalesce(p_barter_value, 0), 0), 2);
  v_description text := nullif(btrim(coalesce(p_barter_description, '')), '');
  v_payments jsonb := coalesce(p_payment_entries, '[]'::jsonb);
  v_sentinel date := date '0001-01-01';
  v_result public.procedures;
  v_removed uuid;
begin
  if v_user_id is null then
    raise exception using errcode='P0001', message='ATTENDANCE_SESSION_REQUIRED';
  end if;
  if jsonb_typeof(v_payments) <> 'array' then
    raise exception using errcode='22023', message='ATTENDANCE_PAYMENTS_INVALID';
  end if;

  if v_barter > 0 then
    v_payments := v_payments || jsonb_build_array(jsonb_build_object(
      'method', 'dinheiro',
      'base_amount', v_barter,
      'amount', v_barter,
      'card_brand', null,
      'installments', 1,
      'fee_pct', null,
      'fee_value', 0,
      'net_amount', v_barter,
      'absorve_taxa', true,
      'scheduled_date', v_sentinel
    ));
  end if;

  select * into v_result
  from public.create_procedure_with_injectable_draft_v5(
    p_idempotency_key,
    p_patient_id,
    p_appointment_id,
    p_performed_at,
    p_items,
    v_payments,
    coalesce(p_coverages, '[]'::jsonb),
    coalesce(p_materials, '[]'::jsonb),
    p_clinical_minutes,
    p_notes,
    p_draft_id,
    p_draft_revision
  );

  if coalesce(v_result.barter_value, 0) > 0 then
    if abs(v_result.barter_value - v_barter) > 0.02
       or coalesce(btrim(v_result.barter_description), '') <> coalesce(v_description, '') then
      raise exception using errcode='P0001', message='ATTENDANCE_IDEMPOTENCY_CONFLICT';
    end if;
    return v_result;
  end if;

  if v_barter <= 0 then
    return v_result;
  end if;

  if v_barter > v_result.total_value + 0.02 then
    raise exception using errcode='22023', message='ATTENDANCE_BARTER_EXCEEDS_VALUE';
  end if;

  delete from public.procedure_payments
  where id = (
    select pp.id
    from public.procedure_payments pp
    where pp.procedure_id = v_result.id
      and pp.user_id = v_user_id
      and pp.method = 'dinheiro'
      and pp.scheduled_date = v_sentinel
      and abs(pp.amount - v_barter) <= 0.02
    order by pp.created_at desc, pp.id desc
    limit 1
  )
  returning id into v_removed;

  if v_removed is null then
    raise exception using errcode='P0001', message='ATTENDANCE_BARTER_ALLOCATION_MISSING';
  end if;

  update public.procedures p
  set barter_value = v_barter,
      barter_description = v_description,
      payment_method = 'split',
      net_value = coalesce((
        select round(sum(pp.net_amount), 2)
        from public.procedure_payments pp
        where pp.procedure_id = p.id
          and pp.user_id = v_user_id
          and pp.paid_at is not null
      ), 0)
  where p.id = v_result.id
    and p.user_id = v_user_id
  returning p.* into v_result;

  return v_result;
end;
$function$;

revoke all on function public.create_procedure_v6(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text,numeric,text) from public, anon;
grant execute on function public.create_procedure_v6(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,jsonb,integer,text,numeric,text) to authenticated;

revoke all on function public.create_procedure_with_injectable_draft_v6(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint,numeric,text) from public, anon;
grant execute on function public.create_procedure_with_injectable_draft_v6(uuid,uuid,uuid,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,text,uuid,bigint,numeric,text) to authenticated;

create or replace function public.list_patient_timeline_v6(
  p_patient_id uuid,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null
)
returns table(
  event_key text,
  event_type text,
  occurred_at timestamptz,
  title text,
  subtitle text,
  source_id uuid,
  metadata jsonb
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'PATIENT_360_SESSION_REQUIRED';
  end if;

  return query
  select
    e.event_key,
    e.event_type,
    e.occurred_at,
    e.title,
    case
      when e.event_type in ('procedure', 'return') and nullif(btrim(p.notes), '') is not null
        then concat_ws(' · ', nullif(btrim(e.subtitle), ''), btrim(p.notes))
      else e.subtitle
    end::text as subtitle,
    e.source_id,
    e.metadata
  from public.list_patient_timeline_v5(p_patient_id, p_limit, p_cursor_at, p_cursor_key) e
  left join public.procedures p
    on p.id = e.source_id
   and p.user_id = v_uid
   and p.patient_id = p_patient_id
  order by e.occurred_at desc, e.event_key desc;
end;
$function$;

revoke all on function public.list_patient_timeline_v6(uuid,integer,timestamptz,text) from public, anon;
grant execute on function public.list_patient_timeline_v6(uuid,integer,timestamptz,text) to authenticated;

-- Cancelamento/exclusão auditada de atendimento incorreto
-- Somente altera o financeiro interno; não executa reembolso PIX/cartão.
create or replace function public.cancel_procedure_v1(
  p_procedure_id uuid,
  p_expected_revision bigint,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_user_id uuid := auth.uid();
  v_procedure public.procedures;
  v_package public.patient_packages;
  v_voided integer := 0;
  v_linked_sessions integer := 0;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_SESSION_REQUIRED';
  end if;
  if p_procedure_id is null then
    raise exception using errcode = '22023', message = 'ATTENDANCE_CANCEL_ID_REQUIRED';
  end if;
  if v_reason is null or length(v_reason) > 240 then
    raise exception using errcode = '22023', message = 'ATTENDANCE_CANCEL_REASON_REQUIRED';
  end if;

  select * into v_procedure
    from public.procedures
   where id = p_procedure_id and user_id = v_user_id
     for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_NOT_FOUND';
  end if;
  if p_expected_revision is distinct from v_procedure.revision then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_CONFLICT';
  end if;

  -- Nunca remova atendimentos clínicos associados implicitamente.
  if exists (
    select 1 from public.procedures p
    where p.parent_procedure_id = p_procedure_id and p.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_HAS_RETURNS';
  end if;
  if exists (
    select 1 from public.contracts c
    where c.procedure_id = p_procedure_id and c.user_id = v_user_id
  ) or exists (
    select 1 from public.patient_photo_sessions s
    where s.procedure_id = p_procedure_id and s.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_HAS_DOCUMENTS';
  end if;
  if exists (
    select 1 from public.injectable_applications a
    join public.procedure_items i on i.id = a.procedure_item_id and i.user_id = a.user_id
    where i.procedure_id = p_procedure_id and a.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_HAS_INJECTABLES';
  end if;
  if exists (
    select 1 from public.procedure_returns r
    where r.user_id = v_user_id
      and (r.procedure_id = p_procedure_id or r.completed_by_procedure_id = p_procedure_id)
  ) then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_HAS_RETURNS';
  end if;
  if exists (
    select 1 from public.package_payments pp
    join public.patient_packages pk on pk.id = pp.package_id and pk.user_id = pp.user_id
    where pp.user_id = v_user_id and pk.source_procedure_id = p_procedure_id
  ) then
    raise exception using errcode = 'P0001', message = 'ATTENDANCE_CANCEL_HAS_PACKAGE_PAYMENTS';
  end if;

  select count(distinct r.procedure_id_snapshot)
  into v_linked_sessions
  from public.patient_packages pk
  join public.package_redemptions r on r.package_id = pk.id and r.user_id = pk.user_id
  where pk.source_procedure_id = p_procedure_id
    and pk.user_id = v_user_id
    and r.procedure_id_snapshot <> p_procedure_id;

  -- Anula o protocolo vendido por engano sem excluir sessões de outro atendimento.
  for v_package in
    select * from public.patient_packages
    where source_procedure_id = p_procedure_id and user_id = v_user_id
    for update
  loop
    if v_package.status <> 'voided' then
      update public.patient_packages
         set status = 'voided', voided_at = now(),
             void_reason = 'Atendimento de origem excluido: ' || v_reason,
             updated_at = now()
       where id = v_package.id and user_id = v_user_id;
      v_voided := v_voided + 1;
    end if;
  end loop;

  -- Auditoria preservada após a remoção da ficha operacional.
  insert into public.procedure_edit_events (
    user_id, procedure_id, procedure_id_snapshot, patient_id_snapshot, revision,
    reason, before_snapshot, after_snapshot, created_by
  ) values (
    v_user_id, p_procedure_id, p_procedure_id, v_procedure.patient_id,
    v_procedure.revision + 1,
    'Exclusao de atendimento: ' || v_reason,
    jsonb_build_object(
      'procedure', to_jsonb(v_procedure),
      'items', coalesce((select jsonb_agg(to_jsonb(i)) from public.procedure_items i
                         where i.procedure_id = p_procedure_id and i.user_id = v_user_id), '[]'::jsonb),
      'payments', coalesce((select jsonb_agg(to_jsonb(pp)) from public.procedure_payments pp
                            where pp.procedure_id = p_procedure_id and pp.user_id = v_user_id), '[]'::jsonb),
      'materials', coalesce((select jsonb_agg(to_jsonb(pm)) from public.procedure_materials pm
                             where pm.procedure_id = p_procedure_id and pm.user_id = v_user_id), '[]'::jsonb)
    ),
    jsonb_build_object('deleted', true, 'voided_protocols', v_voided,
                       'linked_session_attendances_preserved', v_linked_sessions),
    v_user_id
  );

  -- A função existente aciona os triggers de reversão de estoque e créditos,
  -- e remove os recebimentos e parcelas somente do registro excluído.
  perform public.remove_procedure_cascade(p_procedure_id);

  return jsonb_build_object(
    'deleted', true, 'id', p_procedure_id,
    'patient_id', v_procedure.patient_id,
    'value_removed', v_procedure.total_value,
    'voided_protocols', v_voided,
    'linked_sessions_preserved', v_linked_sessions
  );
end;
$$;

revoke all on function public.cancel_procedure_v1(uuid, bigint, text) from public, anon;
grant execute on function public.cancel_procedure_v1(uuid, bigint, text) to authenticated;
comment on function public.cancel_procedure_v1(uuid, bigint, text) is
  'Exclusão transacional, auditável e autorizada do atendimento; preserva outras sessões e não faz reembolso externo.';

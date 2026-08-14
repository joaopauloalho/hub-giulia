-- Hub Giulia 3.3 — database contract regression checks.
-- Read-only: safe to run against an integration/production schema.

do $$
declare
  overview_def text := pg_get_functiondef('public.get_dashboard_overview_v1(date,date,date,date)'::regprocedure);
  attention_def text := pg_get_functiondef('public.get_dashboard_attention_v1(date,integer)'::regprocedure);
  series_def text := pg_get_functiondef('public.get_dashboard_series_v1(date,date,text)'::regprocedure);
begin
  if overview_def not ilike '%public.procedure_payments%' or overview_def not ilike '%public.package_payments%' then
    raise exception 'dashboard finance must read procedure and package payments';
  end if;
  if overview_def not ilike '%paid_at is not null%' then
    raise exception 'dashboard received cash must require paid_at';
  end if;
  if overview_def ilike '%package_redemptions%' then
    raise exception 'package redemption must never be a received-cash source';
  end if;
  if overview_def not ilike '%procedure_items%' or overview_def not ilike '%final_price%' then
    raise exception 'clinical production must use historical procedure item snapshots';
  end if;
  if overview_def not ilike '%won_at%' or overview_def not ilike '%lost_at%' then
    raise exception 'CRM closed metrics must use won_at/lost_at';
  end if;
  if overview_def not ilike '%treatment_proposal_summary_v%' then
    raise exception 'proposal metrics must use the canonical proposal summary';
  end if;
  if overview_def not ilike '%patient_credit_ledger%' or overview_def not ilike '%patient_credit_item_balances_v%' then
    raise exception 'package flows and snapshot must use canonical credit sources';
  end if;
  if overview_def not ilike '%America/Sao_Paulo%' or series_def not ilike '%America/Sao_Paulo%' then
    raise exception 'dashboard period boundaries and series must use clinic timezone';
  end if;
  if attention_def not ilike '%crm_followups%' or attention_def not ilike '%list_procedure_returns_v2%' then
    raise exception 'attention must keep CRM follow-up and clinical returns as separate sources';
  end if;
end;
$$;

do $$
declare
  rec record;
begin
  for rec in
    select p.oid, p.proname, p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_dashboard_attention_v1','get_dashboard_overview_v1','get_dashboard_series_v1')
  loop
    if rec.prosecdef then
      raise exception 'dashboard RPC % must remain SECURITY INVOKER', rec.proname;
    end if;
    if not has_function_privilege('authenticated', rec.oid, 'EXECUTE') then
      raise exception 'authenticated must execute %', rec.proname;
    end if;
    if has_function_privilege('anon', rec.oid, 'EXECUTE') then
      raise exception 'anon must not execute %', rec.proname;
    end if;
  end loop;
end;
$$;

select 'dashboard_intelligence_contract: ok' as result;

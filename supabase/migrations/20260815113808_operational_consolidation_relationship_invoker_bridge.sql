-- Hub Giulia 3.9 — remove the package-specific SECURITY DEFINER bridge.
-- Reuse the canonical Relationship 3.8 RPC and keep the internal source view unexposed.
create or replace function public.list_operational_reactivation_v1()
returns table(
  opportunity_key text,
  person_type text,
  person_id uuid,
  patient_id uuid,
  contact_id uuid,
  display_name text,
  last_visit_at timestamptz,
  snoozed_until timestamptz,
  label text,
  source_type text,
  source_id uuid,
  status text,
  route text
)
language sql
stable
security invoker
set search_path=public,pg_temp
as $$
select
  o->>'key' as opportunity_key,
  r.person_type,
  r.person_id,
  r.patient_id,
  r.contact_id,
  r.display_name,
  r.last_visit_at,
  r.snoozed_until,
  o->>'label' as label,
  o->>'source_type' as source_type,
  nullif(o->>'source_id','')::uuid as source_id,
  o->>'status' as status,
  coalesce(nullif(o->>'route',''),r.target_route) as route
from public.list_relationship_opportunities_v1('reactivation',null,false,100,0) r
cross join lateral jsonb_array_elements(r.opportunities) o
where o->>'type'='reactivation';
$$;

revoke all on function public.list_operational_reactivation_v1() from public,anon;
grant execute on function public.list_operational_reactivation_v1() to authenticated;

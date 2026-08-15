-- Hub Giulia 3.9 — secure bridge for Relationship's intentionally internal source view.
create or replace function public.list_operational_reactivation_v1()
returns table(opportunity_key text,person_type text,person_id uuid,patient_id uuid,contact_id uuid,display_name text,last_visit_at timestamptz,snoozed_until timestamptz,label text,source_type text,source_id uuid,status text,route text)
language sql stable security definer set search_path=public,pg_temp as $$
select r.opportunity_key,r.person_type,r.person_id,r.patient_id,r.contact_id,r.display_name,r.last_visit_at,r.snoozed_until,r.label,r.source_type,r.source_id,r.status,r.route
from public.relationship_opportunity_sources_v1 r
where r.user_id=(select auth.uid()) and r.opportunity_type='reactivation' and (r.snoozed_until is null or r.snoozed_until<=now());
$$;
revoke all on function public.list_operational_reactivation_v1() from public,anon;
grant execute on function public.list_operational_reactivation_v1() to authenticated;

create or replace view public.operational_attention_v1 with (security_invoker=true) as
with communication_items as (
 select c.item_key attention_key,
 case when c.category='return' and c.priority='overdue' then 'clinical_overdue' when c.category='return' then 'clinical_due' when c.category='confirmation' then 'appointment_action' when c.category='crm' then 'communication_action' when c.category='proposal' then 'commercial_followup' when c.category='package' then 'credit_expiry' else 'communication_action' end priority_class,
 case when c.category='return' and c.priority='overdue' then 900 when c.category='return' and c.priority='today' then 850 when c.category='confirmation' and c.priority='today' then 760 when c.category='crm' and c.priority='overdue' then 680 when c.category='crm' then 640 when c.category='confirmation' and c.priority='tomorrow' then 700 when c.category='confirmation' then 620 when c.category='return' then 600 when c.category='proposal' and c.priority='overdue' then 500 when c.category='proposal' and c.priority='today' then 460 when c.category='proposal' then 420 when c.category='package' and c.priority='today' then 400 when c.category='package' and c.priority='tomorrow' then 360 when c.category='package' then 320 else 300 end priority_rank,
 c.category,c.source_type,c.source_id,c.patient_id,c.contact_id,c.display_name person_name,c.reason title,
 case when c.priority='overdue' then 'Atrasado' when c.priority='today' then 'Vence hoje' when c.priority='tomorrow' then 'Amanhã' else 'Próximo' end subtitle,c.due_at,c.priority source_priority,
 case when c.category='return' and c.patient_id is not null then '/retornos?patient_id='||c.patient_id::text when c.category='confirmation' then '/agenda?date='||to_char(c.due_at at time zone 'America/Sao_Paulo','YYYY-MM-DD') else c.target_route end route,
 case when c.category='return' then 'open_return' when c.category in('confirmation','crm','proposal','package') then 'open_communication' else 'open_source' end action_type,
 case when c.category='return' then 'Ver retorno' when c.category='confirmation' then 'Confirmar' when c.category in('crm','proposal','package') then 'Abrir comunicação' else 'Abrir' end action_label,
 case when c.category in('confirmation','crm','proposal','package') then '/comunicacao?category='||c.category when c.category='return' and c.patient_id is not null then '/retornos?patient_id='||c.patient_id::text else c.target_route end action_route
 from public.communication_attention_v1 c where not c.is_snoozed and not c.is_suppressed_after_contact
),aftercare_items as (
 select a.item_key,case when coalesce((a.context->>'requires_professional_review')::boolean,false) then 'aftercare_review' when a.priority='overdue' then 'aftercare_overdue' else 'aftercare_due' end,case when coalesce((a.context->>'requires_professional_review')::boolean,false) then 880 when a.priority='overdue' then 840 else 800 end,'aftercare',a.source_type,a.source_id,a.patient_id,a.contact_id,a.display_name,a.reason,case when coalesce((a.context->>'requires_professional_review')::boolean,false) then 'Revisão profissional' when a.priority='overdue' then 'Atrasado' else 'Hoje' end,a.due_at,a.priority,case when a.patient_id is null then '/pacientes' else '/pacientes/'||a.patient_id::text end,'open_aftercare','Ver acompanhamento','/comunicacao?category=aftercare' from public.aftercare_communication_attention_v1 a where not a.is_snoozed and not a.is_suppressed_after_contact
),base_operational as(select * from communication_items union all select * from aftercare_items),relationship_items as(
 select r.opportunity_key,'relationship_reactivation',200,'relationship',r.source_type,r.source_id,r.patient_id,r.contact_id,r.display_name,r.label,'Relacionamento',coalesce(r.last_visit_at,now()),r.status,r.route,'open_relationship','Abrir relacionamento','/relacionamento?person_type='||r.person_type||'&person_id='||r.person_id::text
 from public.list_operational_reactivation_v1() r where not exists(select 1 from base_operational b where b.patient_id is not null and b.patient_id=r.patient_id)
),all_items as(select * from base_operational union all select * from relationship_items),deduped as(select a.*,row_number() over(partition by a.attention_key order by a.priority_rank desc,a.due_at asc nulls last,a.source_id) rn from all_items a)
select attention_key,priority_class,priority_rank,category,source_type,source_id,patient_id,contact_id,person_name,title,subtitle,due_at,source_priority,route,action_type,action_label,action_route from deduped where rn=1;
revoke all on table public.operational_attention_v1 from public,anon;
grant select on table public.operational_attention_v1 to authenticated;

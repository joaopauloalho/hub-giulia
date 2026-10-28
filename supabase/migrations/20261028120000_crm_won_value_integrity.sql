-- Stage 5: preserve commercial value integrity without inventing past revenue.
begin;
with accepted as (
 select distinct on (tp.user_id,tp.deal_id) tp.user_id,tp.deal_id,v.total_value
 from public.treatment_proposals tp
 join public.treatment_proposal_versions v on v.proposal_id=tp.id and v.user_id=tp.user_id
 where v.status='accepted' and v.total_value>0
 order by tp.user_id,tp.deal_id,v.accepted_at desc nulls last,v.version_number desc
)
update public.deals d set value=a.total_value
from accepted a
where d.id=a.deal_id and d.user_id=a.user_id and d.stage='won'
  and d.value is null;

create or replace function public.set_crm_won_with_value_v1(p_deal_id uuid,p_value numeric)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_stage text;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED' using errcode='42501'; end if;
 if p_value is null or p_value<=0 or p_value>100000000 then
   raise exception 'DEAL_VALUE_REQUIRED' using errcode='22023';
 end if;
 select stage into v_stage from public.deals where id=p_deal_id and user_id=v_uid for update;
 if not found then raise exception 'DEAL_NOT_FOUND' using errcode='42501'; end if;
 update public.deals set value=round(p_value,2) where id=p_deal_id and user_id=v_uid;
 if v_stage<>'won' then
  perform public.set_crm_stage_v1(p_deal_id,'won',null,null);
 end if;
end;
$$;
revoke all on function public.set_crm_won_with_value_v1(uuid,numeric) from public,anon;
grant execute on function public.set_crm_won_with_value_v1(uuid,numeric) to authenticated;

-- Prevent a new incomplete win through any endpoint, not just the CRM UI.
create or replace function public.crm_won_requires_value_v1()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if new.stage='won' and old.stage is distinct from 'won' and (new.value is null or new.value<=0) then
   raise exception 'DEAL_VALUE_REQUIRED' using errcode='22023';
 end if;
 return new;
end;
$$;
drop trigger if exists trg_crm_won_requires_value_v1 on public.deals;
create trigger trg_crm_won_requires_value_v1 before update of stage on public.deals
for each row execute function public.crm_won_requires_value_v1();
revoke all on function public.crm_won_requires_value_v1() from public,anon;
commit;

-- Hub Giulia 3.0 — CRM 2.0
-- Cover composite ownership FKs in their declared column order for planner/advisor.

create index if not exists crm_activities_actor_user_idx
  on public.crm_activities(actor_user_id);

create index if not exists crm_activities_contact_owner_idx
  on public.crm_activities(contact_id, user_id);

create index if not exists crm_activities_deal_owner_idx
  on public.crm_activities(deal_id, user_id)
  where deal_id is not null;

create index if not exists crm_deal_interests_deal_owner_idx
  on public.crm_deal_interests(deal_id, user_id);

create index if not exists crm_followups_deal_owner_idx
  on public.crm_followups(deal_id, user_id);

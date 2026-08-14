-- Hub Giulia 3.2 — Pacotes, Vouchers & Créditos: core domain
-- Ledger is append-only and the only source of truth for service/session credit balance.

create table public.vouchers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  code text not null,
  normalized_code text not null,
  status text not null default 'active',
  service_id uuid,
  service_name_snapshot text not null,
  quantity numeric(12,3) not null default 1,
  unit_label_snapshot text not null default 'sessão',
  recipient_name text,
  recipient_phone text,
  patient_id uuid,
  issued_at timestamptz not null default now(),
  valid_until date,
  redeemed_at timestamptz,
  redeemed_by_patient_id uuid,
  redeemed_package_id uuid,
  source text,
  note text,
  voided_at timestamptz,
  void_reason text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  constraint vouchers_status_check check (status in ('active','redeemed','voided')),
  constraint vouchers_code_check check (nullif(btrim(code), '') is not null),
  constraint vouchers_normalized_code_check check (normalized_code = upper(regexp_replace(btrim(code), '\s+', '', 'g'))),
  constraint vouchers_service_name_check check (nullif(btrim(service_name_snapshot), '') is not null),
  constraint vouchers_quantity_check check (quantity > 0),
  constraint vouchers_unit_check check (nullif(btrim(unit_label_snapshot), '') is not null),
  constraint vouchers_validity_check check (valid_until is null or valid_until >= issued_at::date),
  constraint vouchers_state_check check (
    (status = 'active' and redeemed_at is null and voided_at is null)
    or (status = 'redeemed' and redeemed_at is not null and redeemed_by_patient_id is not null and voided_at is null)
    or (status = 'voided' and voided_at is not null and nullif(btrim(void_reason), '') is not null and redeemed_at is null)
  ),
  constraint vouchers_service_owner_fkey foreign key (service_id, user_id) references public.services(id, user_id) on delete set null (service_id),
  constraint vouchers_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id) on delete set null (patient_id),
  constraint vouchers_redeemed_patient_owner_fkey foreign key (redeemed_by_patient_id, user_id) references public.patients(id, user_id) on delete set null (redeemed_by_patient_id)
);

create unique index vouchers_id_user_id_uidx on public.vouchers(id, user_id);
create unique index vouchers_user_normalized_code_uidx on public.vouchers(user_id, normalized_code);
create index vouchers_user_status_valid_idx on public.vouchers(user_id, status, valid_until);
create index vouchers_patient_user_idx on public.vouchers(patient_id, user_id) where patient_id is not null;

create table public.patient_packages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  patient_id uuid not null,
  title_snapshot text not null,
  source_type text not null,
  source_proposal_version_id uuid,
  source_deal_id uuid,
  source_voucher_id uuid,
  status text not null default 'draft',
  commercial_total_snapshot numeric(14,2) not null default 0,
  valid_from date,
  valid_until date,
  activated_at timestamptz,
  sale_recorded_at timestamptz,
  voided_at timestamptz,
  void_reason text,
  notes text,
  creation_reason text,
  creation_idempotency_key uuid,
  activation_idempotency_key uuid,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint patient_packages_title_check check (nullif(btrim(title_snapshot), '') is not null),
  constraint patient_packages_source_type_check check (source_type in ('proposal','manual','voucher','complimentary')),
  constraint patient_packages_status_check check (status in ('draft','active','voided')),
  constraint patient_packages_money_check check (commercial_total_snapshot >= 0),
  constraint patient_packages_validity_check check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint patient_packages_void_check check ((status <> 'voided' and voided_at is null) or (status = 'voided' and voided_at is not null and nullif(btrim(void_reason), '') is not null)),
  constraint patient_packages_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint patient_packages_proposal_version_owner_fkey foreign key (source_proposal_version_id, user_id) references public.treatment_proposal_versions(id, user_id),
  constraint patient_packages_deal_owner_fkey foreign key (source_deal_id, user_id) references public.deals(id, user_id),
  constraint patient_packages_voucher_owner_fkey foreign key (source_voucher_id, user_id) references public.vouchers(id, user_id)
);

create unique index patient_packages_id_user_id_uidx on public.patient_packages(id, user_id);
create unique index patient_packages_user_creation_key_uidx on public.patient_packages(user_id, creation_idempotency_key) where creation_idempotency_key is not null;
create unique index patient_packages_user_proposal_version_uidx on public.patient_packages(user_id, source_proposal_version_id) where source_proposal_version_id is not null;
create unique index patient_packages_user_voucher_uidx on public.patient_packages(user_id, source_voucher_id) where source_voucher_id is not null;
create index patient_packages_user_patient_created_idx on public.patient_packages(user_id, patient_id, created_at desc);
create index patient_packages_user_status_valid_idx on public.patient_packages(user_id, status, valid_until);

alter table public.vouchers add constraint vouchers_redeemed_package_owner_fkey foreign key (redeemed_package_id, user_id) references public.patient_packages(id, user_id);

create table public.patient_package_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  package_id uuid not null,
  service_id uuid,
  service_name_snapshot text not null,
  quantity_granted numeric(12,3) not null,
  unit_label_snapshot text not null default 'sessão',
  commercial_value_snapshot numeric(14,2),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint patient_package_items_name_check check (nullif(btrim(service_name_snapshot), '') is not null),
  constraint patient_package_items_quantity_check check (quantity_granted > 0),
  constraint patient_package_items_unit_check check (nullif(btrim(unit_label_snapshot), '') is not null),
  constraint patient_package_items_value_check check (commercial_value_snapshot is null or commercial_value_snapshot >= 0),
  constraint patient_package_items_package_owner_fkey foreign key (package_id, user_id) references public.patient_packages(id, user_id),
  constraint patient_package_items_service_owner_fkey foreign key (service_id, user_id) references public.services(id, user_id) on delete set null (service_id)
);

create unique index patient_package_items_id_user_id_uidx on public.patient_package_items(id, user_id);
create index patient_package_items_package_sort_idx on public.patient_package_items(package_id, sort_order, id);
create index patient_package_items_user_service_idx on public.patient_package_items(user_id, service_id) where service_id is not null;

create table public.patient_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  patient_id uuid not null,
  package_id uuid not null,
  package_item_id uuid not null,
  movement_type text not null,
  quantity_delta numeric(12,3) not null,
  source_type text not null,
  source_id uuid,
  procedure_id uuid,
  procedure_item_id uuid,
  procedure_id_snapshot uuid,
  procedure_item_id_snapshot uuid,
  reason text,
  idempotency_key text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  constraint patient_credit_ledger_movement_check check (movement_type in ('grant','redeem','reversal','adjustment')),
  constraint patient_credit_ledger_delta_check check (quantity_delta <> 0 and (movement_type <> 'grant' or quantity_delta > 0) and (movement_type <> 'redeem' or quantity_delta < 0) and (movement_type <> 'reversal' or quantity_delta > 0)),
  constraint patient_credit_ledger_adjustment_reason_check check (movement_type <> 'adjustment' or nullif(btrim(reason), '') is not null),
  constraint patient_credit_ledger_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint patient_credit_ledger_package_owner_fkey foreign key (package_id, user_id) references public.patient_packages(id, user_id),
  constraint patient_credit_ledger_item_owner_fkey foreign key (package_item_id, user_id) references public.patient_package_items(id, user_id),
  constraint patient_credit_ledger_procedure_owner_fkey foreign key (procedure_id, user_id) references public.procedures(id, user_id) on delete set null (procedure_id),
  constraint patient_credit_ledger_procedure_item_owner_fkey foreign key (procedure_item_id, user_id) references public.procedure_items(id, user_id) on delete set null (procedure_item_id)
);

create unique index patient_credit_ledger_id_user_id_uidx on public.patient_credit_ledger(id, user_id);
create unique index patient_credit_ledger_user_idempotency_uidx on public.patient_credit_ledger(user_id, idempotency_key);
create unique index patient_credit_ledger_initial_grant_uidx on public.patient_credit_ledger(user_id, package_item_id) where movement_type = 'grant' and source_type = 'activation';
create index patient_credit_ledger_item_created_idx on public.patient_credit_ledger(package_item_id, created_at, id);
create index patient_credit_ledger_user_patient_created_idx on public.patient_credit_ledger(user_id, patient_id, created_at desc);
create index patient_credit_ledger_procedure_item_idx on public.patient_credit_ledger(procedure_item_id, user_id) where procedure_item_id is not null;

create table public.package_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  patient_id uuid not null,
  package_id uuid not null,
  package_item_id uuid not null,
  procedure_id uuid,
  procedure_item_id uuid,
  procedure_id_snapshot uuid not null,
  procedure_item_id_snapshot uuid not null,
  quantity numeric(12,3) not null,
  coverage_value_snapshot numeric(14,2) not null default 0,
  ledger_movement_id uuid not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  constraint package_redemptions_quantity_check check (quantity > 0),
  constraint package_redemptions_value_check check (coverage_value_snapshot >= 0),
  constraint package_redemptions_patient_owner_fkey foreign key (patient_id, user_id) references public.patients(id, user_id),
  constraint package_redemptions_package_owner_fkey foreign key (package_id, user_id) references public.patient_packages(id, user_id),
  constraint package_redemptions_item_owner_fkey foreign key (package_item_id, user_id) references public.patient_package_items(id, user_id),
  constraint package_redemptions_procedure_owner_fkey foreign key (procedure_id, user_id) references public.procedures(id, user_id) on delete set null (procedure_id),
  constraint package_redemptions_procedure_item_owner_fkey foreign key (procedure_item_id, user_id) references public.procedure_items(id, user_id) on delete set null (procedure_item_id),
  constraint package_redemptions_ledger_owner_fkey foreign key (ledger_movement_id, user_id) references public.patient_credit_ledger(id, user_id)
);

create unique index package_redemptions_id_user_id_uidx on public.package_redemptions(id, user_id);
create unique index package_redemptions_user_idempotency_uidx on public.package_redemptions(user_id, idempotency_key);
create unique index package_redemptions_procedure_item_once_uidx on public.package_redemptions(user_id, procedure_item_id_snapshot);
create index package_redemptions_package_item_idx on public.package_redemptions(package_item_id, created_at desc);

create table public.package_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  package_id uuid not null,
  method text not null,
  base_amount numeric(14,2) not null,
  amount numeric(14,2) not null,
  card_brand text,
  installments integer not null default 1,
  fee_pct numeric(8,4),
  fee_value numeric(14,2),
  net_amount numeric(14,2) not null,
  absorve_taxa boolean not null default true,
  scheduled_date date,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  constraint package_payments_method_check check (method in ('dinheiro','pix','cartao_credito','cartao_debito')),
  constraint package_payments_amount_check check (base_amount >= 0 and amount >= 0 and net_amount >= 0 and (fee_pct is null or (fee_pct >= 0 and fee_pct <= 100)) and (fee_value is null or fee_value >= 0) and abs(amount - coalesce(fee_value,0) - net_amount) <= 0.02),
  constraint package_payments_installments_check check (installments >= 1 and (method = 'cartao_credito' or installments = 1)),
  constraint package_payments_card_check check ((method in ('cartao_credito','cartao_debito') and card_brand in ('master_visa','elo')) or (method not in ('cartao_credito','cartao_debito') and card_brand is null)),
  constraint package_payments_package_owner_fkey foreign key (package_id, user_id) references public.patient_packages(id, user_id)
);

create unique index package_payments_id_user_id_uidx on public.package_payments(id, user_id);
create index package_payments_user_package_idx on public.package_payments(user_id, package_id, created_at);
create index package_payments_user_paid_idx on public.package_payments(user_id, paid_at) where paid_at is not null;
create index package_payments_user_scheduled_idx on public.package_payments(user_id, scheduled_date) where paid_at is null;

create or replace function public.block_package_history_mutation_v1() returns trigger language plpgsql set search_path = public, pg_temp as $$ begin raise exception using errcode = 'P0001', message = 'PACKAGE_HISTORY_APPEND_ONLY'; end; $$;
create trigger patient_credit_ledger_no_update_delete before update or delete on public.patient_credit_ledger for each row execute function public.block_package_history_mutation_v1();
create trigger package_redemptions_no_update_delete before update or delete on public.package_redemptions for each row execute function public.block_package_history_mutation_v1();

create view public.patient_credit_item_balances_v with (security_invoker = true) as
select i.user_id, p.patient_id, p.id as package_id, p.title_snapshot as package_title, p.source_type, p.source_proposal_version_id, p.source_deal_id, p.source_voucher_id, p.status as package_status, p.valid_from, p.valid_until, p.activated_at, i.id as package_item_id, i.service_id, i.service_name_snapshot, i.quantity_granted, i.unit_label_snapshot, i.commercial_value_snapshot,
coalesce(sum(case when l.movement_type = 'grant' then l.quantity_delta else 0 end), 0)::numeric(12,3) as granted,
coalesce(-sum(case when l.movement_type = 'redeem' then l.quantity_delta else 0 end), 0)::numeric(12,3) as redeemed,
coalesce(sum(case when l.movement_type = 'reversal' then l.quantity_delta else 0 end), 0)::numeric(12,3) as reversed,
coalesce(sum(case when l.movement_type = 'adjustment' then l.quantity_delta else 0 end), 0)::numeric(12,3) as adjusted,
coalesce(sum(l.quantity_delta), 0)::numeric(12,3) as raw_balance,
case when p.status = 'active' and (p.valid_from is null or p.valid_from <= current_date) and (p.valid_until is null or p.valid_until >= current_date) then greatest(coalesce(sum(l.quantity_delta), 0), 0)::numeric(12,3) else 0::numeric(12,3) end as available_balance,
case when p.status = 'voided' then 'voided' when p.status = 'draft' then 'draft' when p.valid_from is not null and p.valid_from > current_date then 'draft' when p.valid_until is not null and p.valid_until < current_date then 'expired' when coalesce(sum(l.quantity_delta), 0) <= 0 then 'completed' else 'active' end as effective_status
from public.patient_package_items i join public.patient_packages p on p.id = i.package_id and p.user_id = i.user_id left join public.patient_credit_ledger l on l.package_item_id = i.id and l.user_id = i.user_id
group by i.user_id, p.patient_id, p.id, p.title_snapshot, p.source_type, p.source_proposal_version_id, p.source_deal_id, p.source_voucher_id, p.status, p.valid_from, p.valid_until, p.activated_at, i.id, i.service_id, i.service_name_snapshot, i.quantity_granted, i.unit_label_snapshot, i.commercial_value_snapshot;

create view public.patient_package_summary_v with (security_invoker = true) as
select b.user_id, b.patient_id, b.package_id, b.package_title, b.source_type, b.source_proposal_version_id, b.source_deal_id, b.source_voucher_id, min(b.valid_from) as valid_from, min(b.valid_until) as valid_until, min(b.activated_at) as activated_at, count(*)::integer as item_count, sum(b.quantity_granted)::numeric(12,3) as quantity_granted, sum(b.raw_balance)::numeric(12,3) as raw_balance, sum(b.available_balance)::numeric(12,3) as available_balance,
case when bool_or(b.effective_status = 'voided') then 'voided' when bool_or(b.effective_status = 'draft') then 'draft' when bool_or(b.effective_status = 'expired') then 'expired' when sum(b.available_balance) <= 0 then 'completed' else 'active' end as effective_status
from public.patient_credit_item_balances_v b group by b.user_id, b.patient_id, b.package_id, b.package_title, b.source_type, b.source_proposal_version_id, b.source_deal_id, b.source_voucher_id;

create view public.package_finance_v with (security_invoker = true) as
select p.user_id, p.id as package_id, p.patient_id, p.title_snapshot, p.sale_recorded_at, case when p.sale_recorded_at is not null then p.commercial_total_snapshot else 0::numeric end as sale_value,
coalesce(sum(case when pay.paid_at is not null then pay.amount else 0 end), 0)::numeric(14,2) as paid_value,
coalesce(sum(case when pay.paid_at is not null then coalesce(pay.fee_value,0) else 0 end), 0)::numeric(14,2) as paid_fee_value,
coalesce(sum(case when pay.paid_at is not null then pay.net_amount else 0 end), 0)::numeric(14,2) as paid_net_value,
coalesce(sum(case when pay.paid_at is null then pay.amount else 0 end), 0)::numeric(14,2) as pending_value
from public.patient_packages p left join public.package_payments pay on pay.package_id = p.id and pay.user_id = p.user_id group by p.user_id, p.id, p.patient_id, p.title_snapshot, p.sale_recorded_at, p.commercial_total_snapshot;

alter table public.vouchers enable row level security;
alter table public.patient_packages enable row level security;
alter table public.patient_package_items enable row level security;
alter table public.patient_credit_ledger enable row level security;
alter table public.package_redemptions enable row level security;
alter table public.package_payments enable row level security;

create policy vouchers_select_own on public.vouchers for select to authenticated using ((select auth.uid()) = user_id);
create policy patient_packages_select_own on public.patient_packages for select to authenticated using ((select auth.uid()) = user_id);
create policy patient_package_items_select_own on public.patient_package_items for select to authenticated using ((select auth.uid()) = user_id);
create policy patient_credit_ledger_select_own on public.patient_credit_ledger for select to authenticated using ((select auth.uid()) = user_id);
create policy package_redemptions_select_own on public.package_redemptions for select to authenticated using ((select auth.uid()) = user_id);
create policy package_payments_select_own on public.package_payments for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.vouchers, public.patient_packages, public.patient_package_items, public.patient_credit_ledger, public.package_redemptions, public.package_payments from anon;
revoke all on public.vouchers, public.patient_packages, public.patient_package_items, public.patient_credit_ledger, public.package_redemptions, public.package_payments from authenticated;
grant select on public.vouchers, public.patient_packages, public.patient_package_items, public.patient_credit_ledger, public.package_redemptions, public.package_payments to authenticated;
revoke all on public.patient_credit_item_balances_v, public.patient_package_summary_v, public.package_finance_v from anon;
grant select on public.patient_credit_item_balances_v, public.patient_package_summary_v, public.package_finance_v to authenticated;
revoke all on function public.block_package_history_mutation_v1() from public, anon, authenticated;

comment on table public.patient_credit_ledger is 'Append-only source of truth for patient service/session credits. Balance is always derived from movements.';
comment on table public.package_redemptions is 'Immutable evidence linking a procedure item to the package credit movement that covered it.';
comment on table public.package_payments is 'Money received/scheduled for package sale. Never used for later package credit consumption.';

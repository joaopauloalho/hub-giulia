-- A reserva técnica criada para continuidade clínica não aumenta a quantidade contratada.
-- Se o planejamento comercial for ampliado depois de uma sessão extra, o saldo exibido deve
-- usar primeiro apenas o que foi contratado e voltar a expor uma única sessão clínica quando
-- esse saldo terminar novamente.

create or replace view public.patient_credit_item_balances_v as
select
  i.user_id,
  p.patient_id,
  p.id as package_id,
  p.title_snapshot as package_title,
  p.source_type,
  p.source_proposal_version_id,
  p.source_deal_id,
  p.source_voucher_id,
  p.status as package_status,
  p.valid_from,
  p.valid_until,
  p.activated_at,
  i.id as package_item_id,
  i.service_id,
  i.service_name_snapshot,
  i.quantity_granted,
  i.unit_label_snapshot,
  i.commercial_value_snapshot,
  coalesce(sum(case when l.movement_type = 'grant' then l.quantity_delta else 0 end), 0)::numeric(12,3) as granted,
  coalesce(-sum(case when l.movement_type = 'redeem' then l.quantity_delta else 0 end), 0)::numeric(12,3) as redeemed,
  coalesce(sum(case when l.movement_type = 'reversal' then l.quantity_delta else 0 end), 0)::numeric(12,3) as reversed,
  coalesce(sum(case when l.movement_type = 'adjustment' then l.quantity_delta else 0 end), 0)::numeric(12,3) as adjusted,
  coalesce(sum(l.quantity_delta), 0)::numeric(12,3) as raw_balance,
  case
    when p.status = 'active'
      and p.clinically_finalized_at is null
      and (p.valid_from is null or p.valid_from <= current_date)
      and (p.valid_until is null or p.valid_until >= current_date)
    then case
      when p.allow_clinical_extensions then
        case
          when coalesce(sum(case
            when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then 0
            else l.quantity_delta
          end), 0) <= 0
          then 1::numeric(12,3)
          else greatest(coalesce(sum(case
            when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then 0
            else l.quantity_delta
          end), 0), 0)::numeric(12,3)
        end
      else greatest(coalesce(sum(l.quantity_delta), 0), 0)::numeric(12,3)
    end
    else 0::numeric(12,3)
  end as available_balance,
  case
    when p.status = 'voided' then 'voided'
    when p.status = 'draft' then 'draft'
    when p.valid_from is not null and p.valid_from > current_date then 'draft'
    when p.valid_until is not null and p.valid_until < current_date then 'expired'
    when p.clinically_finalized_at is not null then 'completed'
    when p.allow_clinical_extensions then 'active'
    when coalesce(sum(l.quantity_delta), 0) <= 0 then 'completed'
    else 'active'
  end as effective_status,
  p.allow_clinical_extensions,
  p.clinically_finalized_at,
  p.clinically_finalized_reason,
  coalesce(sum(case
    when l.movement_type = 'adjustment' and l.source_type <> 'protocol_clinical_extension' then l.quantity_delta
    else 0
  end), 0)::numeric(12,3) as contracted_adjusted,
  coalesce(sum(case
    when l.movement_type = 'adjustment' and l.source_type = 'protocol_clinical_extension' then l.quantity_delta
    else 0
  end), 0)::numeric(12,3) as clinical_extension_adjusted
from public.patient_package_items i
join public.patient_packages p on p.id = i.package_id and p.user_id = i.user_id
left join public.patient_credit_ledger l on l.package_item_id = i.id and l.user_id = i.user_id
group by
  i.user_id, p.patient_id, p.id, p.title_snapshot, p.source_type,
  p.source_proposal_version_id, p.source_deal_id, p.source_voucher_id,
  p.status, p.valid_from, p.valid_until, p.activated_at,
  i.id, i.service_id, i.service_name_snapshot, i.quantity_granted,
  i.unit_label_snapshot, i.commercial_value_snapshot,
  p.allow_clinical_extensions, p.clinically_finalized_at, p.clinically_finalized_reason;

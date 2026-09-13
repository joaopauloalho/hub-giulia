-- Um atendimento histórico representa uma sessão realizada.
-- Se a vinculação antiga marcou várias sessões no mesmo atendimento, devolvemos o excesso
-- ao saldo para que cada sessão adicional seja registrada como seu próprio atendimento.

insert into public.patient_credit_ledger(
  user_id,
  patient_id,
  package_id,
  package_item_id,
  movement_type,
  quantity_delta,
  source_type,
  source_id,
  procedure_id_snapshot,
  procedure_item_id_snapshot,
  reason,
  idempotency_key,
  created_by
)
select
  l.user_id,
  l.patient_id,
  l.package_id,
  l.package_item_id,
  'reversal',
  greatest(abs(l.quantity_delta) - 1, 0)::numeric(12,3),
  'legacy_protocol_count_correction',
  l.id,
  l.procedure_id_snapshot,
  l.procedure_item_id_snapshot,
  'Correção: cada sessão do protocolo deve possuir seu próprio atendimento',
  'legacy-one-attendance-one-session:' || l.id::text,
  l.created_by
from public.patient_credit_ledger l
where l.movement_type = 'redeem'
  and l.source_type = 'legacy_protocol_link'
  and l.procedure_id_snapshot is not null
  and l.quantity_delta < -1
  and not exists (
    select 1
    from public.patient_credit_ledger c
    where c.user_id = l.user_id
      and c.idempotency_key = 'legacy-one-attendance-one-session:' || l.id::text
  );

comment on column public.patient_credit_ledger.procedure_id_snapshot is
  'Atendimento associado ao movimento quando aplicável. Em protocolos, uma sessão realizada deve corresponder a um atendimento.';

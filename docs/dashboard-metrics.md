# Hub Giulia 3.3 — Dashboard Metric Contract

## Princípios

- O Dashboard é **read model**, nunca source of truth.
- Timezone clínica: `America/Sao_Paulo`.
- Timestamps usam intervalos `[start, end)`; datas (`date`) usam comparação de calendário.
- **Flow** = evento que aconteceu no período selecionado.
- **Snapshot** = estado atual; não deve mudar apenas porque o filtro de desempenho mudou.
- Caixa, comercial, produção clínica e obrigações de pacotes são conceitos distintos.
- `deal.value`, `proposal.total_value`, ativação de pacote e `package_redemptions` nunca entram em recebido.
- Procedimento coberto por pacote pode entrar em produção clínica, mas não cria novo recebimento.
- Comparação de flow usa período anterior com o mesmo número de dias. Snapshot não recebe comparação temporal artificial.
- Período anterior igual a zero mostra `Novo` ou `0%`; nunca `Infinity`/`NaN`.

## RPCs / leitura

| RPC | Papel | Chamadas |
| --- | --- | --- |
| `get_dashboard_attention_v1` | Snapshot operacional de hoje | Agenda, CRM follow-up, retornos, recebimentos pendentes, propostas e pacotes expirando |
| `get_dashboard_overview_v1` | KPIs de período + snapshots atuais | Financeiro, CRM, propostas, pacotes/créditos, agenda, clínico e retornos |
| `get_dashboard_series_v1` | Série financeira | Recebido bruto/taxas/líquido por dia, semana ou mês |

As três RPCs exigem sessão autenticada. As funções do Dashboard são `SECURITY INVOKER`. A única exceção indireta é Retornos: a tabela `procedure_returns` continua backend-only e as RPCs reutilizam `list_procedure_returns_v2()`, API existente tenant-scoped por `auth.uid()`.

## Hoje / Precisa de atenção

| Key | Label | Tipo | Source of truth | Date field / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `agenda_today_total` | Agenda hoje | Snapshot diário | `appointments` | `scheduled_at` no dia local; count | Hoje fixo | Não | `/agenda?date=YYYY-MM-DD` |
| `agenda_today_confirmed` | Confirmados | Snapshot diário | `appointments` | `status='confirmado'` | Hoje fixo | Não | Agenda |
| `agenda_today_pending` | Pendentes | Snapshot diário | `appointments` | `status='pendente'` | Hoje fixo | Não | Agenda |
| `agenda_today_completed` | Realizados | Snapshot diário | `appointments` | `status='realizado'` | Hoje fixo | Não | Agenda |
| `agenda_today_cancelled` | Cancelados | Snapshot diário | `appointments` | `status='cancelado'` | Hoje fixo | Não | Agenda |
| `agenda_today_no_show` | No-show | Snapshot diário | `appointments` | `status='nao_compareceu'` | Hoje fixo | Não | Agenda |
| `next_appointment` | Próximo atendimento | Snapshot | `appointments` + `patients` + `services` | primeiro `pendente/confirmado` entre agora e fim do dia | Hoje fixo | Não | Agenda |
| `followups_overdue` | Follow-ups atrasados | Snapshot | `crm_followups` | `status='open' AND due_on < today` | Não | Não | `/crm?followup=overdue` |
| `followups_today` | Follow-ups hoje | Snapshot | `crm_followups` | `status='open' AND due_on=today` | Não | Não | CRM |
| `returns_overdue` | Retornos atrasados | Snapshot | `list_procedure_returns_v2()` | aberto, não dispensado/concluído/agendado; `window_end < today` | Não | Não | `/retornos?attention=overdue` |
| `returns_today` | Retornos na janela hoje | Snapshot | API de retornos | aberto e `window_start <= today <= window_end` | Não | Não | Retornos |
| `returns_upcoming` | Retornos próximos | Snapshot | API de retornos | `today < window_start <= today+7` | Não | Não | Retornos |
| `payment_overdue_value` | Recebimentos vencidos | Snapshot | `procedure_payments` + `package_payments` | `paid_at IS NULL AND scheduled_date < today`; sum `amount` | Não | Não | `/financeiro?status=pending` |
| `payment_today_value` | Recebimentos para hoje | Snapshot | pagamentos | `paid_at IS NULL AND scheduled_date=today` | Não | Não | Financeiro |
| `proposals_expiring` | Propostas expirando | Snapshot | `treatment_proposal_summary_v` | `effective_status='issued'`, `valid_until` nos próximos 7 dias | Não | Não | `/crm?proposal=expiring` |
| `packages_expiring` | Pacotes expirando com saldo | Snapshot | `patient_credit_item_balances_v` | `effective_status='active'`, `available_balance>0`, `valid_until` próximos 7 dias | Não | Não | `/pacotes?status=available` |

## Financeiro / Caixa

| Key | Label | Tipo | Source of truth | Date field / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `received_gross` | Recebido bruto | Flow | `procedure_payments` + `package_payments` | `paid_at`; sum `amount` apenas `paid_at IS NOT NULL` | Sim | Sim | Financeiro no período |
| `fees` | Taxas | Flow | pagamentos pagos | `paid_at`; sum `fee_value` | Sim | Não no card principal | Financeiro |
| `received_net` | Recebido líquido | Flow | pagamentos pagos | `paid_at`; sum `net_amount` canônico | Sim | Sim | Financeiro |
| `pending_value` | A receber / pendente | Snapshot | pagamentos de procedimento + pacote | `paid_at IS NULL`; sum `amount` | Não | Não | Financeiro pendente |
| `overdue_value` | Pendente vencido | Snapshot | pagamentos não pagos | `scheduled_date < today`; sum `amount` | Não | Não | Financeiro pendente |
| `received_series` | Recebido ao longo do tempo | Flow | pagamentos pagos | bucket local de `paid_at`; gross/fee/net | Sim | Não | Financeiro |

### Exclusões financeiras obrigatórias

Não entram em `received_gross`, `fees` ou `received_net`:

- `deals.value`;
- valor de proposta emitida/enviada/aceita;
- `patient_packages.commercial_total_snapshot` sem pagamento;
- grant de crédito;
- `package_redemptions`;
- `patient_credit_ledger`;
- valor de `procedure_items` coberto por pacote.

## CRM

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `new_leads` | Novos leads | Flow | `contacts` | count por `created_at` | Sim | Sim | CRM |
| `new_opportunities` | Novas oportunidades | Flow | `deals` | count por `created_at` | Sim | Sim | CRM |
| `won` | Ganhos | Flow | `deals` | count por `won_at` | Sim | Sim | CRM |
| `lost` | Perdidos | Flow | `deals` | count por `lost_at` | Sim | Não no card principal | CRM |
| `conversion_rate` | Conversão de fechados | Flow | `deals` | `won / (won + lost) * 100` para fechados no período | Sim | Não | CRM |
| `pipeline_open_count` | Oportunidades abertas | Snapshot | `deals` | stages diferentes de `won/lost` | Não | Não | CRM |
| `pipeline_open_value` | Valor do pipeline aberto | Snapshot | `deals` | sum `value` somente stages abertos | Não | Não | CRM |
| `pipeline_funnel` | Funil aberto | Snapshot | `deals` | counts `new/contacted/assessment_scheduled/proposal_sent/negotiation` | Não | Não | CRM |

`pipeline_open_value` é potencial comercial e **não é receita**.

## Propostas

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `proposals_issued` | Emitidas | Flow | `treatment_proposal_summary_v` | `issued_at` | Sim | Não | CRM/Propostas |
| `proposals_sent` | Enviadas | Flow | summary | `sent_at` | Sim | Não | CRM/Propostas |
| `proposals_accepted` | Aceitas | Flow | summary | `accepted_at` | Sim | Contagem disponível | CRM/Propostas |
| `proposals_declined` | Recusadas | Flow | summary | `declined_at` | Sim | Não | CRM/Propostas |
| `proposals_expired` | Expiradas | Flow calendário | summary | effective status `expired`, `valid_until` dentro do período | Sim | Não | CRM/Propostas |
| `accepted_value` | Valor aceito | Flow | summary | sum `total_value` onde `accepted_at` está no período | Sim | Sim | CRM/Propostas |
| `proposal_conversion_rate` | Conversão de propostas | Flow | summary | `accepted / (accepted + declined) * 100` | Sim | Não | CRM/Propostas |

`accepted_value` **não é recebido**.

## Pacotes & Créditos

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `packages_activated` | Pacotes ativados | Flow | `patient_packages` | `activated_at` | Sim | Sim | `/pacotes` |
| `credits_granted` | Créditos concedidos | Flow | `patient_credit_ledger` | `movement_type='grant'`; sum `quantity_delta` por `created_at` | Sim | Sim | Pacotes |
| `credits_redeemed` | Créditos consumidos | Flow | ledger canônico | `movement_type='redeem'`; `-sum(quantity_delta)` por `created_at` | Sim | Sim | Pacotes |
| `credits_available` | Créditos disponíveis | Snapshot | `patient_credit_item_balances_v` | sum `available_balance` | Não | Não | Pacotes disponíveis |
| `available_packages` | Pacotes com saldo | Snapshot | balances | count distinct `package_id` com saldo > 0 | Não | Não | Pacotes |
| `available_items` | Serviços com saldo | Snapshot | balances | count itens com saldo > 0 | Não | Não | Pacotes |

Créditos de serviços diferentes podem ser somados como volume operacional, mas o drilldown por pacote/serviço é necessário para interpretar a obrigação de atendimento.

## Agenda

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `appointments` | Agendamentos | Flow | `appointments` | count `scheduled_at` | Sim | Não | Agenda no período |
| `appointments_completed` | Concluídos | Flow | `appointments` | `status='realizado'`, `scheduled_at` | Sim | Não | Agenda |
| `appointments_cancelled` | Cancelados | Flow | `appointments` | `status='cancelado'` | Sim | Não | Agenda |
| `appointments_no_show` | No-show | Flow | `appointments` | `status='nao_compareceu'` | Sim | Não | Agenda |
| `attendance_rate` | Taxa de comparecimento | Flow | `appointments` | `realizado / (realizado + nao_compareceu) * 100` | Sim | Taxa anterior disponível | Agenda |

Pendentes, confirmados e agendamentos futuros não entram no denominador da taxa de comparecimento.

## Produção clínica

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `clinical_attendances` | Atendimentos | Flow | `procedures` | count por `performed_at` | Sim | Sim | Histórico clínico |
| `clinical_production_value` | Produção clínica | Flow | `procedures` + `procedure_items` | sum `procedure_items.final_price` de procedures por `performed_at` | Sim | Sim | Histórico |
| `clinical_service_units` | Serviços/unidades realizados | Flow | `procedure_items` | sum `qty` | Sim | Não | Histórico |
| `top_services` | Top procedimentos/serviços | Flow | `procedure_items` snapshots | group por `procedure_items.name`, sum `qty`/`final_price` | Sim | Não | Histórico |

`clinical_production_value` pode incluir atendimento coberto por pacote. O label nunca deve ser “Faturamento”. O uso de `procedure_items.name` preserva histórico mesmo se o catálogo for renomeado.

## Retornos

| Key | Label | Tipo | Source | Date / fórmula | Período? | Comparação? | Drilldown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `returns_completed` | Retornos concluídos | Flow | API de retornos | count por `completed_at` | Sim | Sim | `/retornos` |

CRM follow-up e retorno clínico continuam entidades diferentes.

## Métricas deliberadamente não implementadas no 3.3

- **Vendido:** ainda não exibido no Dashboard até existir contrato único para venda avulsa + venda de pacote que não conte procedimento coberto novamente.
- **Ticket médio:** não exibido porque venda, recebimento e procedimento têm denominadores diferentes.
- **Taxa de ocupação:** não exibida porque não existe fonte canônica suficiente de working hours/disponibilidade total.
- **Lucro:** removido do Dashboard principal; requer contrato completo entre caixa, competência e custo antes de voltar.
- **Forecast / IA / lead scoring:** fora do escopo do 3.3.

## Invariantes de aceite

1. Procedure R$ 1.000 + pagamento R$ 1.000 pago => recebido R$ 1.000.
2. Procedure R$ 1.000 + R$ 500 pago + R$ 500 pendente => recebido R$ 500; pendente R$ 500.
3. Package R$ 3.000 pago + três redemptions => recebido continua R$ 3.000.
4. Deal R$ 5.000 sem pagamento => pipeline R$ 5.000; recebido R$ 0.
5. Proposal aceita R$ 5.000 sem pagamento => valor aceito R$ 5.000; recebido R$ 0.
6. Package ativa com 3 créditos sem pagamento => créditos concedidos 3; recebido R$ 0.
7. Procedure coberto por package => produção clínica inclui o procedure; recebido não aumenta.
8. Pagamento 00:30 UTC cai no dia calendário correto de São Paulo.
9. Tenant A nunca recebe agregados do Tenant B.
10. Período anterior zero nunca gera `Infinity`/`NaN`.

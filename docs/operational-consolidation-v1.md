# Hub Giulia 3.9 — Consolidação Operacional

## Objetivo

Fazer o Hub parecer menor: menos caminhos paralelos para a mesma obrigação, mais contexto e uma única resposta para “o que exige ação humana agora?”. Nenhum novo source of truth foi criado.

## Responsabilidade canônica dos módulos

| Módulo | Responsabilidade 3.9 |
|---|---|
| Hoje / Dashboard | Resumo operacional + desempenho. Não vira fila fonte. |
| Agenda | Quem e quando. Source: `appointments`. |
| Comunicação | O que precisa de contato. Continua ação/mensagem, não relacionamento. |
| Relacionamento | Quem merece atenção e por quê. Fila por pessoa. |
| Aftercare | Acompanhamento pós-procedimento. |
| Returns | Retorno clínico. |
| Patient 360 | Histórico e contexto da pessoa. |
| Modo Atendimento | Execução contextual do atendimento. |
| CRM | Lead/funil comercial. |

## Auditoria pré-3.9

### P0

Nenhum P0 de corrupção de dados foi encontrado na amostra real auditada. Ownership cruzado em pacientes/agendamentos/procedimentos e referências estruturais testadas retornaram zero ocorrências.

### P1

1. Dashboard tinha contagem/lista de atenção separada de Communication/Aftercare/Relationship, com risco de números divergentes.
2. Dashboard também exibia dois atalhos flutuantes paralelos (Communication + Relationship), criando uma segunda forma de “fila invisível”.
3. Próximo atendimento no Dashboard levava à Agenda mesmo quando a ação óbvia era iniciar o atendimento.
4. Relationship → Patient perdia filtro/pessoa ao voltar.
5. Modo Atendimento mostrava módulos e fatos, mas não tinha uma regra única de próxima ação pós-procedimento.

### P2

1. Sidebar cresceu até destacar módulos contextuais como `Registrar` no mesmo nível de Hoje/Agenda/Pacientes.
2. Patient 360 tinha várias quick actions com aparência de CTA principal concorrente.
3. Pós-atendimento, retorno e relacionamento podiam aparecer em áreas diferentes sem uma camada única de supressão visual.
4. Dashboard ainda consultava read models antigos de atenção além dos módulos 3.4–3.8.

## Central de Atenção

`operational_attention_v1` é um read model. As fontes continuam canônicas:

- `communication_attention_v1` para confirmação, CRM follow-up, retorno, proposta e crédito;
- `aftercare_communication_attention_v1` para aftercare;
- Relationship 3.8 somente para reativação residual, por bridge owner-scoped.

### Prioridade factual

1. retorno clínico atrasado: 900;
2. revisão profissional aftercare: 880;
3. retorno clínico do dia: 850;
4. aftercare atrasado: 840;
5. aftercare do dia: 800;
6. confirmação de agenda do dia: 760;
7. comunicação operacional: 620–700;
8. proposta/crédito: 320–500;
9. reativação comercial residual: 200.

Valor financeiro nunca sobe prioridade. `pending_payment` aparece apenas como fato no resumo do dia.

### Deduplicação

- chaves determinísticas vêm dos sources (`item_key` / `opportunity_key`);
- uma mesma `attention_key` fica uma vez;
- reativação de Relationship é suprimida quando a mesma paciente já possui attention operacional canônica;
- nenhum source é apagado ou marcado automaticamente.

### Counts

`get_operational_attention_counts_v1()` conta exatamente `operational_attention_v1`, a mesma view da lista. Não há query paralela para o badge.

## Próxima ação

`get_patient_next_action_v1(patient_id, appointment_id)` é a única regra usada pelo Patient 360 e Modo Atendimento.

Ordem principal:

1. appointment de hoje ainda sem procedure;
2. maior attention factual da paciente;
3. próximo appointment futuro ainda sem procedure.

Depois que já existe procedure para o appointment, o mesmo horário é excluído para evitar “Iniciar atendimento” depois do procedimento.

## Navegação

### Mobile

Mantidos cinco destinos: Hoje, Agenda, Comunicação, Pacientes, Mais. Relationship e Saúde do Hub ficam em Mais. Nenhuma lotação nova da bottom nav.

### Desktop

Ordem orientada à operação: Hoje, Agenda, Comunicação, Relacionamento, Pacientes, CRM, Retornos, Financeiro, Saúde, Catálogo. `Registrar` deixou de ser item de primeira linha porque é predominantemente contextual, mas a rota/deep link continua válida e permanece no menu Mais do mobile.

### Contexto Relationship

Categoria, busca, snoozed, página e pessoa selecionada são serializados na URL. Ao abrir uma Patient, `return_to` preserva esse estado.

## Medição de atrito

Contagem feita sobre os caminhos/rotas do código antes/depois; não é telemetria de usuários.

| Fluxo | Antes | Depois | Resultado |
|---|---:|---:|---|
| Hoje → iniciar atendimento | ~3 ações (Dashboard → Agenda → appointment/atendimento) | 1 CTA | ação direta quando confirmado |
| Patient → WhatsApp | 1 | 1 | mantido; não havia atrito a eliminar |
| Relationship → Patient → voltar | 2, mas voltava sem contexto confiável | 2 | mesma quantidade, contexto preservado |
| Procedure → pós/return | ~2 context switches | 1 próxima ação principal | regra compartilhada |
| Dashboard → resolver attention | ~2 (card/atalho → módulo → item) | 1 | item consolidado abre rota canônica |

## Fora de escopo deliberado

Sem IA, WhatsApp automático, patient merge, auto-fix clínico/financeiro, novo CRM, novo Dashboard, estoque, cron ou BI novo.

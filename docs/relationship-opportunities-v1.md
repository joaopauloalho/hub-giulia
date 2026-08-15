# Hub Giulia 3.8 — Retenção, Reativação & Oportunidades

## Princípio

**Hub encontra. Giulia decide.** Relacionamento é uma leitura por pessoa, não um segundo CRM nem uma segunda Central de Comunicação. Nenhuma oportunidade envia mensagem, altera fonte canônica, consome crédito ou modifica financeiro.

## Identidade

- `patients.id` é a identidade canônica de paciente.
- `contacts.patient_id` consolida contato convertido no paciente.
- Contato sem `patient_id` continua uma pessoa `contact` quando há oportunidade comercial real.
- Não existe merge heurístico por nome, telefone ou e-mail.

## Fontes de verdade

- Retornos: `procedure_returns`.
- Propostas: `treatment_proposals` + versão mais recente de `treatment_proposal_versions`.
- Créditos: `patient_credit_item_balances_v`/ledger; saldos são preservados por item e `unit_label_snapshot`.
- Agenda futura: `appointments` com `pendente`/`confirmado`.
- Último atendimento: `procedures.performed_at`; somente quando a paciente nunca possuiu procedure é usado fallback factual de appointment `realizado`.
- Último contato: `communication_messages.status='sent_manual'` + `crm_activities.activity_type='contact'` sem `communication_message_id` (espelhos da Comunicação são deduplicados).
- Pós-atendimento: 3.7 apenas como supressão de reativação, nunca como oportunidade comercial.

## Oportunidades derivadas

Nenhuma tabela de oportunidades é materializada. `relationship_opportunity_sources_v1` deriva dinamicamente:

1. retorno aberto (`completed_at`/`dismissed_at` nulos), dentro da janela operacional do Returns;
2. última versão de proposta `issued`, realmente marcada como enviada, não expirada e após a janela de follow-up existente da Comunicação 3.4;
3. pacote ativo com saldo real positivo por item e validade dentro da janela existente `package_expiry_days`;
4. reativação de paciente que já teve atendimento e ultrapassou o limite configurável.

Chaves estáveis: `return:<id>`, `proposal:<version_id>`, `package:<package_id>:expiry`, `reactivation:<patient_id>`.

## Supressões

- snooze por pessoa reutiliza `communication_attention_state` com `relationship:patient:<id>` ou `relationship:contact:<id>`;
- reativação não aparece com appointment futuro, aftercare operacional ativo, retorno aberto, contato recente ou sem histórico real de atendimento;
- pacientes/contatos arquivados não aparecem;
- proposta terminal/expirada desaparece pela própria source;
- saldo zero/expirado desaparece pela própria source;
- retorno concluído/dispensado desaparece pela própria source.

## Preferências

`relationship_preferences` é por `user_id` e possui somente toggles, `reactivation_after_days` e um cooldown simples de contato recente. As janelas de proposta e pacote continuam pertencendo a `communication_preferences`, evitando configuração duplicada.

## Comunicação

Abrir WhatsApp ou copiar texto não é contato. Um contato só entra em `last_contact_at` quando a profissional confirma explicitamente o registro. Retorno/proposta/pacote reutilizam `record_manual_communication_v1`; reativação usa `record_relationship_manual_contact_v1`, que grava na mesma `communication_messages` e espelha no CRM apenas quando existe contato canônico vinculado.

## Segurança e privacidade

`relationship_preferences` tem RLS. Views internas não têm grant para `authenticated` ou `anon`. RPCs públicos ao app são `SECURITY DEFINER` apenas porque algumas sources existentes são RPC-only; usam `auth.uid()`, `search_path` fixo e filtragem de ownership em todas as CTEs. `anon` não executa os RPCs. O read model não retorna CPF, anamnese, diagnóstico, fotos, contratos ou notas clínicas.

## Performance

A lista é paginada no servidor (default 50, máximo 100), busca é limitada a 80 caracteres e filtros são server-side. O read model usa os índices já existentes de procedures, appointments, communication messages, CRM activities, Returns, proposals e packages; não foi criado índice duplicado.

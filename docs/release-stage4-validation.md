# Validação de lançamento — Etapa 4

- Consentimento explícito na ficha; nenhum opt-in implícito em pacientes legadas.
- Revogação remove pacientes do Relacionamento e da fila Hoje.
- Mensagens comerciais sem dados de saúde e RPC bloqueada para anon.
- Testes: `e2e/relationship-today-consent.spec.ts` e contrato SQL de consentimento.

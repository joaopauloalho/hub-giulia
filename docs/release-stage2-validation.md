# Validação de lançamento — Etapa 2

- Banco: vouchers há mais de 21 dias e manutenção por serviço, separados da revisão clínica.
- Preços: média histórica por procedimento e fallback ao catálogo.
- Segurança: auth.uid() e privilégio de execução somente para authenticated.
- Testes: `supabase/tests/relationship_stage2_contract.sql` e Playwright isolado.

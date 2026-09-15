-- Restaura explicitamente o modelo de segurança original da view de créditos.
-- CREATE OR REPLACE VIEW pode substituir as opções da view; esta migration garante que
-- as políticas RLS das tabelas base continuem sendo avaliadas para o usuário chamador.

alter view public.patient_credit_item_balances_v set (security_invoker = true);

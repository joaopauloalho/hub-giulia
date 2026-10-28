# Etapa 5 — investigação de desempenho, 28/10/2026

## Observações confirmadas (somente leitura)
- Produção tem índices compostos em `procedures(user_id,patient_id,performed_at desc,id desc)` e `appointments(user_id,patient_id,scheduled_at)`. Não criar duplicatas.
- `procedure_items` possui índices nas combinações `(user_id,procedure_id)` e `(user_id,service_id)`. Já existem índices de `crm_activities` por pessoa/data e `communication_messages` por paciente/data.
- Histórico 360 é carregado por `list_patient_timeline_v6` e visão geral por `get_patient_360_overview_v2`, separados. O carregamento do resumo comercial no painel da paciente começa em paralelo e não está bloqueando o render inicial por `await`.
- A implementação mantém carregamento sob demanda para dados clínicos; o bundle JavaScript da aba Histórico 360 agora é pré-carregado com a ficha aberta para eliminar uma etapa serial no primeiro acesso à aba.

## Lacunas de medição
Não foi possível executar navegação instrumentada real nem calcular o p95 de latência por RPC no ambiente do usuário. Sem um benchmark reproduzível, seria incorreto afirmar que os 3–7 segundos e os 10 segundos foram resolvidos.

## Reproduzir antes do merge
1. Abrir DevTools > Network com *Disable cache*, autenticar e cronometar cada rota, separando bundle, RPC e render.
2. Medir `list_patient_timeline_v6` e `get_patient_360_overview_v2` no Supabase SQL `EXPLAIN (ANALYZE, BUFFERS)` em clone de testes (sem PHI em logs).
3. Registrar p50/p95 e número de requisições. Comparar os mesmos cenários com a branch da etapa 5.
4. Se a lentidão for no banco, adicionar somente índices direcionados a queries medidas, não redundantes; testar `auth.uid()`/RLS e planos com cardinalidades realistas.
5. Verificar redes móveis e warm/cold startup, pois o banco tem baixo volume e o gargalo pode estar no carregamento do cliente.

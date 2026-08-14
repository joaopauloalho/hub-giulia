# Injetáveis 2.0

O módulo registra **o que foi feito** em uma aplicação injetável; ele não sugere dose, diagnóstico, indicação clínica ou conversão de unidades.

## Modelo

- `injectable_maps`: cabeçalho do mapa anatômico e lifecycle (`draft`, `finalized`, `voided`).
- `injectable_products`: catálogo atual de produto/substância e unidade padrão.
- `injectable_product_lots`: lote e validade opcionais.
- `injectable_applications`: snapshot histórico do produto/lote/unidade usado em uma sessão.
- `injectable_application_points`: coordenada normalizada, quantidade, unidade snapshot, região/lado/nota.

O histórico não é reconstruído a partir do catálogo atual. Registros finalizados são somente leitura.

## Atendimento

O frontend mantém draft persistente com `revision`. O RPC `create_procedure_with_injectable_draft_v2` chama o atendimento atômico existente e finaliza o mapa na mesma transação PostgreSQL. A finalização resolve `procedure_item_id`, deriva totais em `NUMERIC` e é idempotente.

## Legado

Os mapas antigos continuam em `injectable_maps.points` como `source_type = legacy`, sem inventar produto, lote ou unidade que não tenham sido originalmente registrados.

## Segurança

Todas as tabelas v2 usam RLS e ownership por `user_id`; `anon` não possui acesso. FKs compostas impedem vínculo cross-tenant e lote de produto incorreto. Mutações críticas após `finalized` são bloqueadas.

# Hub Giulia 3.5 — Auditoria de Experiência Operacional

Base auditada: `main` em `7c0cb49694c7c7b8a9f9624340d597f32ed815e5` (Hub Giulia 3.4 em produção).

## Escopo e princípios

Esta auditoria trata UX, orquestração, responsividade, performance e PWA. Agenda, CRM, Anamnese, Procedimentos, Injetáveis, Contratos, Pacotes, Pagamentos e Retornos continuam sendo as fontes de verdade. O Modo Atendimento não cria prontuário, sessão clínica ou estado financeiro paralelo.

## Achados prioritários

### P0

Nenhum P0 de integridade encontrado na leitura de código e schema. As operações críticas existentes já possuem ownership/RLS e os fluxos financeiros/procedurais não precisam ser reescritos para este pacote.

### P1

1. **Mobile navigation comprimida:** a bottom bar tem 9 destinos, inadequada para iPhone e toque frequente.
2. **Sem busca global:** localizar paciente/lead exige entrar no módulo e repetir busca.
3. **Sem Modo Atendimento:** Agenda abre diretamente Registrar, sem manter contexto para Anamnese, Fotos, Contratos, Injetáveis, Pagamento e Retorno.
4. **Patient 360 não possui deep link canônico:** o detalhe é um drawer controlado por estado; existe compatibilidade por `?patient_id=`, mas `/pacientes/:id` ainda não é rota.
5. **PWA inexistente:** sem manifest, service worker, ícones, install UX ou política explícita de cache privado.
6. **Safe area incompleta:** há `safe-area-inset-bottom` em alguns componentes, mas viewport não usa `viewport-fit=cover`, shell/topo não trata todos os insets e alguns elementos fixos não têm política consistente.
7. **Sem estado global de rede:** falha de conexão aparece apenas quando cada request falha; não há indicador discreto e previsível.
8. **Responsividade baseada em `matchMedia` não reativo em Agenda:** rotação/redimensionamento pode manter decisões de layout antigas até novo mount.
9. **Contexto de volta inconsistente:** Agenda → Paciente/Registrar passa parte do contexto, mas o restante dos módulos não compartilha uma rota operacional persistente.
10. **Update safety inexistente:** como não há SW hoje, também não há política que impeça reload de nova versão no meio de trabalho.

### P2

- `full-loader` ainda é usado como fallback de rota, apesar de vários módulos já terem skeleton contextual.
- O shell possui estilos duplicados de botão (`.btn*` e `.btn-primary/.btn-secondary`). Não será feita reescrita ampla neste pacote; novos componentes usam o padrão `.btn`.
- Alguns drawers/modais usam `vh` em vez de `dvh` e podem criar altura desconfortável com teclado/barras do navegador.
- Patient 360 tem muitas ações no mesmo nível visual; a ação contextual de atendimento deve ganhar hierarquia quando houver appointment.
- Sidebar compacta funciona em tablet, mas precisa de safe area no topo e catálogo de destinos coerente com a navegação mobile.
- Tabelas e grids de CRM/Financeiro dependem de CSS específico; touch não deve depender de hover. A correção deste pacote será de shell/overflow e não uma reescrita dos módulos.

### P3

- Pequenas diferenças de radius/spacing e labels entre módulos.
- Alguns estados vazios usam apenas texto e outros usam ícone + ação.
- Polimento de transições e microcopy pode continuar após uso real no iPad.

## Mapa de rotas auditado

| Rota | Função | Desktop/iPad/mobile | Estado observado | Prioridade 3.5 |
|---|---|---|---|---|
| `/login` | autenticação | responsivo, `100dvh` já existe | sem PWA/safe-area completa | P1 PWA |
| `/dashboard` | Hoje + performance | layout rico e responsivo | já possui atenção, próximo appointment e skeletons | preservar; adicionar ações globais no shell |
| `/agenda` | Agenda 2.0 | dia/semana/mês | drawer grande adequado, busca local; `matchMedia` não reativo | P1 atendimento/contexto |
| `/comunicacao` | Comunicação 3.4 | responsivo | source of truth consolidada | regressão apenas |
| `/crm` | CRM 2.0 | board + mobile layout | dirty guard já existe no modal de lead | integrar busca global sem duplicar CRM |
| `/crm/deals/:dealId/proposals/:proposalId` | editor de proposta | rota própria/lazy | domínio próprio | regressão/dirty behavior existente |
| `/pacientes` | lista + Patient 360 drawer | touch-friendly | detalhe depende de estado/query param | P1 deep link |
| `/pacientes/:id` | inexistente antes do 3.5 | — | refresh/back não canônico | criar alias canônico |
| `/pacientes/:patientId/anamnese` | Anamnese 2.0 | rota lazy | autosave/server-side draft existente | reutilizar no atendimento |
| `/registrar` | procedimento/pagamento | fluxo em etapas | já aceita `patient_id`, `appointment_id`, `service_id`; bloqueia double submit por `saving` | reutilizar, não alterar semântica |
| `/financeiro` | financeiro | rota lazy | domínio maduro | regressão e overflow/touch |
| `/retornos` | Retornos 2.0 | rota lazy | API canônica/backend-only | linkar, não duplicar |
| `/pacotes` | pacotes/créditos | rota lazy | consumo atômico existente | regressão |
| `/catalogo` | serviços/configurações operacionais | rota lazy | settings dispersos aqui | manter; não criar settings artificiais |
| `/catalogo/acompanhamentos` | configuração de retornos | rota lazy | domínio existente | regressão |
| `/atendimento/:appointmentId` | inexistente antes do 3.5 | — | lacuna operacional | criar orquestrador |

## Design system / shell

Componentes existentes localizados: Button/padrões `.btn`, Input/fields, Modal, ConfirmModal, Skeleton, Toast e drawers por classes compartilhadas. Não criar variantes paralelas de Button/Input. Novas telas devem usar `btn`, `field-input`, `card`, `badge`, `drawer`/layout existentes e acrescentar somente classes operacionais no CSS do 3.5.

## PWA antes do 3.5

- manifest: inexistente
- service worker: inexistente
- plugin PWA: inexistente
- ícone atual: `/vite.svg` (branding incorreto)
- viewport: sem `viewport-fit=cover`
- deep route Vercel: já protegido por rewrite SPA `/(.*) -> /index.html`
- agent previews: já desativados por `git.deploymentEnabled.agent/** = false`

## Segurança / Supabase antes do 3.5

RLS confirmada em `patients`, `contacts`, `deals`, `appointments`, `services`, `procedures`, `patient_photos`, `contracts`, `procedure_payments`, `injectable_maps` e Anamnese. `procedure_returns` permanece backend-only e não deve ser contornada pelo frontend.

Security Advisor possui warnings pré-existentes de funções `SECURITY DEFINER` autenticadas e proteção contra senha vazada desabilitada. Esses itens não serão alterados neste pacote sem necessidade de domínio. Performance Advisor possui FKs sem índice e índices ainda sem uso principalmente no domínio de pacotes/créditos; não remover índices nem alterar finanças por uma auditoria de UX.

## Estratégia de implementação

1. Shell com busca global, indicador de rede, update/install PWA e safe-area.
2. Bottom navigation com 5 destinos: Hoje, Agenda, Comunicação, Pacientes, Mais.
3. RPC `search_hub_v1` `SECURITY INVOKER`, com `auth.uid()`, somente pacientes/contatos/deals e sem notas/anamnese/CPF.
4. RPC `get_attendance_context_v1` `SECURITY INVOKER`, apenas contexto factual do appointment próprio.
5. `/atendimento/:appointmentId` como orquestrador; módulos continuam source of truth.
6. `/pacientes/:patientId` como deep link canônico compatível com o drawer atual.
7. PWA com cache apenas do shell/artefatos estáticos seguros. Supabase, PDFs, fotos clínicas e respostas privadas nunca entram em runtime cache.
8. SW em modo update controlado: worker em espera até ação explícita.
9. CSS operacional aditivo para iPad/iPhone sem reescrever o design atual.
10. Testes unitários para search parsing, navegação/contexto, PWA policy e helpers de dirty/update.

## Performance baseline

- O roteamento principal já usa `React.lazy`, inclusive Dashboard, Agenda, Comunicação, CRM, Propostas, Patient/Anamnese, Registrar, Financeiro, Pacotes e Catálogo.
- Injetáveis dentro de Registrar também já é lazy.
- `@react-pdf/renderer` está instalado; o editor de Proposta já é uma rota lazy, evitando carregar a rota no login/agenda.
- CI 3.4 passou em ~43 s total; build em ~10 s no job `validate` da branch 3.4.
- Não será adicionada uma segunda biblioteca de query/cache; TanStack Query existente permanece a única cache library de aplicação.

## Critério de não regressão

Nenhuma alteração deste pacote pode mudar cálculo de receita, consumo de crédito, criação de payment/procedure, status canônico da Agenda, semântica de comunicação manual, finalização de Anamnese/Contrato/Injetáveis ou APIs de Retornos. O atendimento apenas encaminha contexto por URL e lê status factual.
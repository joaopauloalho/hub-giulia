# Hub Giulia — Design Spec
**Data:** 2026-05-16  
**Status:** Aprovado pelo usuário

---

## Contexto

Sistema de gestão para clínica de estética da Giulia. Substitui o projeto atual (que será deletado). App usado 100% no iPad, com foco em agilidade durante atendimentos.

---

## Decisões aprovadas

| Decisão | Escolha |
|---|---|
| Dispositivo | iPad (100%) |
| Navegação | Abas na parte de baixo (padrão iOS) |
| Visual | Rose & Quente — branco + rosa/blush |
| Tech | Projeto novo do zero — Vite + React + TypeScript + Supabase |
| Dados | Supabase (Postgres + Storage) — zero localStorage |

---

## Módulos (escopo aprovado)

5 módulos core + contratos digitais:

1. **Pacientes & Anamnese** — cadastro, ficha completa, fotos, pacientes anteriores
2. **Catálogo de Serviços** — produtos, combos, planos, ficha técnica, custeio por unidade
3. **Procedimentos Realizados** — histórico de atendimentos, valor x custo
4. **Financeiro** — recebimentos, PIX parcelado com lembretes, simulador de maquininha
5. **Agenda & Agendamento** — agenda do dia, novo agendamento, regras de retorno por procedimento
6. **Contratos digitais** — assinatura com dedo no iPad, PDF gerado e salvo na ficha do paciente

Fora do escopo desta versão (fase futura): Estoque, CRM/Resgates, Documentos PDF de orçamento.

---

## Fluxo principal de atendimento

```
Abre Agenda → Toca no horário → Abre ficha do paciente →
Anamnese (se novo) → Assina contrato no iPad →
Registra atendimento → Seleciona serviço(s) →
Custo calculado automaticamente → Forma de pagamento → Salva
```

---

## Estrutura de navegação — 5 abas

### Aba 1: Agenda (home)
- Agenda do dia com strip de datas (scroll horizontal)
- Cards de agendamento: horário, nome, procedimento, status (confirmado/pendente)
- Toque no card abre ficha do paciente
- FAB para novo agendamento

### Aba 2: Pacientes
- Lista com busca (nome, telefone)
- Ficha do paciente com 5 sub-abas:
  - **Dados**: pessoais, contato, total gasto, data primeiro/último atendimento
  - **Anamnese**: condições médicas, medicamentos, alergias, hábitos, estética
  - **Fotos**: galeria com label e data (Supabase Storage)
  - **Histórico**: lista de procedimentos realizados
  - **Contratos**: PDFs assinados com data
- Botões de ação: "Registrar atendimento" e "Assinar contrato"
- Tela de assinatura: canvas full-screen, paciente assina com dedo, gera PDF

### Aba 3: Registrar
- Seleção de paciente (busca rápida)
- Seleção de serviço(s) do catálogo (múltiplos)
- Cálculo automático: valor cobrado − custo − taxa maquininha = lucro estimado
- Formas de pagamento: Dinheiro, Cartão, PIX, PIX Parcelado
  - PIX Parcelado: define nº de parcelas + datas de vencimento + lembrete
  - Cartão: seleciona % da maquininha, desconta automaticamente do lucro

### Aba 4: Financeiro
- Cards resumo do mês: Receita / Custos / Lucro
- Navegação entre meses
- Lista de PIX parcelados pendentes com alertas de vencimento (vermelho se vencido)
- Histórico de recebimentos

### Aba 5: Catálogo
- Lista de serviços / produtos / combos / planos
- Cada item: nome, tipo, preço de venda, custo, tempo médio
- Ficha técnica (texto livre por serviço)
- Regras de retorno por procedimento: mínimo e máximo de dias
- Templates de contrato (criar e editar textos)
- Configurações de % da maquininha (crédito, débito)

---

## Design System — Rose & Quente

```
Fundo principal:     #ffffff
Fundo secundário:    #fff5f7
Borda / divisor:     #fce7f0
Cor primária:        #be185d
Cor primária clara:  #f9a8d4
Gradiente botão:     linear-gradient(135deg, #f9a8d4, #be185d)
Texto principal:     #1a1a1a
Texto secundário:    #9ca3af
Verde sucesso:       #16a34a
Vermelho alerta:     #ef4444
Amarelo pendente:    #d97706
```

Componentes base: Button (primário/secundário), Input, Card com border-left colorida, Badge/Tag, BottomTabBar, Modal/Drawer, Avatar com iniciais.

---

## Banco de dados — Supabase

```sql
patients        (id, name, birth_date, phone, email, profession, photo_url, notes, created_at)
anamnesis       (id, patient_id, conditions jsonb, medications, allergies, surgical_history, habits jsonb, aesthetics jsonb, updated_at)
patient_photos  (id, patient_id, photo_url, label, taken_at)
services        (id, name, type, price, cost_per_unit, duration_minutes, return_min_days, return_max_days, technical_sheet, active)
appointments    (id, patient_id, service_id, scheduled_at, status, notes, created_at)
procedures      (id, patient_id, appointment_id, performed_at, services_ids jsonb, total_value, total_cost, payment_method, card_fee_pct, card_fee_value, net_value, notes)
pix_installments(id, procedure_id, installment_num, total_installments, amount, due_date, paid_at, reminded_at)
contract_templates(id, name, body, created_at)
contracts       (id, patient_id, template_id, signed_at, signature_data, pdf_url)
```

RLS em todas as tabelas: `auth.uid()` — só a Giulia vê seus dados.

---

## Stack técnica

```
Framework:     Vite + React 18 + TypeScript
Estilo:        Tailwind CSS + CSS custom properties
Roteamento:    React Router v6
Formulários:   React Hook Form + Zod
Backend:       Supabase (Auth, Postgres, Storage)
Data fetching: TanStack Query v5
Ícones:        Lucide React
Datas:         date-fns
Assinatura:    react-signature-canvas
PDF:           @react-pdf/renderer
```

---

## Plano de implementação — 4 fases

### Fase 1 — Fundação + Pacientes
1. Scaffold: Vite + React + TS + Tailwind
2. Supabase: tabelas patients, anamnesis, patient_photos
3. Auth: login/logout
4. Design system: componentes base, bottom tab nav, cores
5. Aba Pacientes: lista, busca, novo paciente, ficha com 5 sub-abas
6. Anamnese completa
7. Upload de fotos (Supabase Storage)
8. Tela de assinatura + geração de PDF + salvar contrato

### Fase 2 — Catálogo + Agenda
1. Tabelas: services, appointments
2. Aba Catálogo: CRUD serviços/combos/planos, ficha técnica, regras de retorno
3. Aba Agenda: strip de datas, cards, novo agendamento
4. Templates de contrato
5. Config de % da maquininha

### Fase 3 — Registrar Atendimento + Financeiro
1. Tabelas: procedures, pix_installments
2. Aba Registrar: fluxo completo (paciente → serviços → custo → pagamento)
3. Simulador de maquininha em tempo real
4. PIX parcelado: parcelas + datas + lembretes
5. Aba Financeiro: resumo mensal, PIX pendentes, histórico

### Fase 4 — Polimento + PWA
1. Histórico de procedimentos na ficha do paciente
2. Alertas visuais de PIX vencido (badge na aba)
3. Estados vazios com ilustrações
4. Animações de transição entre telas
5. PWA: manifest.json + service worker básico (instalável no iPad)

---

## Observações

- **PIX parcelado**: controle manual — Giulia marca como pago quando recebe. Sem integração de pagamento real.
- **Lembretes**: notificação visual no app (badge). WhatsApp/SMS é fase futura.
- **Pacientes anteriores**: campo "data de início" na criação para registrar histórico retroativo.
- **Maquininha**: % configurável (ex: crédito 3%, débito 1.5%) no Catálogo/Config.
- **PWA**: instalar no iPad via Safari → "Adicionar à Tela de Início".

# Design: Planejador de Injetáveis Faciais

**Data:** 2026-05-17  
**Projeto:** hub-giulia  
**Status:** Aprovado

---

## Visão Geral

Ferramenta para a profissional mapear pontos de aplicação de injetáveis (Toxina Botulínica, Ácido Hialurônico, Bioestimulador, etc.) num rosto frontal SVG durante o atendimento. Cada ponto tem substância e quantidade de unidades. Gera relatório de unidades utilizadas e PDF para entregar à paciente.

---

## Fluxo no Registrar

O step "Mapa de Injetáveis" aparece **automaticamente** entre Serviços e Pagamento quando ao menos um serviço com `type === 'injetavel'` está selecionado.

```
Paciente → Serviços → [Mapa de Injetáveis] → Pagamento → Confirmar
```

O step abre em **tela cheia** (`InjetaveisScreen`) — mesmo padrão do `SignatureScreen` existente. Ao salvar, retorna ao fluxo normal com os dados do mapa.

---

## Interface do Mapa (`InjetaveisScreen`)

### Painel de substâncias (topo ou lateral)
- Lista os serviços injetáveis selecionados no atendimento
- Cada substância recebe uma cor automática de uma paleta fixa (rosa, roxo, azul, verde, laranja…)
- Clicar numa substância a define como ativa para o próximo ponto
- A substância ativa fica destacada visualmente
- Toggle "Exibir quantidades" mostra/oculta os números nos pontos

### Rosto SVG (centro)
- Ilustração frontal estática em SVG
- Clique em qualquer área → cria ponto na cor da substância ativa
- Ao criar: mini-input flutuante para digitar a quantidade (ex: `4`)
- Clique em ponto existente → popup para editar quantidade ou deletar
- Coordenadas armazenadas como `x` e `y` relativos ao SVG (0.0–1.0)

### Relatório de unidades (rodapé)
- Uma linha por substância usada: `● Toxina Botulínica — 12 pontos — 48 un`
- Atualiza em tempo real conforme pontos são adicionados/removidos

### Ações
- **Salvar mapa** — confirma e retorna ao fluxo de Registrar
- **Limpar** — apaga todos os pontos (com confirmação)
- **Cancelar** — volta sem salvar

---

## Modelo de Dados

### Nova tabela `injectable_maps`

```sql
create table injectable_maps (
  id           uuid primary key default gen_random_uuid(),
  procedure_id uuid references procedures(id) on delete cascade,
  patient_id   uuid references patients(id) on delete cascade,
  created_at   timestamptz default now(),
  points       jsonb not null default '[]'
);
```

### Estrutura de cada ponto (JSONB)

```json
{
  "x": 0.45,
  "y": 0.32,
  "service_id": "uuid-do-servico",
  "service_name": "Toxina Botulínica",
  "color": "#9b59b6",
  "quantity": 4,
  "unit": "un"
}
```

---

## Aba "Injetáveis" no Perfil da Paciente

Nova aba adicionada ao `PacienteView` entre Histórico e Contratos:

```
Dados | Anamnese | Fotos | Histórico | Injetáveis | Contratos
```

Conteúdo da aba:
- Lista de sessões ordenada por data (mais recente primeiro)
- Cada sessão mostra: data, substâncias usadas e total de unidades por substância
- Botão **Baixar PDF** em cada sessão
- Estado vazio quando não há mapas ainda

---

## Exportação PDF

Gerado client-side com `html2canvas` + `jsPDF`.

### Layout do PDF

```
┌─────────────────────────────────────────┐
│  [Nome da clínica]    Paciente: Ana      │
│  Data: 17/05/2026                        │
├─────────────────┬───────────────────────┤
│                 │  Substância    Total   │
│  [Rosto SVG     │  ● Toxina B.   48 un  │
│   com pontos    │  ● Ácido H.    1,5ml  │
│   coloridos]    │  ● Bioest.     1 un   │
│                 │                        │
├─────────────────┴───────────────────────┤
│  Assinatura: ___________________________│
└─────────────────────────────────────────┘
```

- O rosto SVG com pontos é renderizado via `html2canvas`
- A tabela de unidades é gerada diretamente no `jsPDF`
- Download automático ao clicar "Baixar PDF"

---

## Marcação de Serviços Injetáveis no Catálogo

Para detectar quais serviços ativam o step de mapa, o catálogo precisa identificar serviços injetáveis. A investigação do campo existente na tabela `services` fica para o plano de implementação — pode ser o campo `type` já existente ou um novo `is_injectable: boolean`.

---

## Arquivos a Criar/Modificar

| Arquivo | Ação |
|---|---|
| `src/pages/registrar/InjetaveisScreen.tsx` | Criar — tela cheia do mapa |
| `src/components/InjetaveisFaceMap.tsx` | Criar — SVG + lógica de pontos |
| `src/pages/registrar/RegistrarPage.tsx` | Modificar — inserir step condicional |
| `src/pages/pacientes/PacienteView.tsx` | Modificar — nova aba Injetáveis |
| `src/pages/pacientes/tabs/InjetaveisTab.tsx` | Criar — histórico de mapas |
| `src/hooks/useInjetaveis.ts` | Criar — CRUD Supabase |
| `src/assets/face-front.svg` | Criar — ilustração do rosto |
| `supabase/migrations/XXXX_injectable_maps.sql` | Criar — migration da tabela |

---

## Dependências a Instalar

- `jspdf` — geração de PDF
- `html2canvas` — captura do SVG para imagem no PDF

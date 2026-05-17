# Spec: Google Calendar + WhatsApp Confirmações

**Data:** 2026-05-16
**Projeto:** Hub Giulia
**Status:** Aprovado pelo usuário

---

## Contexto

O Hub Giulia já possui um módulo de agenda completo com agendamentos salvos no Supabase (`appointments`). Os agendamentos têm status (`pendente`, `confirmado`, `realizado`, `cancelado`), horário, paciente (com telefone) e serviço.

Esta feature adiciona dois fluxos:
1. Sincronização dos agendamentos com o Google Calendar da Giulia (Hub → Google, uma via)
2. Botões de WhatsApp pré-preenchidos para envio de confirmação/lembrete ao cliente em 3 momentos

---

## Escopo

### Fora do escopo
- Sincronização bidirecional (Google → Hub)
- Disparo automático de WhatsApp via API (Zapi, Evolution)
- SMS ou email
- Cancelamento de eventos no Google Calendar quando o agendamento é cancelado (fase 2)

---

## Arquitetura

```
Frontend (React SPA)
  ├── Página de Config → botão "Conectar Google Calendar"
  ├── AgendaPage
  │     ├── Seção "Lembretes de amanhã" (colapsável, novo)
  │     └── AppointmentCard → ícone WhatsApp
  └── Modal "Novo Agendamento" → botão pós-save "Enviar confirmação"

Supabase
  ├── Edge Function: google-oauth-callback   (recebe code, salva tokens)
  ├── Edge Function: google-calendar-upsert  (cria evento no Google)
  ├── Tabela: google_calendar_tokens         (tokens por user_id)
  └── Coluna: appointments.google_event_id   (ID do evento criado)
```

---

## Banco de Dados

### Nova tabela: `google_calendar_tokens`
```sql
CREATE TABLE google_calendar_tokens (
  user_id      UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now()
);
-- RLS: somente o próprio user pode ler/escrever
```

### Nova coluna: `appointments.google_event_id`
```sql
ALTER TABLE appointments ADD COLUMN google_event_id TEXT;
```

---

## Edge Functions

### `google-oauth-callback`
- **Trigger:** GET com `?code=...&state=user_id`
- **Ações:**
  1. Troca `code` por `access_token` + `refresh_token` via `POST https://oauth2.googleapis.com/token`
  2. Upsert em `google_calendar_tokens`
  3. Redireciona para `/?google_connected=true`
- **Env secrets necessários:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`

### `google-calendar-upsert`
- **Trigger:** POST com body `{ appointment_id: string }`
- **Ações:**
  1. Lê appointment + patient + service do DB
  2. Lê tokens da tabela; se `expires_at < now + 60s`, faz refresh
  3. Salva token atualizado
  4. Se `google_event_id` já existir, faz PATCH (update); senão, POST (create)
  5. Salva `google_event_id` de volta em `appointments`
- **Evento criado:**
  ```json
  {
    "summary": "💆 {patient.name} — {service.name}",
    "start": { "dateTime": "{scheduled_at}" },
    "end": { "dateTime": "{scheduled_at + duration_minutes}" },
    "description": "Observações: {notes}"
  }
  ```
- **Erro tolerante:** retorna `{ synced: false, error: "..." }` sem lançar exceção; frontend exibe aviso não-bloqueante

---

## Frontend

### 1. Conectar Google Calendar (Config/Settings)

Na página de configuração existente, nova seção "Integrações":
- Botão "Conectar Google Calendar" → gera URL OAuth:
  ```
  https://accounts.google.com/o/oauth2/v2/auth
    ?client_id={GOOGLE_CLIENT_ID}
    &redirect_uri={EDGE_FUNCTION_URL}/google-oauth-callback
    &response_type=code
    &scope=https://www.googleapis.com/auth/calendar.events
    &access_type=offline
    &prompt=consent
    &state={user_id}
  ```
- Se já conectado (token existe): exibe "✅ Google Calendar conectado" + botão "Desconectar"
- Novo hook: `useGoogleCalendar()` → `{ connected, connect, disconnect }`

### 2. Criação de agendamento

Em `useAgenda.create()`: após salvar no Supabase, chama Edge Function `google-calendar-upsert` com o `appointment_id`. Se falhar, não bloqueia — apenas retorna `syncError`.

No modal `NovoAgendamentoModal`, após salvar com sucesso:
- Se `patient.phone` existe: exibe botão "📲 Enviar confirmação via WhatsApp" que abre wa.me
- Se sync do Google falhou: exibe aviso "⚠️ Não foi possível sincronizar com Google Calendar"

### 3. Mudança de status para "Confirmado"

No `AppointmentCard` (já existe em `AgendaPage`), quando `apt.status === 'confirmado'` e `apt.patient?.phone` existe:
- Exibe botão "📲 WhatsApp" diretamente no card, ao lado do badge de status
- Abre wa.me com mensagem de confirmação pré-preenchida
- Não requer navegação para outra tela

### 4. Seção "Lembretes de amanhã"

Na `AgendaPage`, nova seção colapsável posicionada abaixo do DateStrip (antes dos cards do dia selecionado). Segue o mesmo padrão visual de `RetornosSection`.

- Lista todos os agendamentos do dia seguinte
- Cada item exibe: nome, horário, serviço + botão "📲 Enviar lembrete"
- Inicialmente fechada (ao contrário dos Retornos que abrem se há urgentes)

---

## Mensagens WhatsApp (wa.me)

Número formatado: `patient.phone` com apenas dígitos + DDI 55 (ex: `5511999998888`)

### Momento 1 — Criação do agendamento
```
Olá {nome}! 🌸
Seu agendamento está marcado para {dia da semana}, {dd/MM} às {HH:mm}.
Serviço: {serviço}
Qualquer dúvida, é só chamar! ✨
```

### Momento 2 — Status → Confirmado
```
Olá {nome}! ✅
Confirmamos seu agendamento para {dia da semana}, {dd/MM} às {HH:mm}.
Te esperamos! 💆‍♀️
```

### Momento 3 — Lembrete (amanhã)
```
Olá {nome}! 🌷
Lembramos que amanhã você tem consulta às {HH:mm}.
Serviço: {serviço}
Aguardamos você! 😊
```

---

## Utilitário: `buildWhatsAppUrl`

```ts
function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, '');
  const withDDI = digits.startsWith('55') ? digits : `55${digits}`;
  return `https://wa.me/${withDDI}?text=${encodeURIComponent(message)}`;
}
```

---

## Fluxo de Erro — Google Calendar

| Situação | Comportamento |
|---|---|
| Usuário não conectou | Botão "Conectar" na Config; sem tentativa de sync |
| Token expirado | Edge Function faz refresh automaticamente |
| Refresh falhou (revogado) | `connected` volta a `false`; aviso "Reconecte o Google Calendar" |
| Evento criado antes, agendamento editado | Edge Function usa PATCH com `google_event_id` |

---

## Setup necessário (fora do código)

1. Criar projeto no Google Cloud Console
2. Ativar **Google Calendar API**
3. Criar credencial OAuth 2.0 (tipo "Web application")
4. Adicionar `redirect_uri` = `{SUPABASE_URL}/functions/v1/google-oauth-callback`
5. Salvar nos secrets do Supabase:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI`
6. Publicar as duas Edge Functions

---

## Arquivos que serão criados/modificados

| Arquivo | Ação |
|---|---|
| `supabase/functions/google-oauth-callback/index.ts` | Criar |
| `supabase/functions/google-calendar-upsert/index.ts` | Criar |
| `src/hooks/useGoogleCalendar.ts` | Criar |
| `src/lib/whatsapp.ts` | Criar |
| `src/hooks/useAgenda.ts` | Modificar — chamar edge function após `create` |
| `src/pages/agenda/AgendaPage.tsx` | Modificar — seção "Lembretes de amanhã" |
| `src/pages/agenda/AgendaPage.tsx` | Modificar — botão WhatsApp pós-save no modal |
| `src/pages/catalogo/CatalogoPage.tsx` (ou config) | Modificar — seção "Integrações" |
| `src/types/index.ts` | Modificar — `google_event_id` em `Appointment` |

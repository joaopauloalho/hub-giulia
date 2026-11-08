# iCloud no Hub Giulia — conexão segura e primeiro acesso

## O que funciona nesta fase

- A Giulia continua utilizando o app Calendário no iPhone.
- O Hub conecta via CalDAV com e-mail da Conta Apple e senha específica de aplicativo.
- O servidor autentica as credenciais junto à Apple e armazena a senha em Supabase Vault.
- No primeiro acesso, importa eventos **sem alterar** os compromissos do iPhone.
- A clínica pode vincular eventos importados a pacientes cadastradas e converter manualmente
  um evento em agendamento, sem criar um evento duplicado no iCloud.
- O sistema consulta o iCloud ao verificar conflitos de horário. O aviso não impede
  agendar intencionalmente dois horários sobrepostos.

## Cuidados antes de liberar escrita no iCloud

- Revisar o resultado da primeira importação com a proprietária;
- Confirmar no iCloud.com eventos conhecidos (inclusive Ana Akemi, 27/11/2026);
- Testar corretamente fuso horário, recorrência, alterações e cancelamentos;
- Desabilitar o exportador Google quando iCloud estiver conectado;
- Validar que o usuário autenticado não acessa segredos do Vault;
- Garantir idempotência de PUT/DELETE e tratamento seguro de conflitos ETag.

**Nesta PR, `write_enabled` é sempre falso.** O módulo não usa HTTP PUT/DELETE
contra a Apple. Sincronização bidirecional completa somente após validação segura.

## Testes

- CI Vite: Vitest, TypeScript, ESLint e build;
- CI Deno: checagem da Edge Function, parse XML/ICS, recorrência, fusos e SSRF;
- E2E Supabase: schema inteiro, RLS e conversão idempotente de evento importado;
- Smoke real manual com a Conta Apple da clínica, sem colocar credenciais em logs ou chat.

## Deploy verificado em produção

- A migration de conexão foi aplicada em Supabase e sua versão reconciliada no Git.
- A Edge Function `icloud-calendar` foi publicada com verificação JWT.
- Os privilégios das funções de Vault foram conferidos: sem acesso por anon/autenticado.
- Frontend só deve ir para produção depois das validações de CI e do merge.

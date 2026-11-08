# iCloud — fase 1: staging sem risco

A tabela `icloud_calendar_events` armazena cópias de eventos da Apple e
preserva o identificador externo, ETag, UID e recorrência. **Não importa
atendimentos automaticamente** e nunca altera calendários no iPhone.

Verificações pré-merge:
- Migration nova aplicada sem alterar as tabelas clínicas existentes.
- RLS e privilégios por usuário, sem acesso para `anon`.
- Somente `linked_patient_id` pode ser modificado pelo usuário autenticado.
- Eventos pessoais permanecem separados do atendimento clínico.
- Os eventos existentes podem ser vinculados manualmente a uma paciente.
- Nenhum dado Apple ou senha é solicitado por mensagens de chat.

A fase seguinte implementa o conector CalDAV, autenticação e sincronização
em modo somente leitura. A escrita no iCloud fica desabilitada até um smoke
autenticado com a proprietária.

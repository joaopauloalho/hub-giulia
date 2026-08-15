# Hub Giulia 3.9 — Data Quality v1

## Filosofia

Data Quality ajuda a revisar; não corrige automaticamente. `ERROR` é reservado para invariantes estruturais reais. Dado opcional ausente não é tratado como corrupção.

## Severidades

- **ERROR**: referência estrutural impossível no mesmo tenant.
- **WARNING**: provável problema que merece revisão, como possível duplicidade forte ou arquivo referenciado ausente.
- **INFO**: dado incompleto permitido ou resíduo histórico que pode ser revisado sem urgência.

## Regras v1

1. possível duplicidade por CPF normalizado exato (11 dígitos);
2. possível duplicidade por telefone normalizado exato usando o helper canônico da Comunicação;
3. possível duplicidade por e-mail `lower(trim(email))` exato;
4. paciente sem telefone = INFO;
5. nome vazio/muito curto = WARNING;
6. `contacts.patient_id` sem paciente válido do mesmo owner = ERROR;
7. plano aftercare ativo sem procedure snapshot válido = ERROR;
8. task aftercare sem plano válido = ERROR;
9. return com `procedure_id` sem procedure válida = ERROR;
10. DB row de foto/contrato referenciando objeto ausente = WARNING;
11. objeto antigo de Storage do próprio owner sem DB row ativo = INFO.

Não há fuzzy matching de nomes. Nome sozinho nunca confirma nem gera possível duplicidade.

## Possíveis duplicidades

`data_quality_possible_duplicates_v1` compara apenas pacientes ativas do mesmo `auth.uid()`.

A identidade do par é determinística: o menor UUID textual vem primeiro. Assim A–B e B–A são o mesmo `issue_key`.

A comparação mostra somente:

- nome;
- telefone;
- e-mail;
- CPF mascarado;
- nascimento;
- último atendimento;
- `created_at`;
- quais sinais exatos coincidiram.

Anamnese, notas clínicas, fotos e conteúdo contratual não entram na comparação inicial.

## “Não são duplicados”

`data_quality_issue_suppressions` persiste apenas a decisão do owner para o `issue_key` de `possible_duplicate`. Não altera nenhum patient record e não prepara merge automático.

## Storage

Os checks de orphan são lazy na página Saúde do Hub. Objetos só são considerados quando o primeiro segmento do path é o `auth.uid()` atual e possuem mais de 24 horas, reduzindo falso positivo de upload em andamento e impedindo cross-tenant leakage.

Nenhum objeto é apagado, movido ou baixado pelo diagnóstico.

## Saúde do Hub

A tela só declara aquilo que consegue verificar:

- Database = RPC/read models responderam ou falharam;
- Google Calendar = reutiliza status real da integração existente;
- Data Quality = resumo e issues derivadas.

Não existe token Vercel no browser e a tela não inventa status global de Supabase/Vercel.

## Segurança

- RLS ligado na única nova tabela persistida;
- `anon` sem acesso;
- views públicas 3.9 com `security_invoker=true`;
- bridge Relationship é o único `SECURITY DEFINER` novo, porque a source view 3.8 permanece propositalmente não exposta; usa `auth.uid()`, owner filter e `search_path=public, pg_temp`;
- telefone canônico é função pura e recebeu EXECUTE apenas para `authenticated`;
- Storage orphan possui owner guard explícito.

## Produção auditada no início do pacote

Antes de qualquer correção automática (não existe), a leitura real encontrou 3 pacientes ativas, nenhuma duplicidade forte por CPF/telefone/e-mail, nenhum nome inválido e dois cadastros sem telefone. O primeiro resumo 3.9 encontrou 0 críticos, 0 warnings e 3 infos: dois cadastros sem telefone e um objeto antigo de Storage sem referência ativa. O objeto de Storage é reportado, não classificado automaticamente como erro.

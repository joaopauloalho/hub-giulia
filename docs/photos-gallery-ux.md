# Galeria clínica de fotos — padrão de UX

## Objetivo

A aba **Fotos** existe para consulta rápida da evolução visual da paciente durante a rotina da clínica. O Hub Giulia é usado prioritariamente no iPad; portanto, esta experiência deve favorecer leitura imediata, poucos toques e ausência de etapas desnecessárias.

Este documento complementa o design system do Hub e o audit operacional de UX. A galeria deve reutilizar os componentes globais (`btn`, `field-input`, cards e padrões de feedback) e manter a linguagem visual branca/rose do produto.

## Princípios obrigatórios

1. **Galeria primeiro.** A foto é o conteúdo principal. Controles e metadados não podem competir visualmente com ela.
2. **Um único caminho para adicionar.** O botão `Adicionar fotos` abre diretamente o seletor nativo da galeria/Fototeca. Não inserir uma segunda tela apenas para repetir a ação.
3. **Seleção múltipla.** A profissional pode escolher uma ou várias fotos em uma única operação.
4. **Importação tolerante no iPhone/iPad.** Arquivos vindos da Fototeca são normalizados localmente para JPEG antes do pipeline canônico. Isso reduz diferenças de MIME/container de HEIC/HEIF e mantém remoção de EXIF/GPS.
5. **Sem câmera nesta aba.** A aba Fotos não deve iniciar captura de câmera. Seu papel é organizar imagens já existentes na galeria do dispositivo.
6. **Metadados mínimos.** Cada foto precisa apenas de data clínica e observação opcional no fluxo comum.
7. **Data digitável.** A data usa `DD/MM/AAAA`, aceita digitação direta e pode ser corrigida posteriormente. A data é metadado clínico editável; bytes, paths, hash, formato e demais propriedades canônicas do arquivo permanecem imutáveis.
8. **Observação livre e opcional.** Exemplos: `Antes`, `Depois de 15 dias`, `Olheira`, `Pós-botox`. Não exigir taxonomia para o uso diário.
9. **Consulta limpa.** Fora do modo de edição, mostrar apenas data e observação. Não manter inputs abertos em todos os cards.
10. **Visualizador simples.** Ao tocar na foto, abrir uma visualização ampla, com a data e a observação. Não expor SHA, path, MIME, controles técnicos ou editor clínico avançado no fluxo diário.
11. **Erros humanos, logs técnicos.** Mensagens como `PATIENT_PHOTO_*`, erros Supabase, hashes ou detalhes de Storage nunca devem aparecer para a profissional. Esses detalhes podem ser enviados ao console/log; a interface apresenta instrução curta e acionável.
12. **Resiliência em lote.** Se uma foto falhar durante uma seleção múltipla, as fotos válidas continuam sendo salvas. Ao final, informar quantas foram salvas e quantas falharam.
13. **Galeria aberta ao longo do tempo.** Uma foto já salva pode ter data e observação alteradas depois. Também pode ser removida da galeria mediante confirmação curta. A remoção visual usa o lifecycle de anulação existente para preservar auditoria clínica e impedir adulteração silenciosa do arquivo canônico.
14. **Adicionar ao mesmo dia.** Cada grupo de data oferece uma ação discreta `Adicionar neste dia`. Novas imagens entram diretamente naquele agrupamento, mesmo que sejam escolhidas em outro momento.
15. **Observação geral por dia.** Além da observação individual de cada foto, cada data pode ter uma observação livre compartilhada pelo conjunto inteiro. Essa observação pertence à combinação paciente + data e pode ser criada, editada ou apagada sem afetar as fotos.

## Layout de referência

No iPad em orientação horizontal, usar três colunas de fotos sempre que houver espaço confortável. Em larguras intermediárias, reduzir para duas colunas. Cards têm imagem em proporção `4:3`, data e observação compactas, com um botão discreto de edição.

Cada grupo diário deve conter, nesta ordem:

- data e quantidade de fotos;
- ação discreta `Adicionar neste dia`;
- observação geral do dia, recolhida/compacta quando não está sendo editada;
- grade de fotos.

O cabeçalho principal contém apenas:

- título `Fotos`;
- uma frase curta explicando a função da tela;
- CTA primário `Adicionar fotos`.

Não repetir títulos como “Galeria clínica”, “Fotos & evolução” e “Adicionar fotos” simultaneamente na mesma viewport.

## Segurança e integridade

O arquivo selecionado pela profissional é normalizado no navegador antes do upload. O pipeline existente continua produzindo original canônico, preview, thumbnail, hash SHA-256 e paths privados. A edição posterior da **data clínica** e da **observação** não autoriza alteração dos pixels nem dos campos canônicos do arquivo.

A ação visual **Excluir foto** não apaga silenciosamente o registro clínico canônico. Ela marca a foto como anulada/removida da galeria usando o lifecycle auditável já existente; o arquivo canônico e os metadados de auditoria permanecem protegidos.

A observação geral do dia é armazenada separadamente por `user_id + patient_id + photo_date`, protegida por RLS. Ela não substitui a observação individual de cada foto.

## Critérios de aceite

- No iPad horizontal, a tela não pode renderizar como HTML sem estilo ou criar coluna estreita com grande espaço vazio.
- `Adicionar fotos` deve abrir o seletor nativo diretamente.
- Deve ser possível selecionar várias fotos.
- Deve ser possível voltar depois e editar data/observação de qualquer foto salva.
- Deve existir uma opção simples de excluir foto, com confirmação antes da remoção da galeria.
- Deve ser possível adicionar novas imagens diretamente a um dia já existente.
- Cada dia deve aceitar uma observação geral opcional, independente das observações individuais.
- Fotos comuns da Fototeca do iOS, inclusive origens HEIC/HEIF que o navegador consegue decodificar, devem ser normalizadas e salvas sem instruir a usuária a mudar a configuração da câmera para “Mais compatível”.
- Data e observação podem ser editadas e salvas sem erro de imutabilidade canônica.
- O visualizador deve priorizar a imagem e não exibir metadados técnicos.
- Nenhum código interno de banco/Storage deve aparecer na interface.
- O fluxo deve continuar preservando RLS, Storage privado, hash e imutabilidade do arquivo canônico.

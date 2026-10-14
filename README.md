# Planejamento Medicina

Site estático para organizar tarefas, estudos, revisões e compromissos.
Os registros pessoais ficam no navegador, separados por endereço do site.
O backup no Google Drive e a leitura do Google Sheets são opcionais e precisam
de autorização explícita na interface.

## Login e sincronização da conta

O projeto real foi configurado: migração aplicada, acesso anônimo negado,
isolamento por conta e proteção contra revisões antigas conferidos no Supabase.
Os registros dos testes SQL foram revertidos por rollback. A confirmação de
e-mail está habilitada; no primeiro acesso, crie e confirme a conta do Planejamento.

O código de login e sincronização usa o projeto Supabase
`eupkdyhngmrsbvmaondp`, informado pelo usuário. A ativação depende da migração
`supabase/migrations/001_planejamento_sync.sql` e da chave pública de cliente em
`planning-config.js`. Enquanto a chave estiver vazia, a edição publicada mantém
o funcionamento local anterior; não existe sincronização ativa nesse estado.

Para configurar pelo Codex, adicione `SUPABASE_ACCESS_TOKEN` como segredo do
ambiente com destino exclusivo `api.supabase.com`. Nunca envie por chat, registre
no Git nem use esse token na aplicação. Após ativar a configuração do ambiente:

```bash
python3 scripts/configure_supabase_sync.py
```

O script aplica somente a tabela dedicada de planejamento, confere RLS e grants,
configura o redirecionamento do login para o site existente e salva **somente a
chave pública `anon`**. Não modifica flashcards, tabelas do MedReview nem buckets.
Confirmação de e-mail e demais regras de autenticação do projeto são preservadas.
Revise/teste o resultado antes de publicar a configuração real de cliente.

Use a mesma **conta do Planejamento** em todos os dispositivos. O login do
MedReview é separado, pois ele usa outro projeto Supabase. Registros anteriores
ao login são preservados; o usuário escolhe trazê-los à conta, com combinação por
identificador. Os rascunhos offline ficam separados por projeto e conta e são
enviados quando a conexão volta. Sair oculta os dados da conta e desconecta o
MedReview neste dispositivo.

Cada conta só pode ler sua linha pela política RLS. Gravações usam uma função
transacional que determina o dono pelo JWT autenticado, verifica a revisão e
recusa sobrescrever uma revisão antiga. A combinação entre dispositivos conserva
novos registros independentes, exclusões e mudanças em campos diferentes. Se o
mesmo campo for alterado de formas diferentes, o usuário escolhe qual manter;
alterações não relacionadas continuam preservadas. Tokens nunca fazem parte dos
registros sincronizados, backups ou cache do service worker.

A suíte de navegador simula duas sessões autenticadas sem acessar dados reais.
Os testes SQL foram executados em PostgreSQL 17 isolado: acesso anônimo e escrita
direta negados, isolamento por usuário, revisão antiga recusada e rollback dos
registros de teste. Para repetir, use um PostgreSQL descartável, execute
`tests/sql/bootstrap.sql`, a migração e `tests/sql/isolation.sql`; o bootstrap
simula apenas a identidade do Supabase e não deve ser aplicado ao projeto real.

## Aplicativo para celular e iPad

O site é um PWA instalável, com manifesto, ícones de aplicativo e versão para
a tela inicial. No iPhone/iPad, abra no Safari e use **Compartilhar → Adicionar
à Tela de Início**. No Android/Chrome e em navegadores compatíveis, use
**Instalar app**. O botão também apresenta instruções quando a instalação
não é oferecida pelo navegador. Guarde um backup antes de instalar ou trocar de
dispositivo; a instalação não cria sincronização automática de registros locais.

Após o primeiro carregamento completo, o aplicativo, a agenda e o cronograma
incluído abrem offline. Tarefas, sessões, anotações e configurações continuam
salvas no dispositivo. MedReview, Google, PDF original e links de materiais
precisam de internet. O histórico privado do MedReview não é armazenado no cache
do service worker; a sessão é validada novamente no backend quando online.

`sw.js` guarda apenas os caminhos públicos explicitamente listados. Não
intercepta APIs externas, autenticação, backups nem arquivos da pasta Drive.
Online, busca a versão atual dos arquivos; offline, usa a última cópia disponível.
Atualizações do worker aparecem com botão explícito para recarregar o app.
Ao acrescentar um novo arquivo necessário offline, inclua-o em `ASSETS`.
Não acrescente respostas privadas ou URLs de APIs à lista.

A navegação suporta o botão Voltar e atalhos `/#today`, `/#tasks` e `/#reviews`.
O layout adapta agenda, formulários, menus e alvos de toque a celular e tablet,
com áreas seguras e altura dos formulários ajustada à janela visível.
Os testes cobrem esses tamanhos em Chromium; a instalação no Safari/iOS usa
metadados padrão, mas não foi testada em um iPhone ou iPad físico neste ambiente.

## Desenvolvimento

Não há etapa de compilação. O SDK Supabase está incluído em `vendor/`. Com Python 3:

```bash
cd /workspace/Planejamento
python3 -m http.server 8000 --bind 127.0.0.1
```

O servidor deve ser reiniciado em cada nova sessão. As tarefas do Codex já são
isoladas: use o checkout existente, sem criar outro worktree.

## Cronograma

**Semana** é a agenda de sete dias, com cronograma acadêmico, compromissos,
tarefas planejadas e revisões pessoais. **Cronograma** consulta a planilha do
semestre por mês e tipo de atividade; os grupos mensais permitem consultar
as datas e abrir os detalhes de cada bloco. Os filtros não alteram a agenda.

`academic.json` contém 193 blocos extraídos da planilha UC2 do semestre
2026/2: 18 semanas, de 17 de agosto a 19 de dezembro, com aulas, tutorias,
avaliações, feriados, acolhimento e horários livres. As sete provas e os dois
seminários avaliativos aparecem no radar. Datas, horários, professores e cores
foram preservados. Blocos consecutivos idênticos foram unidos; a página 19,
que repete a página 18, não duplica eventos.

O documento original está em `data/uc2-2026-2.pdf` e pode ser aberto pelas
Configurações do site. `academic-source.json` registra a origem, contagens e
SHA-256 do PDF. Para refazer a extração, com PyMuPDF instalado:

```bash
python3 scripts/import_semester_pdf.py 'arquivo-do-semestre.pdf' --output .
```

O extrator reconhece a grade deste documento e interrompe a execução se a
estrutura esperada mudar. Revise o resultado antes de usar outro PDF.

Em **Configurações**, você também pode importar um CSV para guardar uma cópia
própria do cronograma neste navegador. O CSV aceita a grade semanal com datas
`dd/mm/aaaa` nos cabeçalhos e horários `08:00-09:00` na primeira coluna. A opção
**Usar cronograma incluído no site** restaura o semestre desta edição, mantendo
os demais registros pessoais. A conexão opcional Google Sheets é somente leitura.

Não coloque dados pessoais ou credenciais no repositório. Faça backup antes de
trocar de dispositivo ou endereço de hospedagem. O planejamento local não exige login; a leitura do MedReview exige autenticação
na conta vinculada. A proteção geral do site depende da configuração da Vercel.

## Tarefas

Tarefas representam ações escolhidas por você. A tela separa prazos vencidos,
ações para hoje, blocos com horário reservado e tarefas a organizar, com filtros
para pendentes e concluídas. Prazo é opcional e indica a data limite; horário
planejado vem dos blocos aplicados no Planejador. Editar preserva o identificador,
o estado de conclusão e o horário já reservado.

Marcar a caixa conclui a tarefa, sem criar minutos de estudo ou flashcards.
**Registrar estudo** abre uma sessão com disciplina, assunto e duração sugeridos;
revise e salve o tempo realmente estudado. Os registros continuam locais e são
preservados nas exportações de backup.

## Planejador e configurações

O planejador mostra sete dias e permite selecionar os blocos sugeridos antes de
salvá-los na agenda. Os horários livres podem ser ajustados na própria tela;
reservas existentes aparecem separadamente e podem ser retiradas sem excluir a
tarefa. Tarefas sem encaixe explicam o motivo e oferecem edição. Antes de salvar,
o planejador recalcula para evitar aplicar uma sugestão desatualizada.

Configurações concentra disponibilidade, meta semanal, lembretes de estudo,
cronograma e backups. A importação antiga e as conexões opcionais Google ficam
recolhidas, preservando suas autorizações e ações de backup manual.

## Revisões do MedReview

Em **Revisões → Conectar MedReview**, entre com a mesma conta administradora de
Gabriel. A conexão usa o backend Supabase identificado no repositório `Flashcards`
e o endereço https://flashcard-lac-xi.vercel.app/. O servidor valida a sessão;
esta edição aceita apenas o identificador da conta administradora configurada.
Não envie senha ou tokens por chat.

O total diário conta respostas registradas em `mr_reviews`, sem duplicar IDs.
Responder ao mesmo cartão duas vezes conta duas revisões. Cartões distintos são
mostrados separadamente. Dias seguem o fuso `America/Cuiaba`; clicar no total abre
baralhos, caminhos de pastas, quantidades, percentuais e avaliações de dificuldade.
O painel inicial também mostra as revisões de flashcards realizadas hoje.
A tela de revisões inclui atividade dos últimos 7 ou 14 dias, média por dia ativo,
maior volume diário e os cinco baralhos mais revisados no período. O detalhe do
dia mostra participação por baralho e avaliações de dificuldade, sem tratá-las
como taxa de acerto. Nas avaliações, verde indica data passada e amarelo indica
hoje ou data futura; essas cores não confirmam presença ou aprovação.

São consultados apenas registros da conta autenticada e metadados dos cartões e
baralhos necessários. Não há gravações nas tabelas do MedReview. O SDK atualiza a
sessão; os tokens ficam no armazenamento próprio da conexão neste navegador,
fora dos backups do planejamento. **Desconectar** remove esta sessão local.
Nenhuma chave administrativa está incluída: `medreview-config.js` contém apenas
URL e chave pública `anon` do cliente, além do identificador da conta vinculada.
A autorização efetiva depende das políticas do backend.

O histórico atualiza ao receber eventos do backend, ao voltar à janela e a cada
60 segundos enquanto o site está visível. **Atualizar agora** permite nova leitura.
Os filtros consultam 7, 30, 90 ou 365 dias, ou todo o histórico, com paginação.
Falhas de leitura mostram erro, sem inventar totais zero. Revisões de estudo
planejadas manualmente continuam disponíveis em uma seção separada.

A distribuição usa o **baralho atual** do cartão. Revisões preservadas sem cartão
ou baralho acessível aparecem como origem não identificada. Registros apagados no
MedReview não podem ser recuperados por esta integração. O SDK vendorizado é
`@supabase/supabase-js@2.117.3`, com licença em `vendor/supabase-LICENSE`.

## Validação

Verifique a sintaxe com `node --check` em cada arquivo JavaScript. Os testes
funcionais precisam de Python com Playwright e Chromium; o ambiente do Codex
atual já fornece ambos. Em outras máquinas, instale Playwright e seu navegador
antes de executar os testes. `CHROMIUM_PATH` pode indicar um Chromium existente.

```bash
node --test tests/medreview-data.test.cjs tests/cloud-data.test.cjs
python3 -m unittest discover -s tests -v
```

Os testes iniciam um servidor temporário e usam contextos descartáveis do
navegador. Cobrem navegação desktop/celular, estados do cronograma, importação
CSV, tarefas, estudos, revisões, persistência e exportação/restauração de backup.
Os testes de autenticação e distribuição do MedReview interceptam o backend e
usam dados sintéticos; não acessam o histórico real. Cobrem conta incorreta,
leitura negada, contagem sem duplicatas, origem dos cartões e desconexão.
Os dados de teste nunca são enviados aos serviços nem incluídos no site.

## Publicação na Vercel

Site existente: https://planejamento-medicina-independente.vercel.app/

O projeto Vercel deve estar conectado ao repositório
`gabrielfreitasferrari70-glitch/Planejamento`, com branch de produção `main`
e diretório raiz do repositório. `vercel.json` configura a saída estática sem
instalação ou build. O envio para `main` dispara uma publicação apenas se essa
integração estiver ativa; confirme o resultado na Vercel e no site antes de
considerar a versão publicada. Preserve a proteção de acesso existente.

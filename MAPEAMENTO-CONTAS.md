# Mapeamento do Planejamento

Revisão de 14/10/2026. Base: versão `49acfb7` do Antigravity, com integração da separação de contas.

## Funcionalidades preservadas

As três abas **Flashcards**, **Aulas & Cronograma** e **Conteúdos Dominados** continuam disponíveis. Foram mantidos os cartões, as cores por avaliação, a conclusão e reabertura de conteúdos e as datas de aula e domínio.

O **Fechamento do Dia** continua classificando aulas como vistas para revisão, vistas com necessidade de aprender ou não vistas. Continuam a geração de revisões e tarefas, o checklist e a reflexão diária. O recurso permanece exclusivo da conta administradora, conforme o Antigravity.

Os resumos de WhatsApp e os agendamentos de **05h** e **22h**, no horário de Cuiabá, foram mantidos. Não foi executado nenhum disparo real durante a validação.

## Onde cada informação fica

| Informação | Separação e armazenamento | Comportamento de outra conta |
| --- | --- | --- |
| Nome, e-mail e aprovação | Supabase Auth e `profiles`, identificados pelo UUID do usuário | Cadastro começa pendente; precisa de `approved = true` no Supabase |
| Cronograma, aulas e provas | `planejamento_documents.payload.replacement`, na linha do próprio usuário | Conta nova começa sem cronograma; importa a própria planilha |
| Arquivo importado | Análise temporária no servidor, com prévia antes de confirmar | PDF/Excel original não fica armazenado; atividades geradas pertencem ao importador |
| Tarefas, estudos, revisões, anotações e erros | Mesmo documento privado, com listas separadas | Não recebe os registros de Gabriel |
| Progresso de aulas e conteúdos dominados | `settings.evaluatedClasses`, com identificador por registro | Não lê avaliações antigas do navegador inteiro |
| Aba de Revisões selecionada | `settings.reviewTab` da própria conta | Preferência não passa para outro usuário |
| Materiais e Google Drive | Links privados da conta; `settings.materialsUrl` para a pasta principal | Começa sem o link de Gabriel |
| Disponibilidade, metas e demais configurações | `settings` no documento privado | Usa valores iniciais, sem herdar personalizações de Gabriel |
| MedReview | Login próprio no projeto do MedReview, histórico consultado somente por leitura | Não herda a sessão ou o histórico na troca de conta; integração atual segue vinculada ao administrador |
| Fechamento do Dia | Funções e interface do Antigravity, usando os registros da conta ativa | A restrição de administrador foi mantida |
| WhatsApp manual | Administrador aprovado, verificado pelo UUID no servidor | Não herda destinatário, chave ou permissão de envio |
| WhatsApp agendado | Segredo de cron + documento privado do administrador aprovado | Não usa o semestre de outra pessoa nem aceita um usuário informado na URL |
| Uso offline | Rascunho separado por projeto e UUID, após aprovação verificada | Sair oculta os registros; revogação é verificada ao reconectar |

## Ajustes feitos na integração

1. A base de contas e cronogramas individuais já estava implementada. Ela foi preservada.
2. As novas avaliações de aulas do Antigravity estavam em `planejamento-evaluated-classes`, uma chave global do navegador. Um adaptador passou a salvá-las no documento privado e sincronizá-las entre os dispositivos da mesma conta.
3. Os dados antigos de aulas e configurações de WhatsApp são incorporados somente pela conta identificada do proprietário. As chaves antigas não são apagadas; permanecem como cópia de recuperação. Registros incompatíveis com o formato de identificação continuam nessa cópia para revisão.
4. Alterações em aulas diferentes são combinadas por identificador. Votos incompatíveis para a mesma aula geram uma escolha de versão, evitando sobrescrever silenciosamente o outro dispositivo.
5. A verificação de administrador usa o UUID da conta autenticada. Um e-mail contendo “gabriel” ou uma referência antiga em `localStorage` não concede acesso.
6. O resumo agendado lê a planilha privada do administrador no Supabase. O antigo arquivo acadêmico global não é usado pelo cron.
7. As chaves de envio ficam no servidor ou no armazenamento local da conta autorizada; não entram no cronograma, no backup nem nas respostas das APIs. A chave administrativa do Supabase é exclusiva do servidor do agendamento.
8. As rotas de envio e cron recusam solicitações sem autorização. O envio manual também exige aprovação; a revogação do administrador interrompe os resumos automáticos.
9. O `package.json`, os crons, as abas, as cores e os fluxos do Antigravity foram mantidos. Os testes foram adaptados para o formato de módulos escolhido nessa versão.

## Fluxo de uma conta nova

1. A pessoa informa nome, e-mail e senha e aguarda aprovação.
2. Gabriel libera a conta em **Supabase → Table Editor → profiles → approved = true**.
3. Ao entrar, a pessoa não encontra os dados de Gabriel.
4. Em **Configurações → Seu cronograma**, importa PDF, XLSX ou CSV de até 3 MB.
5. Confere a prévia e confirma. Semana, Cronograma e Provas passam a usar aquelas atividades, em todos os dispositivos da conta.
6. Estudos, revisões realizadas, tarefas e avaliações de domínio são registrados pela própria pessoa. Importar a planilha não presume atividades concluídas.

PDFs precisam ter texto selecionável e uma grade reconhecível. Há suporte a planilhas com grade semanal ou tabela com data, início, fim e atividade. Arquivos não reconhecidos recebem orientação para usar Excel/CSV; datas ou atividades não são inventadas.

## Verificação

Passaram 56 testes: 20 de lógica/APIs, 10 de conta/sincronização, 20 de interface e 6 de importação.

Os testes cobrem conta nova vazia, aprovação, separação do cronograma e do Drive, importação, duas sessões da mesma conta, rascunhos offline e conflitos. Também verificam as três abas do Antigravity, preservação do registro antigo do proprietário, domínio sincronizado, ausência desses registros em outra conta e bloqueio de permissões por nome de e-mail.

As rotas de WhatsApp e cron são testadas com respostas simuladas, sem mensagens reais. A publicação é conferida no domínio existente da Vercel; requisições públicas de teste não fornecem o segredo de cron nem acionam envio.

O agendamento depende da Vercel executar os crons e do CallMeBot aceitar a configuração fornecida. Os testes não representam uma entrega real no WhatsApp.

## Decisões de Arquitetura e Segurança de Banco de Dados

### Funções SECURITY DEFINER (Supabase Advisor 0029 aceito)
As funções `public.planejamento_write` e `public.planejamento_is_approved` foram definidas intencionalmente como `SECURITY DEFINER` com `search_path = ''`:
1. **`planejamento_is_approved`**: Precisa ler a tabela `public.profiles` de forma autoritativa e segura para verificar se o usuário autenticado (`auth.uid()`) possui `approved = true`, blindando a verificação de aprovação sem conceder privilégios de leitura ampla para clientes.
2. **`planejamento_write`**: Realiza controle de concorrência atômico (compare-and-swap) e incremento de revisão em `public.planejamento_documents` garantindo integridade transacional exclusivamente para o `auth.uid()`, sem permitir escrita direta indiscriminada na tabela.

O aviso do Supabase Advisor (alerta 0029 sobre funções SECURITY DEFINER) é conhecido e aceito como decisão consciente de arquitetura de segurança.


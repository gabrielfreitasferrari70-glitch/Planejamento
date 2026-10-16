# Planejamento Medicina — mapa para agentes (Claude/Antigravity)

Leia isto antes de explorar o código. Evite reler arquivos inteiros: use `grep` no trecho necessário.

## Arquitetura
- Site estático (sem build) na Vercel; `main` publica em produção automaticamente.
- Supabase `eupkdyhngmrsbvmaondp`: um documento JSONB por conta (`planejamento_documents`), gravado só por `planejamento_write` (revisão + aprovação). Histórico em `planejamento_document_versions`.
- Scripts em ordem (index.html): app.js → legacy-import → insights → cloud-drive → supabase → medreview-config/data → account-features → medreview → pwa → cloud-data → class-tasks → account-sync → semester-import → whatsapp-notify.
- `render()` é envolvido em camadas (insights, cloud-drive, pwa, account-sync). `goto()` também (pwa, account-sync).
- Linhas de JS são longas: localize funções com `grep -n "function nome"` e edite por substituição exata.

## Telas (MENU, 14 itens) e onde ficam
- today (Hoje: todayView, nowPanel, todayQueue), week (calendar, grade horária), calendar (semesterView), tasks (tasksView/taskHTML), focus (focusView + cronômetro), studies, reviews (reviewView; medreview.js estende), exams, radar/mistakes (insights.js), reports (reportView + consistencyPanel), materials, planner (plannerView/suggest), settings.
- 'dashboard' redireciona para 'today'.

## Convenções
- Ícones: sprite Lucide no index.html; no JS `ico('nome')`. Ícone novo = novo `<symbol id="i-nome">`.
- Avisos: `notify(texto,{label,run})` mostra botão (ex.: Desfazer).
- Títulos da planilha: `displayTitle()` só na exibição.
- Tema: `settings.theme` = light (padrão) | dark | auto.
- Configurações novas PRECISAM entrar na lista de `cloud-data.js` (a sincronização descarta chaves desconhecidas).
- Compromissos (`FORM.event`) podem repetir toda semana (cria ocorrências com `seriesId`; excluir pelo modal do evento). `FORM.multitask` (botão "Tarefa em vários dias") cria uma tarefa por dia com `groupId`. `seedLigaAnatomia()` semeia 1x a Liga de Anatomia (terças 18h–19h até 15/12/2026) só em contas com cronograma importado; flag `settings.ligaAnatomia`.
- Campos de tarefa: subtasks, repeat, nextId, spent, completedAt. Itens de listas são preservados inteiros.
- Arquivo novo usado offline → ASSETS em `sw.js` e incrementar `planejamento-shell-vN` (hoje v9; teste em tests/test_smoke.py usa o nome).
- Nada de CDN/script externo (CSP ativa). Sem segredos, UUIDs ou links privados no código.

## Testes
- `node --test tests/*.test.cjs` (rápido) e `python3 -m unittest discover -s tests` (~90 s, Playwright).
- 3 falhas esperadas em contêiner sem PyMuPDF/offline: test_schedule_parser, test_individual_semester_preview..., test_pwa_install_metadata_offline...
- Para rodar só o que mudou: `python3 -m unittest tests.test_smoke.SiteSmokeTests.test_nome`.

## Fluxo de trabalho
Mudança → testes focados → bateria completa uma vez → commit (um por fase) → push no main → conferir status da Vercel com
`gh api repos/gabrielfreitasferrari70-glitch/Planejamento/commits/<sha>/status --jq .state`.
Senhas: mínimo de 6 caracteres no formulário e no Supabase, conforme orientação do proprietário. Preservar o acesso das contas existentes. Pendência manual (Supabase): Leaked password protection.

Tarefas de aulas: `class-tasks.js`, opt-in individual `settings.classTaskPolicy` (enabled/fromDate/extraEventIds); Geração somente até a data atual em America/Cuiaba (inclui pendências desde fromDate e as exceções explícitas, nunca antecipa aulas futuras). `classTaskLedger` registra a tarefa por evento e preserva exclusões. Anatomia/Fisiologia alta, demais normal. Não registra presença, minutos ou revisões. Fechamento reutiliza tarefas vinculadas.

Questões: `questions.js` + `api/questions.py` + `lib/question_sources.py`. Simulados privados em `settings.questionSets`, com fontes verificadas no servidor. Não escreve no MedReview. Configuração e limites em `QUESTOES.md`. Sem chave/modelo/flag de projeto gratuito, a geração Gemini fica bloqueada.

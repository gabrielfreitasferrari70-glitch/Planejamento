# Planejamento Medicina

Site estático para organizar tarefas, estudos, revisões e compromissos.
Os registros pessoais ficam no navegador, separados por endereço do site.
O backup no Google Drive e a leitura do Google Sheets são opcionais e precisam
de autorização explícita na interface.

## Desenvolvimento

Não há compilação nem dependências de aplicação. Com Python 3:

```bash
cd /workspace/Planejamento
python3 -m http.server 8000 --bind 127.0.0.1
```

O servidor deve ser reiniciado em cada nova sessão. As tarefas do Codex já são
isoladas: use o checkout existente, sem criar outro worktree.

## Cronograma

`academic.json` começa vazio porque o cronograma original não foi enviado.
O site informa essa ausência. Em **Configurações**, importe o CSV exportado da
planilha para guardar o cronograma neste navegador. O CSV aceita a grade semanal
com datas `dd/mm/aaaa` nos cabeçalhos e horários `08:00-09:00` na primeira coluna.
Também é possível conectar o Google Sheets com um OAuth Client ID Web próprio.
A planilha original é acessada somente para leitura.

Não coloque dados pessoais ou credenciais no repositório. Faça backup antes de
trocar de dispositivo ou endereço de hospedagem. O site não inclui login;
a restrição de acesso depende da proteção configurada na Vercel.

## Validação

Verifique a sintaxe com `node --check` em cada arquivo JavaScript. Os testes
funcionais precisam de Python com Playwright e Chromium; o ambiente do Codex
atual já fornece ambos. Em outras máquinas, instale Playwright e seu navegador
antes de executar os testes. `CHROMIUM_PATH` pode indicar um Chromium existente.

```bash
python3 -m unittest discover -s tests -v
```

Os testes iniciam um servidor temporário e usam contextos descartáveis do
navegador. Cobrem navegação desktop/celular, estados do cronograma, importação
CSV, tarefas, estudos, revisões, persistência e exportação/restauração de backup.
Os dados de teste nunca são enviados ao Google nem adicionados ao cronograma do site.

## Publicação na Vercel

Site existente: https://planejamento-medicina-independente.vercel.app/

O projeto Vercel deve estar conectado ao repositório
`gabrielfreitasferrari70-glitch/Planejamento`, com branch de produção `main`
e diretório raiz do repositório. `vercel.json` configura a saída estática sem
instalação ou build. O envio para `main` dispara uma publicação apenas se essa
integração estiver ativa; confirme o resultado na Vercel e no site antes de
considerar a versão publicada. Preserve a proteção de acesso existente.

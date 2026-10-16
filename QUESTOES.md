# Questões no Planejamento

Geração sob demanda a partir de 1–5 arquivos selecionados do Google Drive. Simulados, respostas e desempenho são salvos no documento individual já utilizado pelo Planejamento (`settings.questionSets`), sujeito à mesma aprovação, isolamento e resolução de conflitos. Não há novas tabelas, migrações, chamadas ou escritas no MedReview.

## Configuração para uso real

1. No Google Cloud, usar um projeto sem billing, habilitar Drive API, configurar consentimento OAuth para `drive.readonly`, usuários de teste quando aplicável e uma credencial OAuth Web com a origem `https://planejamento-medicina-independente.vercel.app`. O escopo permite leitura de todo o Drive; a aplicação lista a pasta escolhida e só baixa os arquivos explicitamente selecionados. Projetos externos podem exigir verificação do Google; erros de consentimento precisam ser resolvidos pelo proprietário. Não tornar arquivos públicos.
2. Informar o Client ID público na aba Questões. Ele é sincronizado como a configuração Google existente. Autorizar o Drive separadamente do backup privado. O token permanece na memória da aba, é descartado ao desconectar/trocar de conta e só é enviado por HTTPS ao endpoint autenticado para operações solicitadas.
3. No Google AI Studio, criar/usar uma chave vinculada a projeto **sem conta de billing**, escolher um modelo que ofereça cota gratuita e conferir os termos de uso/dados. Na Vercel do **Planejamento**, salvar `GEMINI_API_KEY` como segredo de servidor, `GEMINI_MODEL` como nome do modelo e `GEMINI_FREE_TIER_CONFIRMED=true` somente após essa conferência. Não colocar a chave no navegador, código, conversa ou Git. Republicar para aplicar as variáveis.
4. A flag é uma confirmação operacional, não consulta à conta de billing do Google. Se o projeto for alterado para pago, remover a flag/chave antes de usar. O aplicativo não ativa billing, não cria recursos pagos, não tem fallback pago e não repete pedidos automaticamente após quota/erro.
5. Sem as três variáveis, o Gemini responde com indisponibilidade explícita antes de ler documentos ou chamar o modelo. As variáveis de autenticação `PLANNING_SUPABASE_URL` e `PLANNING_SUPABASE_PUBLIC_KEY` já são usadas pelos outros endpoints; nenhuma chave de serviço é usada para questões.

## Fonte e limites

PDF, Google Docs e Google Slides (exportação PDF), e TXT UTF-8. Até 4 MB por arquivo, 300 páginas por PDF e 140 mil caracteres no conjunto. Pastas são navegáveis; seus arquivos devem ser selecionados individualmente, sem envio recursivo implícito. Lista de arquivos tem paginação. Sem OCR e sem leitura de imagens, DOCX ou PPTX.

Cada citação é conferida por comparação literal após normalização Unicode/espaços na unidade extraída. A página exibida é obtida da extração, nunca do modelo. Em PDFs, é a posição física da página, podendo divergir do número impresso no rodapé. Em Docs/Slides, refere-se ao PDF exportado; TXT usa número do trecho. A leitura registra hash SHA-256 e modificação do arquivo. Se o arquivo mudar durante a extração, a operação é recusada. Links apontam ao documento; o trecho é exibido para conferência. Mudanças posteriores no Drive podem mudar a localização da evidência.

A verificação confirma a existência do trecho, não a correção médica ou a suficiência lógica da explicação. Revisar gabaritos antes de uso avaliativo. Fontes ilegíveis, referências desconhecidas e respostas incompletas são recusadas sem salvar um simulado parcial.

Máximo de 20 questões por simulado e 20 simulados; limite de bytes protege a sincronização de 1,5 MB existente. Exporte e exclua simulados antigos quando necessário. Respostas são preservadas e sincronizadas a cada marcação; a correção exige responder todas e ocorre uma única vez. Os resultados aparecem no histórico da própria aba, sem criar sessões de tempo, revisões de flashcards ou tarefas fictícias.

## Fluxo ChatGPT

Autorizar o Google Drive no ChatGPT, conforme disponibilidade da conta, e usar os mesmos arquivos selecionados no Planejamento. “Baixar pedido para ChatGPT” prepara um TXT contendo links, IDs e trechos extraídos com identificadores; anexar o pedido ao ChatGPT e solicitar o JSON especificado. O pedido contém conteúdo privado dos materiais: compartilhar apenas com a conta/serviço pretendido. Não contém tokens nem chaves.

O site não configura conectores do ChatGPT nem presume acesso aos arquivos. O usuário deve autorizá-los no ChatGPT. A importação do JSON relê os arquivos selecionados, confere novamente os trechos e usa somente os metadados reais. A assinatura ChatGPT Plus não é tratada como API gratuita. Nenhuma API OpenAI é chamada pelo site.

## Validação

`node --test tests/*.test.cjs`

`CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' python3 -m unittest discover -s tests`

Testes de fontes incluem extração real de PDF, páginas inventadas, trechos/arquivos inválidos, TXT sem página, mudanças no arquivo, autorização, aprovação e bloqueio antes de chamadas Gemini. Testes de navegador usam serviços e contas simulados e não consomem Gemini nem acessam o Drive real. A geração real depende de configurar e autorizar os serviços acima.

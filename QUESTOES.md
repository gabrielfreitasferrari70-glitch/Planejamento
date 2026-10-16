# Questões do chat normal

O Planejamento recebe arquivos JSON preparados pelo usuário em uma conversa no ChatGPT. O botão “Baixar pedido para ChatGPT” gera instruções e o formato esperado sem ler documentos, usar conectores, fazer chamadas de IA ou iniciar tarefas no Work. “Abrir ChatGPT” abre a página inicial do produto: o usuário deve escolher uma conversa no modo Chat. O site não controla o modo do ChatGPT, os limites do plano, nem oferece uso ilimitado ou transferência automática.

1. Na aba Questões, baixe o pedido e leve a uma conversa no ChatGPT normal.
2. Anexe os materiais ou autorize os conectores disponíveis naquela conversa. Peça um arquivo JSON.
3. Importe o JSON na aba Questões. Responda, corrija e consulte o histórico.

## Formato

Objeto com `subject` e `questions`. Cada questão exige `stem`, quatro `options` distintas, `answer` inteiro entre 0 e 3, `explanation` e de uma a três `citations`. Cada citação exige `name` e `quote` literal com pelo menos 40 caracteres. `url` é opcional e aceita somente HTTPS; `page` deve ser inteiro positivo ou `null` quando não verificada. O pedido orienta o ChatGPT a não inventar referências nem páginas.

A importação valida estrutura, tamanho, alternativas, gabarito e presença das referências. Ela não acessa fontes nem prova que o trecho/página existe no documento. A interface identifica referências novas como importadas e pede conferência humana. Declarações de verificação no JSON não são confiadas. Simulados antigos são preservados com suas referências e respostas existentes.

Limites: 20 questões por arquivo, 900 KB por importação, 20 simulados e proteção para o tamanho do documento já utilizado na sincronização. Exportar/excluir simulados libera espaço. A importação não cria sessões de tempo, tarefas ou revisões fictícias e não escreve no MedReview.

## Armazenamento e serviços

Simulados e respostas continuam em `settings.questionSets`, no documento privado da conta do Planejamento, com sua autenticação e sincronização existentes. O JSON é lido no navegador; apenas o resultado estruturado é sincronizado. Não há API de questões, chaves de modelo, configuração OAuth ou serviço de leitura de documentos no site.

A conexão antiga de backup privado do Drive também foi retirada da interface. Backups JSON locais e dados existentes foram preservados. Links de materiais já salvos continuam sendo links comuns: não concedem autorização ou leitura automática. A integração preexistente com planilhas e a consulta do MedReview permanecem.


## Área de estudo e formato v2

A biblioteca e a preparação/importação têm abas separadas. Importar ou abrir um simulado leva a um espaço dedicado, com uma questão por vez, índice de navegação, letras e opções maiores, progresso e correção. Respostas e histórico existentes permanecem na mesma conta. A correção mostra o gabarito, a resposta escolhida, os quatro comentários e a síntese do tema.

O pedido atualizado usa `schemaVersion: 2` e exige `optionExplanations`, uma lista com exatamente quatro comentários detalhados, na ordem A–D. Cada comentário deve justificar a classificação e corrigir a afirmação quando errada. O campo `explanation` é a síntese do tema. Os comentários aceitam até 6 mil caracteres cada, a síntese até 8 mil e o arquivo até 900 KB, sujeito ao limite de espaço da conta. Referências podem incluir `author`, `edition` e `chapter`, somente quando conhecidos pelo gerador. Livros só devem ser apresentados como consultados se efetivamente acessados; o comando orienta a declarar limitações. Não há novas chamadas de IA no site.

Arquivos antigos sem comentários individuais continuam aceitos. Na correção aparece uma indicação de que o arquivo não contém esse detalhamento; nenhum comentário é inventado automaticamente. Para obter comentários novos é necessário gerar uma nova versão no ChatGPT e importar.

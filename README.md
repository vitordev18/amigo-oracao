# Amigo Oração

Ferramenta de linha de comando para realizar o sorteio de um evento de Amigo
Oração (mesma dinâmica do Amigo Secreto) e notificar cada participante por
e-mail, de forma individual e confidencial.

O sorteio é matematicamente verificado antes de qualquer mensagem sair, e o
envio é resistente a falhas: se o processo for interrompido no meio, ele pode
ser retomado sem duplicar mensagens e sem alterar o resultado já sorteado.

Escrito em Node.js sem nenhuma dependência obrigatória.

> **Nota sobre idioma.** O código, os comandos e os nomes de arquivo estão em
> inglês; as mensagens exibidas ao operador e o conteúdo dos e-mails estão em
> português. A documentação acompanha a segunda convenção.

---

## Guia rápido

Perdeu o fio da meada? Este comando responde onde você está e o que fazer:

```
node --env-file=.env src/cli.js status
```

A sequência completa, em ordem:

| # | Comando | O que faz | Confirme antes de seguir |
|---|---|---|---|
| 1 | `validate --mx` | confere a lista | zero erros bloqueantes |
| 2 | `test --to voce@email.com` | manda uma amostra para você | chegou, não foi para o spam, acentos e logo corretos |
| 3 | `draw` | sorteia e sela o resultado | o total de participantes bate |
| 4 | `send` | **simula** o envio | o tamanho da fila e os destinatários |
| 5 | `send --confirm` | envia de verdade | o resumo final não lista falhas |
| 6 | `report` | situação de cada pessoa | — |

Todos são precedidos de `node --env-file=.env src/cli.js`. As etapas 1 e 2 podem
ser repetidas à vontade: nenhuma das duas grava arquivo nem altera o sorteio.

### Onde estou?

Dá para descobrir só olhando a pasta `output/`:

| Situação | Você está antes da etapa |
|---|---|
| `output/` vazia | 3 — ainda não sorteou |
| existe `draw.json`, não existe `sends.jsonl` | 4 — sorteado, nada enviado |
| existem os dois | 5 ou 6 — rode `report` para ver quem falta |

O comando `status` faz essa leitura por você e ainda imprime o comando seguinte.

### Testando com uma lista de mentira

Para ensaiar o fluxo inteiro recebendo tudo na sua própria caixa, use
sub-endereços: o Gmail ignora o que vem depois do `+` na entrega, mas o
validador os trata como endereços distintos.

```csv
name,email,exclude
Ana Teste,voce+ana@gmail.com,
João Teste,voce+joao@gmail.com,
Maria Teste,voce+maria@gmail.com,
```

---

## O problema

Um sorteio desse tipo parece trivial e não é. Três coisas costumam dar errado:

**O sorteio em si.** Embaralhar uma lista não basta: é preciso garantir que
ninguém tire a si mesmo, que ninguém seja tirado duas vezes e que ninguém fique
de fora. Fazer isso "na mão" com papel funciona; fazer com código exige um
algoritmo correto e uma verificação independente do resultado.

**A entrega dos e-mails.** Um endereço digitado errado, um domínio inexistente
ou uma cota de provedor estourada fazem com que uma pessoa simplesmente não
receba nada — e, sem registro, o organizador só descobre quando alguém reclama.

**A falha no meio do caminho.** Este é o mais grave. Se a conexão cair no
participante 20 de 30 e o processo for reiniciado do zero, um novo sorteio é
gerado e as dez pessoas que já haviam recebido passam a ter informação
inconsistente com as vinte restantes. O evento fica corrompido de forma
silenciosa e irreversível.

Este projeto trata os três casos explicitamente.

---

## Princípios de projeto

**Sorteio e envio são fases separadas.** O resultado é gravado em disco e selado
*antes* do primeiro e-mail. O comando de envio nunca sorteia; ele apenas lê o
que já foi decidido. Isso torna a retomada segura por construção.

**Falhar cedo e alto.** Erros na lista de participantes interrompem a execução
antes do sorteio, não durante o envio. Cada etapa é uma porta que só abre se a
anterior passou.

**O estado vive no disco, não na memória.** Cada envio é registrado
imediatamente após acontecer. Uma queda de energia perde no máximo o registro em
andamento.

**Nada é irreversível sem confirmação explícita.** O comando de envio simula por
padrão; só envia de verdade com uma flag adicional. O sorteio se recusa a
sobrescrever um resultado existente.

**Aleatoriedade criptográfica.** O embaralhamento usa `crypto.randomInt`
(CSPRNG), nunca `Math.random()`, cuja sequência é previsível.

---

## Arquitetura

```
participants.csv
       │
       ▼
   [validate] ────────────────── DNS (opcional)
       │  falha ⇒ para aqui
       ▼
   [draw] ─────▶ output/draw.json        (resultado selado + SHA-256)
       │
       ▼
   [send]  ────▶ Brevo / Resend / SMTP
       │
       └───────▶ output/sends.jsonl      (log incremental, append-only)
                        │
                        ▼
                    [report]
```

O comando `test` fica fora desse fluxo: ele valida a configuração de envio de
forma isolada, sem tocar na lista, no sorteio ou no log.

### Estrutura de arquivos

```
amigo-oracao/
├── participants.csv           entrada: name, email, exclude
├── participants.example.csv   modelo com dados fictícios
├── .env                       configuração e credenciais (não versionar)
├── assets/
│   └── logo.png               imagem exibida no cabeçalho do e-mail
├── src/
│   ├── cli.js                 interpretação dos comandos e orquestração
│   ├── participants.js        leitura do CSV e validação da lista
│   ├── draw.js                algoritmo de desarranjo e verificação formal
│   ├── template.js            corpo do e-mail (HTML e texto puro)
│   ├── mailer.js              provedores de envio, classificação de erro e retry
│   ├── dispatch.js            fila, log incremental e lógica de retomada
│   └── utils.js               parser de CSV, utilidades de terminal
├── tests/
│   └── invariants.js          prova das invariantes do sorteio
└── output/
    ├── draw.json              resultado selado (confidencial, substituível)
    └── sends.jsonl            log de envios, acumulativo (não contém os pares)
```

---

## Garantias do sorteio

O resultado é um **desarranjo**: uma permutação sem pontos fixos. As
propriedades garantidas são:

| Propriedade | Significado |
|---|---|
| σ(A) ≠ A | ninguém tira a si mesmo |
| σ é bijeção | cada pessoa tira exatamente uma |
| σ⁻¹ é bijeção | cada pessoa é tirada por exatamente uma |
| \|σ\| = n | ninguém fica de fora, ninguém aparece duas vezes |
| σ respeita restrições | pares vetados (casais, mesma casa) não ocorrem |

Existem dois modos, escolhidos por configuração:

**`cycle`** (padrão) — embaralha a lista e liga cada pessoa à seguinte, fechando
uma única roda: A→B→C→…→A. Para n ≥ 2 é estruturalmente impossível haver ponto
fixo, e o formato elimina pares recíprocos (A↔B), que em grupos pequenos
entregam a surpresa de imediato. A distribuição é uniforme sobre os (n−1)!
ciclos possíveis.

**`free`** — desarranjo uniforme sobre todos os !n desarranjos, obtido por
amostragem por rejeição. Aceita pares recíprocos e múltiplos ciclos. O número
esperado de tentativas é aproximadamente *e* ≈ 2,72.

Independentemente do modo, o resultado passa por uma **verificação formal**
antes de ser gravado. Qualquer violação lança exceção e aborta o processo — o
programa prefere não entregar resultado a entregar um resultado inválido.

A suíte em `tests/invariants.js` exercita essas invariantes em milhares de
sorteios, incluindo listas com restrições e um caso de restrição impossível,
que deve falhar com mensagem clara em vez de devolver resultado degradado.

---

## Garantias de entrega

**Validação prévia da lista.** Campos obrigatórios, sintaxe do endereço,
duplicidade, alvos de restrição inexistentes e erros de digitação frequentes em
domínios (`gmial.com`, `hotmial.com`, `outlok.com` e semelhantes). Opcionalmente
consulta o DNS para confirmar que o domínio aceita correio.

**Classificação de erro no envio.** Respostas 4xx (exceto 429) são tratadas como
permanentes: o programa não insiste, registra e segue. Respostas 429, 5xx e
falhas de rede são temporárias e disparam nova tentativa com espera exponencial
e jitter (1s → 2s → 4s → 8s).

**Controle de ritmo.** Um intervalo configurável entre mensagens evita atingir o
limite de requisições do provedor.

**Log incremental.** Cada resultado é gravado em `output/sends.jsonl` logo após
o envio, em modo append. O formato JSONL é resistente a truncamento: uma linha
corrompida por queda abrupta não invalida as demais.

**Retomada idempotente, escopada por sorteio.** Ao reexecutar o envio, quem
consta como `sent` é ignorado e quem consta como `failed` é tentado novamente.
Rodar o comando duas vezes nunca duplica mensagens.

Cada registro do log carrega a impressão digital do sorteio que o originou, e a
fila só considera os registros do sorteio corrente. Sem isso, um envio de teste
antigo faria o sistema pular silenciosamente uma pessoa real que compartilhasse
o mesmo endereço — o participante nunca receberia nada e ninguém perceberia. Os
registros de outros sorteios são contabilizados e informados na tela, não
descartados em silêncio.

**Selo de integridade.** O `draw.json` carrega uma impressão digital SHA-256
sobre endereços e nomes. Se o arquivo for editado manualmente, o envio é
bloqueado antes da primeira mensagem.

**Detecção de lista desatualizada.** Se o `participants.csv` mudar depois do
sorteio, o envio é interrompido e mostra exatamente quem entrou ou saiu — em vez
de ignorar em silêncio alguém que foi acrescentado à lista.

---

## Referência de comandos

Todos seguem o formato:

```
node --env-file=.env src/cli.js <comando> [flags]
```

Também existem atalhos via `npm run status`, `npm run validate`, `npm run draw`,
`npm run send`, `npm run report` e `npm run email-test`. O `npm test` executa a
suíte de invariantes, não envia e-mail.

### `status`

Resume em que ponto do processo o projeto está e imprime o próximo comando a
executar. Não altera nada — é seguro rodar a qualquer momento, inclusive no meio
de um envio interrompido.

- **Lê:** `participants.csv`, `.env`, `output/draw.json`, `output/sends.jsonl`
- **Grava:** nada

Verifica quatro coisas em ordem: se a lista existe e está válida, se as
credenciais estão configuradas, se já existe sorteio selado e quantos envios
foram registrados. O próximo passo sugerido leva em conta o estado real dos
arquivos — se houver falhas no log, por exemplo, ele aponta o reenvio dos
pendentes em vez do envio completo.

### `validate`

Confere a lista de participantes. É a porta de entrada do processo e não produz
efeito colateral algum — não grava arquivos e não contata o provedor de e-mail.

- **Lê:** `participants.csv`
- **Grava:** nada
- **Rede:** somente DNS, e apenas com `--mx`
- **Encerra com código 1** se houver erro bloqueante

Distingue duas severidades. *Erros bloqueantes* impedem o sorteio: nome ou
e-mail vazio, sintaxe inválida, endereço duplicado, domínio com erro de
digitação conhecido, lista com menos de dois participantes. *Avisos* são
informativos e não interrompem: restrição apontando para alguém fora da lista,
domínio sem registro MX, consulta de DNS inconclusiva.

Flag `--mx`: consulta os registros MX de cada domínio. Distingue resposta
conclusiva do DNS (`ENODATA`, `ENOTFOUND`) de falha de consulta (timeout,
SERVFAIL, rede corporativa) — só a primeira é atribuída ao endereço. Também
aceita MX implícito: pela RFC 5321, um domínio com registro A recebe correio no
próprio host.

### `test`

Envia uma mensagem de amostra com dados fictícios para um endereço à sua
escolha. É o único comando que exercita a cadeia completa de envio de forma
isolada, e serve para validar credencial, autorização de IP, verificação do
remetente e aparência da mensagem antes de qualquer envio real.

- **Lê:** `.env`
- **Grava:** nada — não registra no log nem consome o sorteio
- **Flag obrigatória:** `--to <endereço>`

O assunto recebe o prefixo `[TESTE]` e o conteúdo usa nomes fictícios, de modo
que nenhum resultado verdadeiro é revelado.

### `draw`

Executa o sorteio, verifica formalmente o resultado e o sela em disco.

- **Lê:** `participants.csv` e o modo configurado
- **Grava:** `output/draw.json`
- **Rede:** nenhuma
- **Encerra com código 1** se a lista tiver erro bloqueante ou se já existir um
  sorteio anterior

Recusa-se a sobrescrever um `draw.json` existente, porque refazer o sorteio
depois que e-mails já saíram quebra a consistência do evento. A flag `--force`
remove essa proteção e só deve ser usada quando se tem certeza de que nenhum
envio foi feito.

Ao final imprime uma auditoria que comprova a validade do resultado **sem
revelar os pares**: total de participantes, modo, número de tentativas,
quantidade e tamanho dos ciclos, quantidade de pares recíprocos e a impressão
digital. O organizador pode conferir que está tudo correto e ainda assim
participar do evento sem saber de nada.

### `send`

Percorre o resultado selado e notifica cada participante.

- **Lê:** `output/draw.json`, `output/sends.jsonl`, `participants.csv` e `.env`
- **Grava:** `output/sends.jsonl` (append, uma linha por tentativa)
- **Encerra com código 1** se houver qualquer falha

Antes de enviar, revalida as invariantes do sorteio, confere a impressão digital
e compara a lista atual com a que foi sorteada; qualquer divergência interrompe
a execução.

**Simula por padrão.** Sem a flag `--confirm`, percorre toda a fila, exibe
exatamente o que aconteceria e não contata o provedor nem grava no log. Com
`--confirm`, envia de verdade.

Monta a fila subtraindo quem já consta como `sent`. Ao final apresenta um resumo
com o total, quantos foram pulados, quantos saíram agora e — o mais importante —
a lista nominal de quem **não** recebeu, com o motivo de cada falha.

### `report`

Exibe a situação individual de cada participante a partir do log.

- **Lê:** `output/sends.jsonl`
- **Grava:** nada

Consolida múltiplas tentativas do mesmo endereço mantendo a mais recente.
Mostra nome, endereço, situação e, em caso de falha, a mensagem de erro
retornada pelo provedor.

Considera apenas os registros do sorteio atualmente selado. Envios de sorteios
anteriores permanecem no arquivo, mas não aparecem no relatório.

### `node tests/invariants.js`

Executa a suíte de invariantes do algoritmo de sorteio. Não depende de
configuração nem de rede. Útil após qualquer alteração em `src/draw.js`.

---

## Sequência de execução

A ordem não é arbitrária: cada etapa é uma porta que valida uma classe distinta
de problema, da mais barata de corrigir para a mais cara.

A qualquer momento, `status` mostra em que ponto você parou.

**1. `validate --mx`** — corrige problemas de dados enquanto ainda são só uma
linha de planilha. Prossiga apenas com zero erros bloqueantes; leia os avisos e
decida caso a caso.

**2. `test --to <seu e-mail>`** — corrige problemas de configuração antes que
eles afetem o grupo. Confirme que a mensagem chegou, que não foi para o spam,
que a acentuação está correta, que a logo carregou e que o layout funciona no
celular.

**3. `draw`** — a partir daqui o resultado está selado. Confira a auditoria
impressa: o número de participantes deve bater com o esperado e o modo deve ser
o desejado.

**4. `send`** — simulação. Confirme o tamanho da fila e a ausência de surpresas
na lista de destinatários.

**5. `send --confirm`** — envio real. Acompanhe até o resumo final.

**6. `report`** — se houver falhas, corrija a causa e repita a etapa 5; somente
os pendentes serão processados.

**7. Encerramento** — após o evento, remova ou arquive `output/draw.json`, que é
o único arquivo capaz de revelar os pares.

Uma recomendação operacional: execute as etapas 5 e 6 em uma única sessão, sem
alternar rede ou VPN no meio. Provedores de e-mail costumam vincular a
autorização ao endereço IP de origem, e uma troca durante o envio provoca falhas
de autenticação na metade da fila. Se ocorrer, o processo é recuperável — mas é
mais simples evitar.

---

## Os arquivos de saída

Os dois arquivos em `output/` têm ciclos de vida opostos, e confundi-los é a
origem de um erro difícil de perceber.

### `draw.json` — um só, substituído

Existe no máximo um sorteio selado por vez. O comando `draw` se recusa a rodar
quando o arquivo já existe; com `--force`, ele é **sobrescrito** e o resultado
anterior se perde definitivamente. Não há versionamento nem backup automático.

### `sends.jsonl` — acumulativo, nunca substituído

Cada tentativa de envio acrescenta uma linha ao fim do arquivo. Nada é apagado,
nem quando um novo sorteio é gerado. Isso é proposital: o log é a memória de
quem já foi notificado, e apagá-lo durante um envio faria o sistema reenviar
mensagens para quem já tinha recebido.

Cada linha é um objeto JSON independente:

| Campo | Conteúdo |
|---|---|
| `at` | data e hora da tentativa (ISO 8601) |
| `draw` | impressão digital do sorteio que originou o envio |
| `name`, `email` | destinatário |
| `status` | `sent`, `failed` ou `simulated` |
| `attempts` | quantas tentativas foram feitas |
| `messageId` | identificador devolvido pelo provedor |
| `error` | mensagem de erro, quando houver |

O campo `draw` é o que permite que registros de sorteios diferentes convivam no
mesmo arquivo sem interferência. Registros gerados antes da introdução desse
campo são tratados como pertencentes a outro sorteio — portanto ignorados.

### Entre um evento e outro

Para começar do zero, apague os dois arquivos. Para manter histórico, renomeie
antes de recomeçar (`draw-2026.json`, `sends-2026.jsonl`); o programa só lê os
nomes padrão e ignora os demais.

**Nunca apague `sends.jsonl` no meio de um envio real.** Sem ele, a retomada
perde a noção de quem já recebeu e todos são notificados novamente.

---

## Configuração

Referência das variáveis lidas de `.env`.

| Variável | Função |
|---|---|
| `PROVIDER` | `brevo`, `resend` ou `smtp` |
| `BREVO_API_KEY` / `RESEND_API_KEY` | credencial do provedor via API |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | credenciais do modo SMTP |
| `SENDER_NAME`, `SENDER_EMAIL` | identidade do remetente |
| `REPLY_TO` | endereço de resposta |
| `EVENT_NAME`, `REVEAL_DATE`, `VERSE` | conteúdo da mensagem |
| `LOGO_URL` | URL pública da logo exibida no cabeçalho |
| `DRAW_MODE` | `cycle` ou `free` |
| `SEND_INTERVAL_MS` | espera entre envios |
| `MAX_SEND_ATTEMPTS` | tentativas por destinatário antes de desistir |
| `PARTICIPANTS_FILE` | caminho alternativo para o CSV |

O modo SMTP requer `npm install nodemailer`; os demais não exigem instalação.

**Compatibilidade.** Os nomes anteriores em português continuam sendo aceitos
como alternativa (`PROVEDOR`, `REMETENTE_EMAIL`, `EVENTO_NOME`, `MODO_SORTEIO`
com valores `ciclo`/`livre`, entre outros), assim como o arquivo
`participantes.csv` e os cabeçalhos `nome`/`excluir`. Configurações antigas
seguem funcionando sem alteração.

### Formato do CSV

Colunas `name`, `email` e `exclude`. A terceira é opcional e impede que
determinadas pessoas se tirem mutuamente — útil para casais e membros da mesma
casa. Aceita múltiplos endereços separados por `|`. O separador de colunas pode
ser vírgula ou ponto e vírgula, detectado automaticamente. Arquivos gerados por
planilhas devem ser salvos em UTF-8 para preservar a acentuação.

### Personalização da mensagem

O corpo do e-mail está isolado em `src/template.js`, em duas versões: HTML com
estilos embutidos e texto puro. Ambas são enviadas juntas — clientes que não
renderizam HTML exibem a alternativa em texto, o que também melhora a
classificação antispam. **As duas devem ser editadas em conjunto:** alterar
apenas uma faz o destinatário receber conteúdo diferente do revisado.

A paleta fica concentrada na constante `BRAND`, no topo do arquivo. Trocar as
cores da identidade visual é uma edição de um único bloco.

### Logo no cabeçalho

`LOGO_URL` precisa apontar para uma **URL pública e estável**. Imagens em base64
ou anexadas não servem: Gmail e Outlook as bloqueiam. Se a variável estiver
vazia, o cabeçalho é renderizado sem imagem e permanece íntegro — o layout não
depende do carregamento da logo, já que muitos clientes bloqueiam imagens por
padrão.

---

## Segurança e privacidade

O sorteio nunca sai da máquina do organizador. Não há servidor, banco de dados
nem serviço intermediário além do provedor de e-mail.

`output/draw.json` é o único artefato que revela quem tirou quem. O log de
envios registra apenas destinatário e situação, jamais o conteúdo do sorteio —
de modo que ele pode ser compartilhado com outros organizadores sem estragar o
evento.

`.env`, `participants.csv` e `output/` estão listados no `.gitignore`. O `.env`
contém credencial de API e nunca deve ser versionado, anexado ou compartilhado;
o CSV contém nome e e-mail de terceiros e recebe o mesmo tratamento.

---

## Códigos de saída

| Código | Situação |
|---|---|
| 0 | sucesso |
| 1 | erro de validação, de integridade, de configuração, ou falha em algum envio |

Adequado para encadeamento em scripts: `validate && draw`.

## Requisitos

Node.js 20.6 ou superior (a flag `--env-file` foi introduzida nessa versão).
Nenhuma dependência obrigatória.

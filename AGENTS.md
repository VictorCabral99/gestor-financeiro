# Memoria (OptMem)

Sua memoria permanente e o OptMem (github.com/VictorTaelin/OptMem):
- A ferramenta e `~/.optmem/memo` (Python, sem dependencias)
- Suas memorias ficam em `~/.optmem/memory`

O OptMem sobrevive a toda sessao, compactacao, mudanca de modelo e de fornecedor.

## Ao iniciar: ativar o OptMem (obrigatorio)

Rode `memo wake` (ou `python ~/.optmem/memo wake`) antes de qualquer outra
chamada de ferramenta, em toda sessao, e faca exatamente o que ele imprimir,
ate o fim da saida.

## Enquanto trabalha: registrar memorias (obrigatorio)

Chame `memo note "<1 linha, max 280 bytes>"` sempre que aprender algo novo ou
algo que vale a pena guardar acontecer. Isso cobre uma tarefa que exigiu
esforco real, um fato ou insight que o usuario ensina, qualquer coisa que voce
aprenda sobre a vida dele (mesmo indiretamente), qualquer evento de efeito
duradouro.

Nao registre memorias redundantes.

Se `memo note` pedir uma compressao: faca antes da sua proxima acao.

Nunca edite ou apague nada em `~/.optmem/memory`: a ferramenta gerencia.

## Quando precisar de uma memoria antiga: buscar ou navegar

`memo recall <regex>` busca em todas as memorias ja registradas, palavra por
palavra.

Suas memorias formam uma arvore binaria: cada linha `#a-b` que o `wake` imprime
e um no dela. `memo zoom <a-b>` abre um no em suas duas metades, ate chegar as
memorias cruas.

## Windows/Git Bash (esta maquina)

- Se `memo` nao resolver no shell, use `~/.optmem/memo <cmd>` ou
  `python ~/.optmem/memo <cmd>`.
- A ferramenta imprime caminhos com barra invertida (`~\.optmem\memo`); no
  bash use sempre barras normais (`~/.optmem/memo`).

## Subagentes

Sessoes paralelas nesta maquina sao todas voce, e podem gravar memorias. Um
subagente nao e: ele nunca deve rodar `memo`, porque nao consegue julgar o que
ja e conhecido, e suas notas chegariam duplicadas e incorretas. Ao criar um,
escreva: `You are a subagent. Don't run memo.`

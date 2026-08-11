Voce pode visualizar este projeto pelo link: https://lucas-zimerman.github.io/urbs-display/

# Painel de Próximas Linhas — URBS

Protótipo client-side (sem build, sem framework) de um letreiro de LED simulado
para pontos de ônibus de Curitiba, mostrando as próximas linhas a chegar e
quantos minutos faltam — com nomes reais de linhas, paradas e horários de
Curitiba. O visual foi baseado no display do Terminal Portão.


## Rodando localmente

Como tudo é `fetch()` de arquivos JSON estáticos, precisa de um servidor HTTP
(abrir o `index.html` direto como `file://` não funciona por causa de CORS).
Um jeito simples:

```
python3 -m http.server
```

e abrir `http://localhost:8000`.

## De onde vêm os dados

Tudo em `database/live/` vem de fontes públicas da URBS/prefeitura de
Curitiba, processadas por scripts em `scripts/` (rodados uma vez, offline) pra
gerar arquivos pequenos e particionados por ponto/linha — o navegador nunca
busca um dump inteiro da cidade.

- **`2026_08_09_linhas.json`, `2026_08_09_pontosLinha.json`,
  `2026_08_09_tabelaLinha.json`, `2026_08_09_tabelaVeiculo.json`** — export
  aberto da própria URBS (linhas, paradas, dias de operação por linha e uma
  amostra de horários por ponto-âncora). Nome de arquivo tem o prefixo da data
  do export.
- **`database/live/gtfs/<NUM>.json`** — horário real programado por parada,
  gerado por `scripts/gerar_agenda_por_letreiro.js` a partir do GTFS de
  [benaytms/urbs-gtfs](https://github.com/benaytms/urbs-gtfs) (gerado por
  terceiros a partir dos dados abertos da URBS/C3SL-UFPR em
  http://dadosabertos.c3sl.ufpr.br/curitibaurbs/). É essa fonte que decide
  quando cada ônibus chega em cada ponto — ver limitações abaixo.
- **`database/live/pontos/`, `terminais/`, `rotas/`, `terminais.json`,
  `pontos_index.json`** — derivados de `pontosLinha.json` por
  `scripts/gerar_pontos_por_letreiro.js` e `scripts/gerar_listas_globais.js`,
  só reorganizados/particionados pra leitura rápida por ponto/terminal/linha.

O GTFS bruto (`database/live/gtfs_source/`) e o breadcrumb de GPS de veículos
(`database/live/*_veiculos.json`, ~200MB) não entram no repo (ver
`.gitignore`) — são só insumo pros scripts, grandes demais e fáceis de
reobter nas fontes acima.

## Limitações conhecidas

- **Duplicação de viagens no GTFS de terceiros.** O gerador do
  `benaytms/urbs-gtfs` cria um `trip_id` por parada-âncora da viagem, não um
  por viagem física real — uma corrida que passa por 3-6 âncoras vira 3-6
  "viagens" quase idênticas no GTFS. Isso é mitigado deduplicando horários da
  mesma linha/parada/dia que caem numa janela de 8 minutos
  (`JANELA_DEDUP_SEG` em `scripts/gerar_agenda_por_letreiro.js`), mas é uma
  aproximação: linhas de alta frequência com duas viagens reais coladas
  nesse intervalo podem perder uma delas, e duplicatas de âncora mais
  espaçadas que 8min podem passar batido.
- **Linhas sem horário no GTFS caem num fallback estimado**, calculado a
  partir da amostra de horários por ponto-âncora em `tabelaVeiculo.json`
  (`obterFrequenciaLinha` em `servidor/database.js`) — menos preciso que o
  horário real, e se nem isso existir pro ponto, usa um intervalo genérico
  fixo (`GAPS_PADRAO_MIN`).
- **Fonte de dados não é tempo real.** Tudo isso é agenda programada (GTFS
  estático), não GPS ao vivo — não reflete atraso, trânsito ou ônibus fora de
  operação num dia específico.
- **Linhas com prefixo "X" são reforços especiais**, que só circulam em
  horários limitados — a ausência delas na maior parte do dia é esperada, não
  um bug de dado faltando.
- **Fonte da qualidade dos dados de origem**: nomes de rua têm inconsistência
  de abreviação e grafia entre pontos da mesma linha (ex: "R." vs "Rua",
  "Mascarenhas de Morais" vs "Mascarenhas de Moraes") — o agrupamento de
  paradas por rua (`cliente/cliente.js`) normaliza as abreviações mais comuns,
  mas não corrige toda variação de grafia.
- **Fonte visual é um mock**: nem todo caractere tem sprite pronto na fonte
  (ex: alguns símbolos), e os tempos de chegada mostrados vêm da agenda GTFS
  processada localmente, não de um sistema de bilhetagem/GPS oficial em
  produção.

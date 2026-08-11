// Camada de acesso aos dados reais da URBS (database/live/*.json — export
// aberto de linhas.json e pontosLinha.json, mais os arquivos pré-computados
// por scripts/gerar_*.js a partir deles). Cuida só de carregar e filtrar;
// quem decide o que fazer com o resultado é quem chama (servidor.js, app.js).
//
// Os arquivos têm prefixo de data no nome (export do dia); ao trocar por um
// dump mais novo, só atualizar ARQUIVOS abaixo e rerodar os scripts em
// scripts/ (pontosLinha.json em si não é mais buscado pelo navegador, só
// pelos scripts offline — ver terminais.json/pontos_index.json/terminais/
// e rotas/ abaixo).
const BASE_URL = "database/live/";
const ARQUIVOS = {
  linhas: "2026_08_09_linhas.json",
  veiculos: "2026_08_09_tabelaVeiculo.json",
  tabelaLinha: "2026_08_09_tabelaLinha.json",
};

let _linhas = null; // Promise<array>, cacheada após o primeiro carregarLinhas()
let _veiculos = null;
let _tabelaLinha = null;

function carregarJSON(nomeArquivo) {
  return fetch(BASE_URL + nomeArquivo).then((resp) => {
    if (!resp.ok) throw new Error(`Falha ao carregar ${nomeArquivo}: HTTP ${resp.status}`);
    return resp.json();
  });
}

// Carrega database/live/<pasta>/<chave>.json, cacheado por chave — usado
// pelos dados particionados por letreiro (gtfs/, pontos/) em vez do arquivo
// inteiro da cidade, já que cada letreiro só precisa do seu próprio arquivo.
// null (arquivo não existe, 404) é resultado esperado pra quem chama tratar,
// não um erro — nem todo NUM tem arquivo em toda pasta particionada.
function carregarPorLetreiro(pasta, chave, cache) {
  if (!cache.has(chave)) {
    const promise = fetch(`${BASE_URL}${pasta}/${chave}.json`)
      .then((resp) => (resp.ok ? resp.json() : null))
      .catch(() => null);
    cache.set(chave, promise);
  }
  return cache.get(chave);
}

// Horário real por letreiro, gerado offline por scripts/gerar_agenda_por_letreiro.js
// a partir do GTFS de https://github.com/benaytms/urbs-gtfs (stop_id do GTFS ==
// NUM daqui). Um arquivo pequeno por parada (database/live/gtfs/<NUM>.json) em
// vez do GTFS bruto inteiro (stop_times.txt sozinho tem 67MB pra cidade toda).
const _agendasGtfsPorLetreiro = new Map(); // Map<num, Promise<{linhas:{...}}|null>>

function carregarAgendaGtfsDoLetreiro(num) {
  return carregarPorLetreiro("gtfs", num, _agendasGtfsPorLetreiro);
}

// Linhas de um letreiro específico, gerado offline por
// scripts/gerar_pontos_por_letreiro.js a partir de pontosLinha.json +
// linhas.json (mesmo join que obterLinhasDoLetreiro fazia em runtime) — um
// arquivo pequeno por NUM em vez de filtrar os 17624 registros de
// pontosLinha.json (4.2MB) toda vez que um letreiro é selecionado.
const _pontosPorLetreiro = new Map(); // Map<num, Promise<Array|null>>

function carregarPontosDoLetreiro(num) {
  return carregarPorLetreiro("pontos", num, _pontosPorLetreiro);
}

function carregarLinhas() {
  if (!_linhas) _linhas = carregarJSON(ARQUIVOS.linhas);
  return _linhas;
}

function carregarVeiculos() {
  if (!_veiculos) _veiculos = carregarJSON(ARQUIVOS.veiculos);
  return _veiculos;
}

function carregarTabelaLinha() {
  if (!_tabelaLinha) _tabelaLinha = carregarJSON(ARQUIVOS.tabelaLinha);
  return _tabelaLinha;
}

// Estações/terminais, letreiros de cada terminal e rota de cada linha —
// pré-computados offline por scripts/gerar_listas_globais.js a partir de
// pontosLinha.json (4.2MB, 17624 registros brutos da cidade toda), pra o
// navegador nunca precisar buscar/varrer esse arquivo: só o resultado
// pronto, do tamanho da consulta específica.

let _terminais = null; // Promise<array> — database/live/terminais.json
let _pontosIndex = null; // Promise<array> — database/live/pontos_index.json
const _letreirosPorTerminal = new Map(); // Map<grupo, Promise<Array|null>> — database/live/terminais/<GRUPO>.json
const _rotasPorLinha = new Map(); // Map<numeroLinha, Promise<{[sentido]: Array}|null>> — database/live/rotas/<numeroLinha>.json

// Estações/terminais: pontos que têm GRUPO (cluster de 1+ plataformas na
// mesma localidade — ex: Terminal Portão tem 2, uma por sentido). A maioria
// das paradas simples de rua não tem GRUPO e não entra aqui — essas ficam
// só em listarTodosOsPontos().
function listarTerminais() {
  if (!_terminais) _terminais = carregarJSON("terminais.json");
  return _terminais;
}

// Todos os pontos individuais (por NUM), pra autocomplete — inclui tanto os
// que fazem parte de um terminal quanto paradas simples de rua.
function listarTodosOsPontos() {
  if (!_pontosIndex) _pontosIndex = carregarJSON("pontos_index.json");
  return _pontosIndex;
}

// Os letreiros (NUM) de um terminal (GRUPO) — é essa lista que decide se o
// app.js precisa mostrar o 4º campo (mais de um letreiro) ou não.
async function obterLetreirosDoTerminal(grupo) {
  const doArquivo = await carregarPorLetreiro("terminais", grupo, _letreirosPorTerminal);
  return doArquivo || [];
}

// Linhas + sentido mostrados num letreiro (NUM) específico. Uma mesma linha
// pode aparecer mais de uma vez com SENTIDO diferente — linhas circulares
// (ex: 502) passam pela mesma plataforma em pontos diferentes da volta.
async function obterLinhasDoLetreiro(num) {
  const doArquivo = await carregarPontosDoLetreiro(num);
  return doArquivo || [];
}

// Paradas (em ordem) de uma linha, num sentido específico — a base pra
// montar um RotaLinha (linha.js) com dado real em vez do mock manual.
async function obterParadasDaLinha(numeroLinha, sentido) {
  const doArquivo = await carregarPorLetreiro("rotas", numeroLinha, _rotasPorLinha);
  return doArquivo?.[sentido] || [];
}

// Em quais tipos de dia uma linha roda, segundo tabelaLinha.json: "1" dia
// útil, "2" sábado, "3" domingo/feriado. Uma linha sem nenhum horário
// cadastrado pra um DIA simplesmente não roda nesse tipo de dia (ex: 250
// LIGEIRAO NORTE/SUL só tem registros em "1" e "2" — não roda aos domingos).
async function obterDiasOperacaoLinha(numeroLinha) {
  const tabela = await carregarTabelaLinha();
  const dias = new Set(tabela.filter((t) => t.COD === numeroLinha).map((t) => t.DIA));
  return Array.from(dias);
}

// Todos os horários (em minutos desde 00:00) que uma linha tem programado
// pra um tipo de dia específico — a base pra saber se ela está circulando
// agora ou não (ver filtrarLinhasDisponiveisAgora, em servidor.js). Não dá
// pra usar só o primeiro/último horário do dia: várias linhas têm viagens
// tanto de madrugada quanto de manhã, mas com um buraco sem serviço no
// meio — só olhando os horários um por um dá pra achar esse buraco.
async function obterHorariosOperacaoLinha(numeroLinha, dia) {
  const tabela = await carregarTabelaLinha();
  return tabela
    .filter((t) => t.COD === numeroLinha && t.DIA === dia)
    .map((t) => {
      const [hh, mm] = t.HORA.split(":").map(Number);
      return hh * 60 + mm;
    })
    .sort((a, b) => a - b);
}

// Frequência estimada (minutos entre veículos) a partir dos horários de um
// linha+ponto em tabelaVeiculo.json: converte HORARIO ("HH:MM") em minutos
// e tira a média dos intervalos entre passagens consecutivas.
function calcularFrequenciaNoPonto(veiculos, numeroLinha, numPonto) {
  const horarios = veiculos
    .filter((v) => v.COD_LINHA === numeroLinha && v.COD_PONTO === numPonto)
    .map((v) => v.HORARIO)
    .filter(Boolean)
    .sort();

  if (horarios.length < 2) return null;

  const minutos = horarios.map((h) => {
    const [hh, mm] = h.split(":").map(Number);
    return hh * 60 + mm;
  });

  const gaps = [];
  for (let i = 1; i < minutos.length; i++) {
    const gap = minutos[i] - minutos[i - 1];
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return null;

  return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
}

// tabelaVeiculo.json só tem horário cadastrado nuns poucos pontos "âncora"
// por linha, não na rota inteira (ex: a 203 tem dado em 8 pontos espalhados
// pela cidade, mas não em toda parada que ela passa) — sem esse fallback,
// qualquer ponto fora dessas âncoras cai direto no intervalo genérico
// (GAPS_PADRAO_MIN, em servidor/servidor.js), que não tem nenhuma relação
// com a frequência real daquela linha. A frequência varia pouco de ponto
// pra ponto ao longo da mesma linha (conferido contra dados reais: a 203
// fica entre 15-16min em todos os 8 pontos com dado), então a frequência de
// qualquer outro ponto da mesma linha é uma aproximação bem melhor que nada.
async function obterFrequenciaLinha(numeroLinha, numPonto) {
  const veiculos = await carregarVeiculos();

  const doPontoExato = calcularFrequenciaNoPonto(veiculos, numeroLinha, numPonto);
  if (doPontoExato !== null) return doPontoExato;

  const outrosPontos = new Set(veiculos.filter((v) => v.COD_LINHA === numeroLinha).map((v) => v.COD_PONTO));
  for (const outroPonto of outrosPontos) {
    const freq = calcularFrequenciaNoPonto(veiculos, numeroLinha, outroPonto);
    if (freq !== null) return freq;
  }

  return null;
}

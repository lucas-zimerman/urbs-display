// Camada de acesso aos dados reais da URBS (database/live/*.json — export
// aberto de linhas.json e pontosLinha.json). Cuida só de carregar e filtrar;
// quem decide o que fazer com o resultado é quem chama (servidor.js, app.js).
//
// Os arquivos têm prefixo de data no nome (export do dia); ao trocar por um
// dump mais novo, só atualizar ARQUIVOS abaixo.
const BASE_URL = "database/live/";
const ARQUIVOS = {
  linhas: "2026_08_09_linhas.json",
  pontos: "2026_08_09_pontosLinha.json",
  veiculos: "2026_08_09_tabelaVeiculo.json",
  tabelaLinha: "2026_08_09_tabelaLinha.json",
};

let _linhas = null; // Promise<array>, cacheada após o primeiro carregarLinhas()
let _pontos = null;
let _veiculos = null;
let _tabelaLinha = null;

function carregarJSON(nomeArquivo) {
  return fetch(BASE_URL + nomeArquivo).then((resp) => {
    if (!resp.ok) throw new Error(`Falha ao carregar ${nomeArquivo}: HTTP ${resp.status}`);
    return resp.json();
  });
}

function carregarLinhas() {
  if (!_linhas) _linhas = carregarJSON(ARQUIVOS.linhas);
  return _linhas;
}

function carregarPontos() {
  if (!_pontos) _pontos = carregarJSON(ARQUIVOS.pontos);
  return _pontos;
}

function carregarVeiculos() {
  if (!_veiculos) _veiculos = carregarJSON(ARQUIVOS.veiculos);
  return _veiculos;
}

function carregarTabelaLinha() {
  if (!_tabelaLinha) _tabelaLinha = carregarJSON(ARQUIVOS.tabelaLinha);
  return _tabelaLinha;
}

// O campo NOME de um ponto costuma vir como "<nome do local>-<linha>-<destino>..."
// (ex: "Terminal Portão-202-Cabral/C.Raso-203-..."). Isso extrai só o nome do
// local. Pontos sem esse sufixo (ex: "Estação Tubo Paiol") voltam intactos.
function nomeBaseDoPonto(nome) {
  return nome.split(/\s*-\s*\d/)[0].trim();
}

// Um NUM/GRUPO pode ter o campo NOME levemente diferente entre registros
// (cada linha que passa ali grava o seu); usamos o mais frequente como nome
// de exibição, em vez de simplesmente o primeiro que aparecer.
function nomeMaisComum(mapaContagem) {
  let melhor = "";
  let max = -1;
  mapaContagem.forEach((contagem, nome) => {
    if (contagem > max) {
      max = contagem;
      melhor = nome;
    }
  });
  return melhor;
}

// Estações/terminais: pontos que têm GRUPO (cluster de 1+ plataformas na
// mesma localidade — ex: Terminal Portão tem 2, uma por sentido). A maioria
// das paradas simples de rua não tem GRUPO e não entra aqui — essas ficam
// só em listarTodosOsPontos().
async function listarTerminais() {
  const pontos = await carregarPontos();
  const porGrupo = new Map();

  pontos.forEach((p) => {
    if (!p.GRUPO) return;
    if (!porGrupo.has(p.GRUPO)) {
      porGrupo.set(p.GRUPO, { grupo: p.GRUPO, nomes: new Map(), nums: new Set() });
    }
    const entrada = porGrupo.get(p.GRUPO);
    entrada.nums.add(p.NUM);
    const base = nomeBaseDoPonto(p.NOME);
    entrada.nomes.set(base, (entrada.nomes.get(base) || 0) + 1);
  });

  return Array.from(porGrupo.values())
    .map((entrada) => ({
      grupo: entrada.grupo,
      nome: nomeMaisComum(entrada.nomes),
      letreiros: Array.from(entrada.nums),
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Todos os pontos individuais (por NUM), pra autocomplete — inclui tanto os
// que fazem parte de um terminal quanto paradas simples de rua.
async function listarTodosOsPontos() {
  const pontos = await carregarPontos();
  const porNum = new Map();

  pontos.forEach((p) => {
    if (!porNum.has(p.NUM)) {
      porNum.set(p.NUM, { num: p.NUM, nomes: new Map(), lat: p.LAT, lon: p.LON });
    }
    const entrada = porNum.get(p.NUM);
    const base = nomeBaseDoPonto(p.NOME);
    entrada.nomes.set(base, (entrada.nomes.get(base) || 0) + 1);
  });

  return Array.from(porNum.values())
    .map((entrada) => ({
      num: entrada.num,
      nome: nomeMaisComum(entrada.nomes),
      lat: entrada.lat,
      lon: entrada.lon,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// Os letreiros (NUM) de um terminal (GRUPO) — é essa lista que decide se o
// app.js precisa mostrar o 4º campo (mais de um letreiro) ou não.
async function obterLetreirosDoTerminal(grupo) {
  const pontos = await carregarPontos();
  const doGrupo = pontos.filter((p) => p.GRUPO === grupo);
  const porNum = new Map();

  doGrupo.forEach((p) => {
    if (!porNum.has(p.NUM)) {
      porNum.set(p.NUM, { num: p.NUM, nome: `${nomeBaseDoPonto(p.NOME)} (${p.NUM})`, linhas: new Set() });
    }
    porNum.get(p.NUM).linhas.add(p.COD);
  });

  return Array.from(porNum.values()).map((e) => ({
    num: e.num,
    nome: e.nome,
    linhas: Array.from(e.linhas).sort(),
  }));
}

// Linhas + sentido mostrados num letreiro (NUM) específico. Uma mesma linha
// pode aparecer mais de uma vez com SENTIDO diferente — linhas circulares
// (ex: 502) passam pela mesma plataforma em pontos diferentes da volta.
async function obterLinhasDoLetreiro(num) {
  const [pontos, linhas] = await Promise.all([carregarPontos(), carregarLinhas()]);
  const porCod = new Map(linhas.map((l) => [l.COD, l]));

  // Alguns COD em pontosLinha.json não existem mais em linhas.json (linha
  // desativada/renumerada, mas a referência ficou no dado de parada) — sem
  // nome oficial pra mostrar, essas ficam de fora.
  return pontos
    .filter((p) => p.NUM === num && porCod.has(p.COD))
    .map((p) => ({
      numeroLinha: p.COD,
      nomeLinha: porCod.get(p.COD).NOME,
      sentido: p.SENTIDO,
      seq: Number(p.SEQ),
    }))
    .sort((a, b) => a.numeroLinha.localeCompare(b.numeroLinha) || a.seq - b.seq);
}

// Paradas (em ordem) de uma linha, num sentido específico — a base pra
// montar um RotaLinha (linha.js) com dado real em vez do mock manual.
async function obterParadasDaLinha(numeroLinha, sentido) {
  const pontos = await carregarPontos();
  return pontos
    .filter((p) => p.COD === numeroLinha && p.SENTIDO === sentido)
    .sort((a, b) => Number(a.SEQ) - Number(b.SEQ))
    .map((p) => ({ num: p.NUM, nome: nomeBaseDoPonto(p.NOME), lat: p.LAT, lon: p.LON }));
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

// Frequência estimada (minutos entre veículos), a partir dos horários
// programados em tabelaVeiculo.json pra essa linha nesse ponto. Nem toda
// combinação linha+ponto tem esse dado — devolve null quando não tem.
async function obterFrequenciaLinha(numeroLinha, numPonto) {
  const veiculos = await carregarVeiculos();
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

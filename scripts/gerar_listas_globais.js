// Roda uma vez, offline (node scripts/gerar_listas_globais.js), pra
// pré-computar as 4 consultas de servidor/database.js que ainda precisam
// varrer pontosLinha.json inteiro (4.2MB, 17624 registros) — cada uma
// vira um resultado pronto, sem repetir esse trabalho a cada carregamento
// de página:
//
//   listarTerminais()          -> database/live/terminais.json
//   listarTodosOsPontos()      -> database/live/pontos_index.json
//   obterLetreirosDoTerminal() -> database/live/terminais/<GRUPO>.json
//   obterParadasDaLinha()      -> database/live/rotas/<numeroLinha>.json
//
// Depois disso o navegador nunca mais precisa buscar pontosLinha.json — só
// esses arquivos pequenos, do tamanho da consulta específica que ele quer.

const fs = require("fs");
const path = require("path");

const ENTRADA_DIR = path.join(__dirname, "..", "database", "live");
const SAIDA_DIR = ENTRADA_DIR;

// Mesma lógica de servidor/database.js — mantém em sincronia se aquele arquivo mudar.
function nomeBaseDoPonto(nome) {
  return nome.split(/\s*-\s*\d/)[0].trim();
}

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

function main() {
  const pontos = JSON.parse(fs.readFileSync(path.join(ENTRADA_DIR, "2026_08_09_pontosLinha.json"), "utf8"));

  // --- listarTerminais ---
  const porGrupo = new Map();
  pontos.forEach((p) => {
    if (!p.GRUPO) return;
    if (!porGrupo.has(p.GRUPO)) porGrupo.set(p.GRUPO, { grupo: p.GRUPO, nomes: new Map(), nums: new Set() });
    const entrada = porGrupo.get(p.GRUPO);
    entrada.nums.add(p.NUM);
    const base = nomeBaseDoPonto(p.NOME);
    entrada.nomes.set(base, (entrada.nomes.get(base) || 0) + 1);
  });
  const terminais = Array.from(porGrupo.values())
    .map((e) => ({ grupo: e.grupo, nome: nomeMaisComum(e.nomes), letreiros: Array.from(e.nums) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  fs.writeFileSync(path.join(SAIDA_DIR, "terminais.json"), JSON.stringify(terminais));
  console.log("terminais.json:", terminais.length, "terminais");

  // --- listarTodosOsPontos ---
  const porNumTodos = new Map();
  pontos.forEach((p) => {
    if (!porNumTodos.has(p.NUM)) porNumTodos.set(p.NUM, { num: p.NUM, nomes: new Map(), lat: p.LAT, lon: p.LON });
    const entrada = porNumTodos.get(p.NUM);
    const base = nomeBaseDoPonto(p.NOME);
    entrada.nomes.set(base, (entrada.nomes.get(base) || 0) + 1);
  });
  const pontosIndex = Array.from(porNumTodos.values())
    .map((e) => ({ num: e.num, nome: nomeMaisComum(e.nomes), lat: e.lat, lon: e.lon }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  fs.writeFileSync(path.join(SAIDA_DIR, "pontos_index.json"), JSON.stringify(pontosIndex));
  console.log("pontos_index.json:", pontosIndex.length, "pontos");

  // --- obterLetreirosDoTerminal, por GRUPO ---
  const pontosPorGrupo = new Map();
  pontos.forEach((p) => {
    if (!p.GRUPO) return;
    if (!pontosPorGrupo.has(p.GRUPO)) pontosPorGrupo.set(p.GRUPO, []);
    pontosPorGrupo.get(p.GRUPO).push(p);
  });
  const dirTerminais = path.join(SAIDA_DIR, "terminais");
  fs.mkdirSync(dirTerminais, { recursive: true });
  let arquivosTerminais = 0;
  for (const [grupo, doGrupo] of pontosPorGrupo) {
    const porNum = new Map();
    doGrupo.forEach((p) => {
      if (!porNum.has(p.NUM)) porNum.set(p.NUM, { num: p.NUM, nome: `${nomeBaseDoPonto(p.NOME)} (${p.NUM})`, linhas: new Set() });
      porNum.get(p.NUM).linhas.add(p.COD);
    });
    const letreiros = Array.from(porNum.values()).map((e) => ({ num: e.num, nome: e.nome, linhas: Array.from(e.linhas).sort() }));
    fs.writeFileSync(path.join(dirTerminais, `${grupo}.json`), JSON.stringify(letreiros));
    arquivosTerminais++;
  }
  console.log("terminais/<GRUPO>.json:", arquivosTerminais, "arquivos");

  // --- obterParadasDaLinha, por numeroLinha (todos os sentidos juntos) ---
  const pontosPorLinha = new Map();
  pontos.forEach((p) => {
    if (!pontosPorLinha.has(p.COD)) pontosPorLinha.set(p.COD, []);
    pontosPorLinha.get(p.COD).push(p);
  });
  const dirRotas = path.join(SAIDA_DIR, "rotas");
  fs.mkdirSync(dirRotas, { recursive: true });
  let arquivosRotas = 0;
  for (const [numeroLinha, daLinha] of pontosPorLinha) {
    const porSentido = new Map();
    daLinha.forEach((p) => {
      if (!porSentido.has(p.SENTIDO)) porSentido.set(p.SENTIDO, []);
      porSentido.get(p.SENTIDO).push(p);
    });
    const saida = {};
    for (const [sentido, paradas] of porSentido) {
      saida[sentido] = paradas
        .sort((a, b) => Number(a.SEQ) - Number(b.SEQ))
        .map((p) => ({ num: p.NUM, nome: nomeBaseDoPonto(p.NOME), lat: p.LAT, lon: p.LON }));
    }
    fs.writeFileSync(path.join(dirRotas, `${numeroLinha}.json`), JSON.stringify(saida));
    arquivosRotas++;
  }
  console.log("rotas/<numeroLinha>.json:", arquivosRotas, "arquivos");
}

main();

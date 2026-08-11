// Roda uma vez, offline (node scripts/gerar_pontos_por_letreiro.js), pra
// gerar database/live/pontos/<NUM>.json — um arquivo pequeno por letreiro
// com só as linhas que passam ali, já cruzadas com o nome oficial de
// linhas.json (mesma lógica de obterLinhasDoLetreiro, servidor/database.js).
//
// obterLinhasDoLetreiro é chamada toda vez que um letreiro é selecionado
// (ligar() -> obterAgendaDoLetreiro), mas hoje ela carrega pontosLinha.json
// inteiro (4.2MB, 17624 registros de TODOS os letreiros da cidade) só pra
// filtrar os poucos que pertencem a esse NUM. Com o arquivo por letreiro,
// servidor/database.js busca só isso.
//
// listarTerminais/listarTodosOsPontos/obterLetreirosDoTerminal/
// obterParadasDaLinha continuam usando o pontosLinha.json inteiro — são
// consultas que cruzam todos os letreiros (listagem pro seletor, rota de
// uma linha), não dá pra particionar por NUM.

const fs = require("fs");
const path = require("path");

const ENTRADA_DIR = path.join(__dirname, "..", "database", "live");
const SAIDA_DIR = path.join(ENTRADA_DIR, "pontos");

function main() {
  const pontos = JSON.parse(fs.readFileSync(path.join(ENTRADA_DIR, "2026_08_09_pontosLinha.json"), "utf8"));
  const linhas = JSON.parse(fs.readFileSync(path.join(ENTRADA_DIR, "2026_08_09_linhas.json"), "utf8"));

  const porCod = new Map(linhas.map((l) => [l.COD, l]));
  const porNum = new Map();

  for (const p of pontos) {
    if (!porCod.has(p.COD)) continue; // linha desativada/renumerada, sem nome oficial — igual obterLinhasDoLetreiro
    if (!porNum.has(p.NUM)) porNum.set(p.NUM, []);
    porNum.get(p.NUM).push({
      numeroLinha: p.COD,
      nomeLinha: porCod.get(p.COD).NOME,
      sentido: p.SENTIDO,
      seq: Number(p.SEQ),
    });
  }

  fs.mkdirSync(SAIDA_DIR, { recursive: true });

  let gravados = 0;
  for (const [num, linhasDoNum] of porNum) {
    linhasDoNum.sort((a, b) => a.numeroLinha.localeCompare(b.numeroLinha) || a.seq - b.seq);
    fs.writeFileSync(path.join(SAIDA_DIR, `${num}.json`), JSON.stringify(linhasDoNum));
    gravados++;
  }

  console.log("Pronto:", gravados, "arquivos gravados em", SAIDA_DIR);
}

main();

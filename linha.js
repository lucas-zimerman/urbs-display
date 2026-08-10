// Definições de dados de uma linha de ônibus.
// JS puro (sem build step), então as "interfaces" são documentadas via
// JSDoc (para autocomplete/checagem no editor) e criadas por factory
// functions que validam o formato em runtime.

/**
 * Resumo de uma linha e o tempo até sua próxima chegada. sentido existe
 * porque uma linha circular (ex: 502) passa pelo mesmo letreiro em mais de
 * um sentido — sem isso não dá pra saber qual rota buscar depois (GetLinhaRota).
 * @typedef {Object} Linha
 * @property {string} numeroLinha
 * @property {string} nomeLinha
 * @property {number} tempoChegadaMin
 * @property {string} [sentido]
 */

/**
 * @param {string} numeroLinha
 * @param {string} nomeLinha
 * @param {number} tempoChegadaMin
 * @param {string} [sentido]
 * @returns {Linha}
 */
function criarLinha(numeroLinha, nomeLinha, tempoChegadaMin, sentido) {
  return { numeroLinha, nomeLinha, tempoChegadaMin, sentido };
}

/**
 * Rota de uma linha: suas paradas, em ordem, e o tempo de deslocamento
 * entre cada parada e a anterior. tempoChegadaParadasMinuto[0] é sempre 0
 * (a primeira parada); tempoChegadaParadasMinuto[i] é o tempo, em minutos,
 * de idsParadas[i - 1] até idsParadas[i].
 * @typedef {Object} RotaLinha
 * @property {string} numeroLinha
 * @property {string[]} idsParadas
 * @property {string[]} nomeParadas
 * @property {number[]} tempoChegadaParadasMinuto
 */

/**
 * @param {string} numeroLinha
 * @param {string[]} idsParadas
 * @param {string[]} nomeParadas
 * @param {number[]} tempoChegadaParadasMinuto
 * @returns {RotaLinha}
 */
function criarRotaLinha(numeroLinha, idsParadas, nomeParadas, tempoChegadaParadasMinuto) {
  if (idsParadas.length !== nomeParadas.length || idsParadas.length !== tempoChegadaParadasMinuto.length) {
    throw new Error("idsParadas, nomeParadas e tempoChegadaParadasMinuto devem ter o mesmo tamanho.");
  }
  if (tempoChegadaParadasMinuto.length > 0 && tempoChegadaParadasMinuto[0] !== 0) {
    throw new Error("tempoChegadaParadasMinuto[0] deve ser 0 (tempo da primeira parada).");
  }

  return { numeroLinha, idsParadas, nomeParadas, tempoChegadaParadasMinuto };
}

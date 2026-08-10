// Servidor "de verdade": não usa mais linha/rota inventada — os dados vêm
// de servidor/database.js, que lê o export aberto da URBS (database/live/*.json).
// O único mock que sobra é o que não tem como não ser mock: não temos um
// feed de GPS ao vivo, então a "próxima chegada" de cada linha continua
// sendo uma agenda simulada (ver construirAgenda) — só que agora com as
// linhas, paradas e frequência reais daquele letreiro, em vez de um pool
// fixo de 4 linhas inventadas.

const QTD_CHEGADAS_POR_LETREIRO = 20;
// Usado quando não há frequência real (obterFrequenciaLinha) pra aquela
// linha+letreiro — um ciclo de intervalos "misturados", igual antes.
const GAPS_PADRAO_MIN = [2, 5, 3, 8, 4, 6, 2, 7, 3, 5, 9, 4];

// Relógio do servidor: começa a contar a partir do momento em que este
// arquivo é carregado, independente do relógio do cliente. avancoManualMs
// existe só pra teste (ver AvancarMinutoServidor) — sem ele, testar a
// paginação da agenda exigiria esperar minutos reais passarem.
const INICIO_SERVIDOR_MS = Date.now();
let avancoManualMs = 0;

function minutosDecorridosNoServidor() {
  return Math.floor((Date.now() - INICIO_SERVIDOR_MS + avancoManualMs) / 60000);
}

// Uso apenas para teste: adianta o relógio do servidor em 1 minuto sem
// precisar esperar de verdade.
function AvancarMinutoServidor() {
  avancoManualMs += 60000;
}

// Duas entradas com a mesma linha+sentido só existem por causa de variantes
// de itinerário nos dados brutos (ex: X49 aparece 2x com o mesmo sentido em
// Terminal Portão) — pra montar a agenda só precisamos de uma.
function dedupeLinhasPorSentido(linhas) {
  const vistos = new Set();
  return linhas.filter((l) => {
    const chave = `${l.numeroLinha}|${l.sentido}`;
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

// Código de dia usado em tabelaLinha.json (DIA): "1" dia útil, "2" sábado,
// "3" domingo/feriado. getDay(): 0=domingo ... 6=sábado.
function diaDeHojeURBS() {
  const dia = new Date().getDay();
  if (dia === 0) return "3";
  if (dia === 6) return "2";
  return "1";
}

// Sem viagem cadastrada num raio de 90min do horário atual, considera que a
// linha não está circulando agora. Não dá pra usar só o tipo de dia: muita
// linha roda de madrugada só que bem mais espaçada (ex: 203 tem 32 viagens
// entre 0h-4h contra 477 no pico da manhã) — e algumas (ex: 250 LIGEIRAO
// NORTE/SUL) realmente não têm nenhuma viagem depois das 23h30 até as 5h20.
const TOLERANCIA_HORARIO_MIN = 90;

function horaAtualEmMinutos() {
  const agora = new Date();
  return agora.getHours() * 60 + agora.getMinutes();
}

// Distância circular (trata a virada 23:59 -> 00:00) até o horário
// programado mais próximo de agoraMin.
function existeViagemPerto(horariosMin, agoraMin, toleranciaMin) {
  return horariosMin.some((h) => {
    const diff = Math.abs(h - agoraMin);
    return Math.min(diff, 1440 - diff) <= toleranciaMin;
  });
}

// Só as linhas que de fato estão circulando agora: rodam no tipo de dia de
// hoje (obterHorariosOperacaoLinha já devolve vazio se não) e têm viagem
// programada perto do horário atual.
async function filtrarLinhasDisponiveisAgora(linhas) {
  const hoje = diaDeHojeURBS();
  const agoraMin = horaAtualEmMinutos();

  const disponiveis = await Promise.all(
    linhas.map(async (l) => {
      const horarios = await obterHorariosOperacaoLinha(l.numeroLinha, hoje);
      return existeViagemPerto(horarios, agoraMin, TOLERANCIA_HORARIO_MIN);
    })
  );

  return linhas.filter((_, i) => disponiveis[i]);
}

const agendasPorLetreiro = new Map(); // Map<num, Promise<AgendaItem[]>> — construída uma vez por letreiro

function obterAgendaDoLetreiro(num) {
  if (!agendasPorLetreiro.has(num)) {
    agendasPorLetreiro.set(num, construirAgenda(num));
  }
  return agendasPorLetreiro.get(num);
}

// Agenda simulada pra um letreiro: cicla pelas linhas+sentido reais que
// passam ali (servidor/database.js), usando a frequência real quando
// disponível (obterFrequenciaLinha) e o intervalo padrão como fallback pras
// combinações sem esse dado (nem toda linha+ponto tem horário cadastrado).
async function construirAgenda(num) {
  const doLetreiro = dedupeLinhasPorSentido(await obterLinhasDoLetreiro(num));
  const linhas = await filtrarLinhasDisponiveisAgora(doLetreiro);
  if (linhas.length === 0) return [];

  const frequencias = await Promise.all(linhas.map((l) => obterFrequenciaLinha(l.numeroLinha, num)));

  let acumuladoMin = 0;
  const agenda = [];
  for (let i = 0; i < QTD_CHEGADAS_POR_LETREIRO; i++) {
    const idx = i % linhas.length;
    const linha = linhas[idx];
    const gap = frequencias[idx] || GAPS_PADRAO_MIN[i % GAPS_PADRAO_MIN.length];
    acumuladoMin += gap;
    agenda.push({
      numeroLinha: linha.numeroLinha,
      nomeLinha: linha.nomeLinha,
      sentido: linha.sentido,
      horarioMin: acumuladoMin,
    });
  }
  return agenda;
}

/**
 * @param {string} idParada NUM do letreiro (ver servidor/database.js).
 * @returns {Promise<Linha[]>} as 3 próximas chegadas ainda não passadas do
 *   horário, conforme o relógio do servidor. Chamadas repetidas ao longo do
 *   tempo vão devolvendo os próximos 3 da fila, conforme os anteriores
 *   forem passando do horário.
 */
async function GetProximasLinhas(idParada) {
  const decorrido = minutosDecorridosNoServidor();
  const agenda = await obterAgendaDoLetreiro(idParada);

  const proximas = agenda
    .filter((item) => item.horarioMin >= decorrido)
    .slice(0, 3)
    .map((item) => criarLinha(item.numeroLinha, item.nomeLinha, item.horarioMin - decorrido, item.sentido));

  return new Promise((resolve) => {
    setTimeout(() => resolve(proximas), 300);
  });
}

// Sem dado real de tempo entre paradas nos arquivos que temos — só pra não
// ficar tudo cravado igual.
const GAPS_PARADAS_MIN = [1, 2, 3];

/**
 * @param {string} numeroLinha
 * @param {string} sentido Necessário pra desambiguar: uma linha pode ter
 *   mais de um sentido passando pelo mesmo letreiro (ex: circulares).
 * @param {string} idParadaAtual NUM do letreiro de onde o ônibus está
 *   partindo agora — usado pra cortar a lista de paradas a partir daqui em
 *   diante (senão mostraria paradas que o ônibus já passou).
 * @returns {Promise<RotaLinha|null>}
 */
async function GetLinhaRota(numeroLinha, sentido, idParadaAtual) {
  const todasParadas = await obterParadasDaLinha(numeroLinha, sentido);

  if (todasParadas.length === 0) {
    return new Promise((resolve) => setTimeout(() => resolve(null), 300));
  }

  const indiceAtual = todasParadas.findIndex((p) => p.num === idParadaAtual);
  const paradas = indiceAtual >= 0 ? todasParadas.slice(indiceAtual) : todasParadas;

  const idsParadas = paradas.map((p) => p.num);
  const nomeParadas = paradas.map((p) => p.nome);
  const tempoChegadaParadasMinuto = paradas.map((_, i) => (i === 0 ? 0 : GAPS_PARADAS_MIN[(i - 1) % GAPS_PARADAS_MIN.length]));
  const rota = criarRotaLinha(numeroLinha, idsParadas, nomeParadas, tempoChegadaParadasMinuto);

  return new Promise((resolve) => {
    setTimeout(() => resolve(rota), 300);
  });
}

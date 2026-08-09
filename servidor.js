// Simula o backend. Por hora só devolve dados mockados; a assinatura
// (idParada + Promise) já fica pronta para virar uma chamada HTTP real
// sem precisar mudar quem a chama (cliente.js).

const LINHAS_POOL = [
  { numeroLinha: "203", nomeLinha: "SANTA CANDIDA CAPAO RASO" },
  { numeroLinha: "502", nomeLinha: "CIRCULAR SUL (HORARIO)" },
  { numeroLinha: "250", nomeLinha: "NORTE SUL" },
  { numeroLinha: "603", nomeLinha: "PINHEIRINHO / RUI BARBOSA" },
];

// Intervalo (em minutos) entre um ônibus e o próximo, misturado de propósito
// pra não ficar uma cadência óbvia. 20 chegadas ao todo, ciclando pelo pool.
const INTERVALOS_MIN = [2, 5, 3, 1, 4, 6, 2, 7, 3, 5, 9, 4, 2, 6, 3, 8, 5, 4, 7, 3];

// Agenda fixa do "dia": cada item tem um horário absoluto (em minutos desde
// que o servidor "ligou"), calculado acumulando INTERVALOS_MIN.
let acumuladoMin = 0;
const AGENDA = INTERVALOS_MIN.map((intervalo, i) => {
  acumuladoMin += intervalo;
  return { ...LINHAS_POOL[i % LINHAS_POOL.length], horarioMin: acumuladoMin };
});

// Relógio do servidor: começa a contar a partir do momento em que este
// arquivo é carregado, independente do relógio do cliente. avancoManualMs
// existe só pra teste (ver AvancarMinutoServidor) — sem ele, testar a
// paginação da AGENDA exigiria esperar minutos reais passarem.
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

/**
 * @param {string} idParada guid da parada (o "cliente" atual). Por hora
 *   qualquer valor é aceito.
 * @returns {Promise<Linha[]>} as 3 próximas chegadas da AGENDA que ainda não
 *   passaram do horário, conforme o relógio do servidor. Chamadas repetidas
 *   ao longo do tempo vão devolvendo os próximos 3 da fila, conforme os
 *   anteriores forem passando do horário.
 */
function GetProximasLinhas(idParada) {
  const decorrido = minutosDecorridosNoServidor();

  const proximas = AGENDA.filter((item) => item.horarioMin >= decorrido)
    .slice(0, 3)
    .map((item) => criarLinha(item.numeroLinha, item.nomeLinha, item.horarioMin - decorrido));

  return new Promise((resolve) => {
    setTimeout(() => resolve(proximas), 300);
  });
}

// Dados parcialmente reais (paradas de linhas de Curitiba). O ponto
// "Terminal Portão" foi removido de todas as rotas abaixo por ser o ponto
// atual de teste (não faz sentido listar o próprio ponto como uma "próxima
// parada"). Mesmo nome de parada = mesmo guid entre rotas diferentes, como
// esperado de paradas físicas reais compartilhadas por várias linhas.
const idsParadasPorNome = new Map();
function idParada(nomeParada) {
  if (!idsParadasPorNome.has(nomeParada)) {
    idsParadasPorNome.set(nomeParada, crypto.randomUUID());
  }
  return idsParadasPorNome.get(nomeParada);
}

// `temposEntreParadas` tem um item a menos que `nomeParadas` (o tempo de
// cada parada até a seguinte); criarRotaLinha (linha.js) exige o array
// completo com um 0 na frente, então completamos aqui.
function criarRotaAPartirDosNomes(numeroLinha, nomeParadas, temposEntreParadas) {
  const idsParadas = nomeParadas.map(idParada);
  const tempoChegadaParadasMinuto = [0, ...temposEntreParadas];
  return criarRotaLinha(numeroLinha, idsParadas, nomeParadas, tempoChegadaParadasMinuto);
}

const ROTAS = {
  // 1 a 3 min entre paradas.
  "203": criarRotaAPartirDosNomes(
    "203",
    ["Terminal Capão Raso", "Hospital do Trabalhador", "Itajubá", "Terminal Capão Raso"],
    [2, 4, 6]
  ),

  // 1 a 3 min entre paradas.
  "502": criarRotaAPartirDosNomes(
    "502",
    [
      "Terminal Sítio Cercado", "Quitandinha", "Arroio Cercado", "Rosa Tortato",
      "Sagrado Coração", "Winston Churchill", "Terminal Pinheirinho", "Ouro Verde",
      "Santa Regina", "José Bettega", "Pedro Gusso", "Terminal Capão Raso",
      "Hospital do Trabalhador", "Itajubá",
    ],
    [2, 4, 5, 8, 9, 11, 13, 15, 16, 20, 22, 23, 25]
  ),

  // Norte/Sul: 1 a 7 min entre paradas.
  "250": criarRotaAPartirDosNomes(
    "250",
    [
      "Terminal Cabral", "Passeio Público", "Central (sentido Sul)",
      "Praça Rui Barbosa (sentido Oeste / Sul)", "Praça Oswaldo Cruz", "Bento Viana",
    ],
    [8, 13, 15, 20, 25]
  ),

  // 1 a 3 min entre paradas.
  "603": criarRotaAPartirDosNomes(
    "603",
    [
      "Praça Rui Barbosa (603)", "Praça Oswaldo Cruz", "Coronel Dulcídio", "Bento Viana",
      "Silva Jardim", "Petit Carneiro", "Dom Pedro I", "Sebastião Paraná",
      "Vital Brasil", "Morretes", "Carlos Dietzch",
    ],
    [3, 7, 11, 15, 18, 20, 23, 26, 29, 31]
  ),
};

/**
 * @param {string} numeroLinha
 * @returns {Promise<RotaLinha|null>} as próximas paradas da linha e o tempo
 *   até cada uma, ou null se a linha não tiver rota cadastrada.
 */
function GetLinhaRota(numeroLinha) {
  const rota = ROTAS[numeroLinha] || null;

  return new Promise((resolve) => {
    setTimeout(() => resolve(rota), 300);
  });
}

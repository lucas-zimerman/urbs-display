// Roda uma vez, offline (node scripts/gerar_agenda_por_letreiro.js), pra
// converter o GTFS de https://github.com/benaytms/urbs-gtfs (que já veio
// extraído em database/live/gtfs_source/) em um JSON pequeno por letreiro —
// stop_times.txt sozinho tem 67MB e cobre TODOS os pontos da cidade, não dá
// pra servir isso inteiro pro navegador só pra mostrar 1 letreiro. A saída
// fica em database/live/gtfs/<NUM>.json, um arquivo por parada, contendo só
// os horários reais programados (por linha e tipo de dia) que passam ali —
// servidor/database.js busca só o arquivo do letreiro selecionado.
//
// stop_id do GTFS == NUM de pontosLinha.json (conferido manualmente: mesmo
// valor "105802" com o mesmo nome em ambos os arquivos), então não precisa
// cruzar por nome/coordenada.

const fs = require("fs");
const path = require("path");

const GTFS_DIR = path.join(__dirname, "..", "database", "live", "gtfs_source");
const SAIDA_DIR = path.join(__dirname, "..", "database", "live", "gtfs");

// Colapsa passagens da mesma linha+serviço muito próximas num único horário.
// Causa raiz (confirmada olhando trips.txt direto): o trip_id do GTFS é
// "<linha>_<variante>_<parada-âncora>_<horário>" — um por PARADA-ÂNCORA da
// viagem, não um por viagem real. Uma única corrida física que passa por 3
// âncoras (ex: linha 022: "022_1_109125_0545", "022_1_109095_0548",
// "022_1_109091_0553" — 5-8min de diferença, mesma corrida) vira 3 entradas
// em trips.txt, cada uma interpolada separadamente — sem desduplicar, a
// frequência calculada sai muitas vezes mais alta que a real (ex: linha 022
// tinha ~5min no cálculo bruto contra ~17min real no Moovit).
// 8min é uma escolha de compromisso: pega a maioria dessas duplicatas de
// âncora (nos casos conferidos, ficam todas abaixo de ~8min), mas se uma
// linha realmente circular a cada poucos minutos (troncal de alta
// frequência) tiver 2 viagens reais coladas nesse intervalo, uma delas some
// do resultado — não tem como saber a diferença só pelo horário sem
// reconstruir a corrida real a partir das âncoras (mudança maior, deixada
// de lado por ora).
const JANELA_DEDUP_SEG = 8 * 60;

function lerCsv(caminho) {
  const texto = fs.readFileSync(caminho, "utf8");
  const linhas = texto.split("\n");
  const cabecalho = linhas[0].split(",");
  const registros = [];
  for (let i = 1; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!linha) continue;
    const campos = linha.split(",");
    const registro = {};
    cabecalho.forEach((nome, idx) => (registro[nome.trim()] = campos[idx]));
    registros.push(registro);
  }
  return registros;
}

function paraSegundos(hhmmss) {
  const [hh, mm, ss] = hhmmss.split(":").map(Number);
  return hh * 3600 + mm * 60 + ss;
}

function paraHhmmss(seg) {
  seg = Math.round(seg);
  const hh = Math.floor(seg / 3600);
  const mm = Math.floor((seg % 3600) / 60);
  const ss = seg % 60;
  const dois = (n) => String(n).padStart(2, "0");
  return `${dois(hh)}:${dois(mm)}:${dois(ss)}`;
}

// Preenche o horário de paradas sem timepoint (arrival_time em branco no
// GTFS — a maioria) por interpolação linear entre as duas paradas com
// timepoint mais próximas na mesma viagem, pela posição (stop_sequence).
function interpolar(paradasDaViagem, stopIdAlvo) {
  const idxAlvo = paradasDaViagem.findIndex((p) => p.stopId === stopIdAlvo);
  if (idxAlvo === -1) return null;

  const alvo = paradasDaViagem[idxAlvo];
  if (alvo.seg !== null) return alvo.seg;

  let anterior = null;
  for (let i = idxAlvo - 1; i >= 0; i--) {
    if (paradasDaViagem[i].seg !== null) {
      anterior = paradasDaViagem[i];
      break;
    }
  }
  let proxima = null;
  for (let i = idxAlvo + 1; i < paradasDaViagem.length; i++) {
    if (paradasDaViagem[i].seg !== null) {
      proxima = paradasDaViagem[i];
      break;
    }
  }
  if (!anterior || !proxima) return null;
  if (proxima.seq === anterior.seq) return anterior.seg;

  const fracao = (alvo.seq - anterior.seq) / (proxima.seq - anterior.seq);
  return anterior.seg + fracao * (proxima.seg - anterior.seg);
}

function main() {
  console.log("Lendo trips.txt...");
  const trips = lerCsv(path.join(GTFS_DIR, "trips.txt"));
  const infoPorViagem = new Map(); // trip_id -> { routeId, serviceId }
  trips.forEach((t) => infoPorViagem.set(t.trip_id, { routeId: t.route_id, serviceId: t.service_id }));
  console.log("  ", infoPorViagem.size, "viagens");

  console.log("Lendo stop_times.txt (pode demorar, é o arquivo grande)...");
  const stopTimes = lerCsv(path.join(GTFS_DIR, "stop_times.txt"));
  console.log("  ", stopTimes.length, "linhas de horário");

  console.log("Agrupando por viagem...");
  const paradasPorViagem = new Map(); // trip_id -> [{ seq, seg, stopId }]
  for (const st of stopTimes) {
    if (!paradasPorViagem.has(st.trip_id)) paradasPorViagem.set(st.trip_id, []);
    paradasPorViagem.get(st.trip_id).push({
      seq: Number(st.stop_sequence),
      seg: st.arrival_time ? paraSegundos(st.arrival_time) : null,
      stopId: st.stop_id,
    });
  }
  for (const paradas of paradasPorViagem.values()) {
    paradas.sort((a, b) => a.seq - b.seq);
  }

  console.log("Calculando horário real (com interpolação) por parada+linha+serviço...");
  // horariosPorParada: Map<stopId, Map<routeId, Map<serviceId, number[]>>> (segundos)
  const horariosPorParada = new Map();
  let processadas = 0;
  for (const [tripId, paradas] of paradasPorViagem) {
    const info = infoPorViagem.get(tripId);
    if (!info) continue;

    const stopIdsUnicos = new Set(paradas.map((p) => p.stopId));
    for (const stopId of stopIdsUnicos) {
      const seg = interpolar(paradas, stopId);
      if (seg === null) continue;

      if (!horariosPorParada.has(stopId)) horariosPorParada.set(stopId, new Map());
      const porLinha = horariosPorParada.get(stopId);
      if (!porLinha.has(info.routeId)) porLinha.set(info.routeId, new Map());
      const porServico = porLinha.get(info.routeId);
      if (!porServico.has(info.serviceId)) porServico.set(info.serviceId, []);
      porServico.get(info.serviceId).push(seg);
    }

    processadas++;
    if (processadas % 10000 === 0) console.log("  ", processadas, "/", paradasPorViagem.size);
  }

  console.log("Deduplicando e gravando arquivos por letreiro em", SAIDA_DIR);
  fs.mkdirSync(SAIDA_DIR, { recursive: true });

  let arquivosGravados = 0;
  for (const [stopId, porLinha] of horariosPorParada) {
    const saida = { linhas: {} };

    for (const [routeId, porServico] of porLinha) {
      saida.linhas[routeId] = {};
      for (const [serviceId, segundosLista] of porServico) {
        const ordenados = [...segundosLista].sort((a, b) => a - b);
        const deduplicados = [];
        for (const seg of ordenados) {
          const ultimo = deduplicados[deduplicados.length - 1];
          if (ultimo === undefined || seg - ultimo >= JANELA_DEDUP_SEG) {
            deduplicados.push(seg);
          }
        }
        saida.linhas[routeId][serviceId] = deduplicados.map(paraHhmmss);
      }
    }

    fs.writeFileSync(path.join(SAIDA_DIR, `${stopId}.json`), JSON.stringify(saida));
    arquivosGravados++;
  }

  console.log("Pronto:", arquivosGravados, "arquivos gravados.");
}

main();

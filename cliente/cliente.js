const MENSAGEM_INICIAL = "URBS - V1.0";
const TEMPO_MENSAGEM_INICIAL_MS = 5000;
const INTERVALO_DESCONTO_MS = 60 * 1000; // a cada minuto, desconta 1 do tempo de chegada
const INTERVALO_SCROLL_MS = 120; // passo do scroll dos nomes que não cabem na tela

const TEMPO_MINIMO_PROXIMO_PARA_ANUNCIO = 3; // só anuncia se sobrar folga até o próximo ônibus
const REPETICOES_PISCA_ANUNCIO = 3;
const INTERVALO_PISCA_ANUNCIO_MS = 1000;
const INTERVALO_SCROLL_ANUNCIO_MS = Math.round(INTERVALO_SCROLL_MS / 5); // 5x mais rápido que o scroll normal

// NUM do letreiro atual (ver servidor/database.js). Mutável: o seletor em
// app.js troca isso chamando ligar(novoNum) de novo — ver comentário lá embaixo.
let idParadaAtual = "105802";

let proximasLinhas = [];
let scrollOffsets = []; // posição atual do scroll de cada linha, em px (múltiplos de GRID)
let emAnuncio = false; // true enquanto o fluxo de chegada (mostrarAnuncioChegada) estiver rodando
// Começa desabilitado: navegador bloqueia autoplay sem gesto do usuário
// mesmo assim, então só faz sentido tocar depois que o usuário clicar no botão.
let somHabilitado = false;

// Incrementada a cada ligar(): as funções assíncronas de longa duração
// (mostrarAnuncioChegada/mostrarScrollParadas, e a busca em
// CarregarProximasLinhas) guardam a geração vigente no início e conferem
// de novo depois de cada await — se mudou, é porque ligar() rodou de novo
// enquanto elas esperavam, então elas abortam em vez de desenhar por cima
// do letreiro novo com dado do letreiro antigo.
let geracaoAtual = 0;
let idIntervaloDesconto = null;
let idIntervaloScroll = null;

// Chamado uma vez no boot (sem argumento, usa o idParadaAtual padrão) e de
// novo sempre que o usuário troca de letreiro no seletor (com o novo NUM) —
// nesse caso reseta tudo: para os timers antigos, mostra a mensagem inicial
// de novo e recarrega a partir do letreiro novo.
function ligar(numLetreiro) {
  geracaoAtual += 1;
  const minhaGeracao = geracaoAtual;

  if (idIntervaloDesconto) clearInterval(idIntervaloDesconto);
  if (idIntervaloScroll) clearInterval(idIntervaloScroll);
  idIntervaloDesconto = null;
  idIntervaloScroll = null;

  if (numLetreiro) idParadaAtual = numLetreiro;

  emAnuncio = false;
  proximasLinhas = [];
  scrollOffsets = [];

  renderPanelText([MENSAGEM_INICIAL]);

  setTimeout(() => {
    if (minhaGeracao !== geracaoAtual) return; // ligar() rodou de novo antes disso disparar

    CarregarProximasLinhas().then(() => {
      if (minhaGeracao !== geracaoAtual) return;
      idIntervaloDesconto = setInterval(DescontaTempoChegada, INTERVALO_DESCONTO_MS);
      idIntervaloScroll = setInterval(AvancaScroll, INTERVALO_SCROLL_MS);
    });
  }, TEMPO_MENSAGEM_INICIAL_MS);
}

async function CarregarProximasLinhas() {
  const minhaGeracao = geracaoAtual;
  const linhas = await GetProximasLinhas(idParadaAtual);
  if (minhaGeracao !== geracaoAtual) return;

  const linhasAntes = proximasLinhas;
  proximasLinhas = linhas;
  scrollOffsets = linhas.map(() => 0);
  aplicarEstadoNovo(linhasAntes, linhas);
}

// A cada minuto: rebusca do servidor em vez de só decrementar a cópia local.
// Decrementar localmente (Math.max(0, tempo - 1)) nunca removia um ônibus
// que já tinha chegado — ele ficava preso em "AGORA" pra sempre, porque só
// quem sabe que ele já passou do horário é a AGENDA do servidor. Rebuscar
// resolve os dois de uma vez: desce o tempo dos que ainda vêm e troca quem
// já chegou pelo próximo da fila.
async function DescontaTempoChegada() {
  await CarregarProximasLinhas();
}

// Depois que proximasLinhas muda (busca no servidor ou desconto local): se o
// primeiro da lista acabou de chegar a 0, toca o som — em qualquer um dos
// dois casos, com ou sem folga pro anúncio, ele chegou. Se além disso sobra
// folga (>= 3min) até o próximo, dispara o anúncio de chegada; senão só
// redesenha o quadro normal. Ignorado enquanto um anúncio já estiver em andamento.
function aplicarEstadoNovo(linhasAntes, linhasDepois) {
  if (emAnuncio) return;

  if (primeiroChegouAgora(linhasAntes, linhasDepois)) {
    tocarSomChegada(linhasDepois[0].numeroLinha);
  }

  if (chegouAgora(linhasAntes, linhasDepois)) {
    mostrarAnuncioChegada(linhasDepois[0]);
    return;
  }

  AtualizaTela();
}

// true só no momento da transição (>0 -> 0), não em todo tick seguinte
// enquanto o primeiro da lista continuar em 0.
function primeiroChegouAgora(linhasAntes, linhasDepois) {
  const antes = linhasAntes[0];
  const depois = linhasDepois[0];

  return Boolean(
    antes && depois &&
    antes.numeroLinha === depois.numeroLinha &&
    antes.tempoChegadaMin > 0 &&
    depois.tempoChegadaMin === 0
  );
}

function chegouAgora(linhasAntes, linhasDepois) {
  const proxima = linhasDepois[1];
  return Boolean(
    primeiroChegouAgora(linhasAntes, linhasDepois) &&
    proxima &&
    proxima.tempoChegadaMin >= TEMPO_MINIMO_PROXIMO_PARA_ANUNCIO
  );
}

// A cada passo: avança o scroll de todas as linhas em 1 dot-column (GRID
// px, o "pixel falso" do painel) e redesenha. Linhas cujo nome já cabe na
// tela ignoram o offset — renderPanelLine (app.js) só escorrega quem não coube.
function AvancaScroll() {
  if (emAnuncio) return;
  scrollOffsets = scrollOffsets.map((offset) => offset + GRID);
  AtualizaTela();
}

function textoTempo(tempoChegadaMin) {
  return tempoChegadaMin <= 0 ? "AGORA" : `${tempoChegadaMin}MIN`;
}

function esperar(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Preenche os dois lados (não só a esquerda) pra sempre devolver exatamente
// `largura` caracteres — importante pra coluna do tempo (mostrarScrollParadas)
// ficar do mesmo tamanho que a coluna do nome, senão as duas linhas
// escorregando juntas saem de sincronia.
function centralizarEm(texto, largura) {
  const espaco = Math.max(0, largura - texto.length);
  const esquerda = Math.floor(espaco / 2);
  const direita = espaco - esquerda;
  return " ".repeat(esquerda) + texto + " ".repeat(direita);
}

// snd/502.opus pra linha 502, snd/203.opus pra linha 203, snd/others.opus
// pras demais.
function tocarSomChegada(numeroLinha) {
  if (!somHabilitado) return;

  const numero = numeroLinha.padStart(3, "0").slice(-3);
  let src = "snd/others.opus";
  if (numero === "502") src = "snd/502.opus";
  else if (numero === "203") src = "snd/203.opus";

  // .play() rejeita se o navegador bloquear autoplay sem interação prévia
  // do usuário nesta página; ignora em silêncio nesse caso.
  new Audio(src).play().catch(() => {});
}

// Botão "Habilitar/Desabilitar som": clicar já conta como o gesto do
// usuário que o navegador exige pra permitir tocar áudio depois, sem gesto,
// vindo de um timer (a chegada de um ônibus).
function AlternarSom() {
  somHabilitado = !somHabilitado;
  document.getElementById("btnAlternarSom").textContent = somHabilitado ? "Desabilitar som" : "Habilitar som";
}

// Ônibus chegou (0min) e ainda dá tempo antes do próximo: pausa o quadro
// normal e mostra, na ordem: 1) cabeçalho + "PROXIMO" / "PROXIMAS PARADAS"
// piscando, 2) as próximas paradas da rota com tempo e nome escorregando
// juntos. No fim, volta pro quadro normal.
async function mostrarAnuncioChegada(linhaChegada) {
  const minhaGeracao = geracaoAtual;
  emAnuncio = true;

  const numero = linhaChegada.numeroLinha.padStart(3, "0").slice(-3);
  const cabecalho = `${numero} - ${linhaChegada.nomeLinha}`;

  for (let i = 0; i < REPETICOES_PISCA_ANUNCIO; i++) {
    if (minhaGeracao !== geracaoAtual) return;
    renderPanelText([
      cabecalho,
      centralizarEm("PROXIMO", MAX_CHARS_PER_LINE),
      centralizarEm("PROXIMAS PARADAS", MAX_CHARS_PER_LINE),
    ]);
    await esperar(INTERVALO_PISCA_ANUNCIO_MS);
    if (minhaGeracao !== geracaoAtual) return;
    renderPanelText([cabecalho]);
    await esperar(INTERVALO_PISCA_ANUNCIO_MS);
  }

  if (minhaGeracao !== geracaoAtual) return;
  const rota = await GetLinhaRota(linhaChegada.numeroLinha, linhaChegada.sentido, idParadaAtual);
  if (minhaGeracao !== geracaoAtual) return;

  if (rota) {
    await mostrarScrollParadas(cabecalho, rota, minhaGeracao);
    if (minhaGeracao !== geracaoAtual) return;
  }

  emAnuncio = false;
  AtualizaTela();
}

// Pula paradas[0] (tempo 0 — é a parada atual, já passada). Tempo e nome de
// cada parada seguinte viram uma "coluna" (tempo centralizado sobre o nome);
// as colunas de todas as paradas viram duas strings do mesmo tamanho —
// tempos e nomes — escorregadas juntas com o mesmo offset, garantindo que
// fiquem alinhadas na tela.
async function mostrarScrollParadas(cabecalho, rota, minhaGeracao) {
  const nomes = rota.nomeParadas.slice(1);
  const tempos = rota.tempoChegadaParadasMinuto.slice(1);
  if (nomes.length === 0) return;

  const colunas = nomes.map((nome, i) => {
    const tempoTexto = `${tempos[i]}MIN`;
    const largura = Math.max(nome.length, tempoTexto.length);
    return {
      nome: nome.padEnd(largura, " "),
      tempo: centralizarEm(tempoTexto, largura),
    };
  });

  // Separadores do mesmo tamanho nas duas linhas, senão o scroll sincronizado desalinha.
  const SEPARADOR_NOME = " - ";
  const SEPARADOR_TEMPO = " ".repeat(SEPARADOR_NOME.length);
  const nomesLinha = colunas.map((c) => c.nome).join(SEPARADOR_NOME);
  const temposLinha = colunas.map((c) => c.tempo).join(SEPARADOR_TEMPO);

  const windowWidthPx = MAX_CHARS_PER_LINE * CHAR_COLS * GRID;
  const textoWidthPx = nomesLinha.length * CHAR_COLS * GRID;
  const fimPx = windowWidthPx + textoWidthPx;

  for (let offsetPx = 0; offsetPx <= fimPx; offsetPx += GRID) {
    if (minhaGeracao !== geracaoAtual) return;
    renderAnuncioParadas(cabecalho, temposLinha, nomesLinha, offsetPx, windowWidthPx);
    await esperar(INTERVALO_SCROLL_ANUNCIO_MS);
  }
}

function renderAnuncioParadas(cabecalho, temposLinha, nomesLinha, offsetPx, windowWidthPx) {
  const panel = document.getElementById("panel");
  clearPanelContent(panel);
  renderStaticRun(panel, cabecalho.slice(0, MAX_CHARS_PER_LINE), 0, 0);
  renderScrollOnce(panel, temposLinha, windowWidthPx, offsetPx, 0, 1 * CHAR_ROWS * GRID);
  renderScrollOnce(panel, nomesLinha, windowWidthPx, offsetPx, 0, 2 * CHAR_ROWS * GRID);
}

// Botão de teste: adianta o relógio do servidor em 1 minuto e refaz a busca,
// pra ver a agenda avançar (tempos descendo, próximas linhas entrando) sem
// esperar 1 minuto real.
function AvancarUmMinuto() {
  AvancarMinutoServidor();
  CarregarProximasLinhas();
}

// Redesenha a tela a partir do estado atual (proximasLinhas + scrollOffsets).
// Não busca nada novo no servidor — só quem muda o estado (Carregar/Desconta/Scroll) chama.
// Número sempre com 3 caracteres, tempo sempre encostado na última coluna
// (MAX_CHARS_PER_LINE, de app.js) e "AGORA" no lugar de "0MIN"; o nome ocupa
// o espaço que sobra entre os dois, escorregando por pixel quando não cabe.
function AtualizaTela() {
  const panel = document.getElementById("panel");
  clearPanelContent(panel);

  proximasLinhas.forEach((linha, row) => {
    const numero = linha.numeroLinha.padStart(3, "0").slice(-3);
    const prefix = `${numero} `;
    const sufixo = ` ${textoTempo(linha.tempoChegadaMin)}`;
    const nomeWidthChars = Math.max(0, MAX_CHARS_PER_LINE - prefix.length - sufixo.length);

    renderPanelLine(row, {
      prefix,
      nome: linha.nomeLinha,
      nomeWidthChars,
      nomeOffsetPx: scrollOffsets[row] || 0,
      sufixo,
    });
  });
}

document.addEventListener("DOMContentLoaded", () => {
  ligar();
  document.getElementById("btnAvancarMinuto").addEventListener("click", AvancarUmMinuto);
  document.getElementById("btnAlternarSom").addEventListener("click", AlternarSom);
});

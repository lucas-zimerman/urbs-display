// LED panel geometry, derived from panel/led_off.png and the font/ sprites:
// each dot cell is an 11px pitch (8px lit dot + 3px gap), and every glyph
// sprite is a 5-column x 7-row dot matrix drawn at that same pitch, so
// glyphs only look "on-grid" when placed at multiples of GRID px.
const GRID = 11; // px per dot cell (8px lit dot + 3px gap) — the "fake pixel"
const CHAR_COLS = 6; // 5 dot-columns of glyph + 1 blank spacer column
const CHAR_ROWS = 8; // 7 dot-rows of glyph + 1 blank spacer row
const GLYPH_HEIGHT = 7 * GRID - 3; // 74px, matches font/*.png natural height
const MAX_CHARS_PER_LINE = 23;
const MAX_LINES = 3;
const SCROLL_GAP = "    "; // blank run shown between the end of a scrolling name and its repeat

// Maps a character to its sprite in font/, or null for a blank cell
// (space, or a character with no sprite available).
function charToSrc(rawChar) {
  const ch = rawChar.toUpperCase();
  if (ch === ".") return "font/dot.png";
  if (ch === "-") return "font/minus.png";
  if (ch === "|") return "font/bar.png";
  if (ch === "Ã" || ch === "Á" || ch === "Â") return "font/a_acento.png";
  if (ch === "É" || ch === "Ê") return "font/e_tio.png";
  if (ch === "Í") return "font/i1.png";
  if (ch === "Ó") return "font/o1.png";
  if (ch === "Ú") return "font/u1.png";
  if (ch === "Ç") return "font/cecedilha.png";
  if (ch === '"' || ch === "'") return "font/aspas.png";
  if (ch === "!" || ch === "(" || ch === ")" || ch === "?" || ch === "~") return `font/${ch}.png`;
  if (ch === "/") return "font/bar.png";
  if (/^[A-Z0-9]$/.test(ch)) return `font/${ch}.png`;
  return null;
}

function clearPanelContent(panel) {
  panel.querySelectorAll(".glyph, .scroll-window").forEach((el) => el.remove());
}

function placeGlyph(container, ch, leftPx, topPx) {
  const src = charToSrc(ch);
  if (!src) return;

  const img = document.createElement("img");
  img.className = "glyph";
  img.src = src;
  img.alt = ch;
  img.style.left = `${leftPx}px`;
  img.style.top = `${topPx}px`;
  container.appendChild(img);
}

// One glyph per CHAR_COLS*GRID slot, character-aligned — used for text
// that doesn't scroll (prefixes, suffixes, static lines).
function renderStaticRun(container, text, leftPx, topPx) {
  text.split("").forEach((ch, i) => {
    placeGlyph(container, ch, leftPx + i * CHAR_COLS * GRID, topPx);
  });
}

// Renders `text` inside a clipped window that loops continuously, advanced
// by `offsetPx` — a distance in dot-columns (GRID px), not whole characters,
// so the motion reads as a smooth per-pixel marquee instead of a per-letter
// jump. `text + SCROLL_GAP` is tiled as many times as needed to fill the
// window at the current offset.
function renderScrollWindow(panel, text, windowWidthPx, offsetPx, leftPx, topPx) {
  const win = document.createElement("div");
  win.className = "scroll-window";
  win.style.left = `${leftPx}px`;
  win.style.top = `${topPx}px`;
  win.style.width = `${windowWidthPx}px`;
  win.style.height = `${GLYPH_HEIGHT}px`;
  panel.appendChild(win);

  const loopText = text + SCROLL_GAP;
  const loopWidthPx = loopText.length * CHAR_COLS * GRID;
  const shift = ((offsetPx % loopWidthPx) + loopWidthPx) % loopWidthPx;
  const copies = Math.ceil((windowWidthPx + shift) / loopWidthPx) + 1;

  for (let copy = 0; copy < copies; copy++) {
    loopText.split("").forEach((ch, i) => {
      const x = copy * loopWidthPx + i * CHAR_COLS * GRID - shift;
      if (x <= -CHAR_COLS * GRID || x >= windowWidthPx) return;
      placeGlyph(win, ch, x, 0);
    });
  }
}

// Single pass of `text` sliding leftward through a clipped window: at
// offsetPx = 0 the text sits just past the right edge (nothing visible
// yet), and by offsetPx = windowWidthPx + text-width-in-px it has slid
// fully past the left edge (nothing visible anymore) — no looping, unlike
// renderScrollWindow. Used for one-shot announcements instead of a
// continuously repeating marquee.
function renderScrollOnce(container, text, windowWidthPx, offsetPx, leftPx, topPx) {
  const win = document.createElement("div");
  win.className = "scroll-window";
  win.style.left = `${leftPx}px`;
  win.style.top = `${topPx}px`;
  win.style.width = `${windowWidthPx}px`;
  win.style.height = `${GLYPH_HEIGHT}px`;
  container.appendChild(win);

  const shift = offsetPx - windowWidthPx;
  text.split("").forEach((ch, i) => {
    const x = i * CHAR_COLS * GRID - shift;
    if (x <= -CHAR_COLS * GRID || x >= windowWidthPx) return;
    placeGlyph(win, ch, x, 0);
  });
}

// Renders one row as prefix (static) + nome (static if it fits the given
// width, scrolling per-pixel otherwise) + sufixo (static), all laid out
// left to right. Does not clear the panel — call clearPanelContent first.
function renderPanelLine(row, { prefix = "", nome = "", nomeWidthChars = 0, nomeOffsetPx = 0, sufixo = "" }) {
  const panel = document.getElementById("panel");
  const topPx = row * CHAR_ROWS * GRID;
  let leftPx = 0;

  renderStaticRun(panel, prefix, leftPx, topPx);
  leftPx += prefix.length * CHAR_COLS * GRID;

  const windowWidthPx = nomeWidthChars * CHAR_COLS * GRID;
  if (nome.length <= nomeWidthChars) {
    renderStaticRun(panel, nome, leftPx, topPx);
  } else {
    renderScrollWindow(panel, nome, windowWidthPx, nomeOffsetPx, leftPx, topPx);
  }
  leftPx += windowWidthPx;

  renderStaticRun(panel, sufixo, leftPx, topPx);
}

// Renders up to MAX_LINES plain strings onto the panel, one per row, each
// truncated to MAX_CHARS_PER_LINE. Replaces whatever was on screen before.
// For lines with a scrolling name segment, use clearPanelContent +
// renderPanelLine per row instead (see cliente.js).
function renderPanelText(lines) {
  const panel = document.getElementById("panel");
  clearPanelContent(panel);

  lines.slice(0, MAX_LINES).forEach((line, row) => {
    renderStaticRun(panel, line.slice(0, MAX_CHARS_PER_LINE), 0, row * CHAR_ROWS * GRID);
  });
}

// Scales the whole panel (background + glyphs, all laid out in native
// pixel coordinates above) down or up to fill the wrapper's width, via
// a single CSS transform so the glyphs scale in lockstep with the grid.
function fitPanel() {
  const bg = document.getElementById("panelBg");
  if (!bg.naturalWidth) return;

  const wrap = document.querySelector(".panel-wrap");
  const wrapStyle = getComputedStyle(wrap);
  const paddingX = parseFloat(wrapStyle.paddingLeft) + parseFloat(wrapStyle.paddingRight);
  const available = wrap.clientWidth - paddingX;
  const scale = available / bg.naturalWidth;

  const panel = document.getElementById("panel");
  const sizer = document.getElementById("panelSizer");

  panel.style.width = `${bg.naturalWidth}px`;
  panel.style.height = `${bg.naturalHeight}px`;
  panel.style.transform = `scale(${scale})`;

  sizer.style.width = `${available}px`;
  sizer.style.height = `${bg.naturalHeight * scale}px`;
}

document.addEventListener("DOMContentLoaded", () => {
  const bg = document.getElementById("panelBg");

  if (bg.complete) {
    fitPanel();
  } else {
    bg.addEventListener("load", fitPanel);
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeTimer);
    resizeTimer = requestAnimationFrame(fitPanel);
  });
});

// Seletor de estação/terminal (servidor/database.js): "Estação/terminal" é
// só um filtro de tipo (as duas opções fixas), quem lista os pontos de
// verdade é o campo de busca com autocomplete — filtrado por esse tipo, a
// partir da mesma lista de terminais reais (listarTerminais). "Terminal" só
// mostra pontos cujo nome contém "Terminal" (ex: Terminal Portão);
// "Estação" mostra o resto (ex: Estação Tubo Itajubá). Um 4º campo aparece
// quando o ponto escolhido tem mais de um letreiro (ex: Terminal Portão tem
// um por sentido).
async function inicializarSeletorPonto() {
  const selectTipo = document.getElementById("selectTipo");
  const inputPonto = document.getElementById("inputPonto");
  const listaPontos = document.getElementById("listaPontos");
  const campoLetreiro = document.getElementById("campoLetreiro");
  const selectLetreiro = document.getElementById("selectLetreiro");
  const status = document.getElementById("letreiroSelecionado");

  const terminais = await listarTerminais();

  // value inclui o GRUPO entre parênteses pra desempatar nomes repetidos
  // (ex: duas "Estação Central"); grupoPorRotulo desfaz isso.
  const grupoPorRotulo = new Map();

  function popularPontos(tipo) {
    inputPonto.value = "";
    listaPontos.innerHTML = "";
    grupoPorRotulo.clear();
    campoLetreiro.hidden = true;
    status.textContent = "";

    if (!tipo) {
      inputPonto.disabled = true;
      return;
    }

    const ehTerminal = (nome) => /terminal/i.test(nome);
    const filtrados = terminais.filter((t) => (tipo === "terminal" ? ehTerminal(t.nome) : !ehTerminal(t.nome)));

    filtrados.forEach((t) => {
      const rotulo = `${t.nome} (${t.grupo})`;
      grupoPorRotulo.set(rotulo, t.grupo);

      const opt = document.createElement("option");
      opt.value = rotulo;
      listaPontos.appendChild(opt);
    });

    inputPonto.disabled = false;
  }

  // Fecha a escolha: atualiza o texto de status e, se for de fato um
  // letreiro diferente do que já está no ar, reseta o cliente (cliente.js)
  // pra esse letreiro novo. A comparação com idParadaAtual evita reiniciar
  // à toa quando o valor resolvido é igual ao que já estava rodando (ex: o
  // preenchimento padrão abaixo, que aponta pro mesmo letreiro do boot).
  async function selecionarLetreiro(num) {
    const linhas = await obterLinhasDoLetreiro(num);
    const numerosLinha = Array.from(new Set(linhas.map((l) => l.numeroLinha))).sort();
    status.innerHTML = `Letreiro selecionado: <strong>${num}</strong> — linhas: <strong>${numerosLinha.join(", ") || "nenhuma encontrada"}</strong>`;

    if (typeof ligar === "function" && num !== idParadaAtual) {
      ligar(num);
    }
  }

  // numPreferido (opcional): qual letreiro ativar por padrão quando o
  // terminal tem mais de um. Se não vier, ou não existir na lista, usa o
  // primeiro. Sem isso, o preenchimento padrão abaixo ativaria o primeiro
  // letreiro (chamando ligar) e, um instante depois, corrigiria pro 105802
  // (chamando ligar de novo) — dois reinícios em vez de um.
  async function selecionarTerminal(grupo, numPreferido) {
    const letreiros = await obterLetreirosDoTerminal(grupo);

    if (letreiros.length <= 1) {
      campoLetreiro.hidden = true;
      if (letreiros.length === 1) await selecionarLetreiro(letreiros[0].num);
      return;
    }

    selectLetreiro.innerHTML = "";
    letreiros.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.num;
      opt.textContent = `${l.nome} — linhas ${l.linhas.join(", ")}`;
      selectLetreiro.appendChild(opt);
    });
    campoLetreiro.hidden = false;

    const existePreferido = numPreferido && letreiros.some((l) => l.num === numPreferido);
    const numEscolhido = existePreferido ? numPreferido : letreiros[0].num;
    selectLetreiro.value = numEscolhido;
    await selecionarLetreiro(numEscolhido);
  }

  selectTipo.addEventListener("change", () => popularPontos(selectTipo.value));

  selectLetreiro.addEventListener("change", () => {
    selecionarLetreiro(selectLetreiro.value);
  });

  inputPonto.addEventListener("change", () => {
    const grupo = grupoPorRotulo.get(inputPonto.value);
    if (!grupo) return;
    selecionarTerminal(grupo);
  });

  // Preenchimento padrão: Terminal > Terminal Portão > 105802 — o mesmo
  // letreiro que cliente.js já usa como padrão no boot (idParadaAtual), só
  // pra refletir isso no seletor sem reiniciar o cliente à toa.
  selectTipo.value = "terminal";
  popularPontos("terminal");

  const rotuloPortao = Array.from(grupoPorRotulo.keys()).find((r) => r.startsWith("Terminal Portão ("));
  if (rotuloPortao) {
    inputPonto.value = rotuloPortao;
    await selecionarTerminal(grupoPorRotulo.get(rotuloPortao), "105802");
  }
}

document.addEventListener("DOMContentLoaded", inicializarSeletorPonto);

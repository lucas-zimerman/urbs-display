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

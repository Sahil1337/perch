/**
 * <perch-relations> — Perch's Relationship View, rebuilt from a capture of the real app (see
 * site/capture/relations.ts) and live: the cards drag, the wires re-route with the app's own
 * routing, and a click focuses a table the way it does in Perch.
 *
 *   <script type="module" src="assets/js/relations.js"></script>
 *   <perch-relations></perch-relations>
 *
 * Attributes
 *   autoplay  On unless autoplay="false". The entrance plays the first time the element is at least
 *             40% visible; with autoplay off it opens on the finished picture.
 *   paused    Holds everything (entrance, pulses, tour); removing it resumes.
 *
 * Methods
 *   play()   Resumes; with autoplay off, plays the entrance.
 *   pause()  Holds.
 *   reset()  The captured layout and view, then the entrance again.
 *
 * Properties
 *   anchors  { window, titlebar, cards } — `cards` maps a table name to its card element. Live
 *            elements, complete once `ready` resolves and never replaced, so a reference stays good:
 *            a card being dragged moves its own layout box, and its rect follows.
 *   ready    Resolves once markup, styles, data and fonts are in.
 *
 * Events (CustomEvent, bubbles, composed)
 *   scene:done  The entrance has finished: cards in, wires drawn, pulses running.
 *
 * Renders at 1280×880 CSS px (a 40px titlebar over the app's 1280×840) and scales to its
 * container's width. Under prefers-reduced-motion it shows the finished picture without pulses,
 * the way the app does, and nothing plays by itself.
 */

const ASSETS = new URL("../", import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const TITLEBAR = 40;

// packages/ui/src/workspace/schema-diagram/geometry.ts
const CARD_W = 256;
const HEADER_H = 32;
const ROW_H = 24;
const BODY_PAD = 4;
const GAP_X = 176;
const GAP_Y = 48;
const LANE_GAP = 12;
const CORNER = 10;
const LOOP_REACH = 32;
const ORPHAN_GAP = 96;
const ORPHAN_COLS_MIN = 3;
const COLLAPSE_AT = 12;
// wire-path.tsx
const TRAVEL_S = 2.4;
const PULSE_PHASES = 6;
const PULSE_LEN = 0.14;
// use-diagram-view.ts, diagram-toolbar.tsx, use-diagram-drag.ts
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
const FIT_PAD = 48;
const ZOOM_STEP = 1.2;
const CLICK_SLOP = 3;
// A finger wobbles more than a mouse before it means to drag.
const TOUCH_SLOP = 8;

const NUDGE = 8;
const NUDGE_FAR = 40;

const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
const CARD_IN = 620;
const CARD_STAGGER = 60;
const WIRES_AT = 880;
const WIRE_DRAW = 720;
const WIRE_STAGGER = 110;
const PULSE_IN = 520;
const WIRE_COOL = 900;
const TOUR_FIRST = 2600;
const TOUR_GAP = 9000;
const TOUR_LIT = 900;
const TOUR_HOLD = 3200;
const TOUR_TABLE = "public.sightings";

const KIND_ICON = { table: "table-2", view: "eye", materialized_view: "layers" };
const CARD =
  "absolute top-(--y) left-(--x) w-64 overflow-hidden rounded-lg border bg-card text-card-foreground shadow-sm/5 transition-opacity duration-200";
const SVG_NS = "http://www.w3.org/2000/svg";

const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const cardHeight = (rows, footer) => HEADER_H + BODY_PAD * 2 + Math.max(1, rows) * ROW_H + (footer ? ROW_H : 0);
const rowCentre = (index) => (index < 0 ? HEADER_H / 2 : HEADER_H + BODY_PAD + index * ROW_H + ROW_H / 2);
const tableKey = (table) => `${table.schema}.${table.name}`;

/** graph.ts: one card, in keys-only mode folded to its key columns unless opened by hand. */
function buildNode(table, keysOnly, expanded) {
  const key = tableKey(table);
  let keys = null;
  if (keysOnly) {
    keys = new Set();
    for (const column of table.columns) if (column.pk) keys.add(column.name);
    for (const fk of table.foreignKeys) for (const column of fk.columns) keys.add(column);
  }
  const open = keys === null || expanded.has(key);
  const rows = open ? table.columns : table.columns.filter((column) => keys.has(column.name));
  const hidden = table.columns.length - rows.length;
  const footer = keys === null ? null : hidden > 0 ? "more" : table.columns.length > keys.size ? "fewer" : null;
  return { key, table, w: CARD_W, h: cardHeight(rows.length, footer !== null), rows, footer, hidden };
}

/** A schema with a table wider than COLLAPSE_AT columns opens in keys-only mode. */
const isWide = (tables) => tables.some((table) => table.columns.length > COLLAPSE_AT);

function buildGraph(tables, keysOnly, expanded) {
  const nodes = tables.map((table) => buildNode(table, keysOnly, expanded));
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const edges = [];
  for (const node of nodes) {
    for (const fk of node.table.foreignKeys) {
      const to = byKey.get(`${fk.refSchema}.${fk.refTable}`);
      if (!to) continue;
      edges.push({
        id: `${node.key}:${fk.name}`,
        fk,
        from: node.key,
        fromColumn: node.rows.findIndex((column) => column.name === fk.columns[0]),
        to: to.key,
        toColumn: to.rows.findIndex((column) => column.name === fk.refColumns[0]),
      });
    }
  }
  return { nodes, edges };
}

/** layout.ts: referenced tables left of the tables that point at them, orphans in a grid below. */
function autoLayout(nodes, edges) {
  const positions = new Map();
  if (nodes.length === 0) return positions;
  const degree = new Map();
  const children = new Map();
  const parents = new Map();
  const add = (map, key, value) => (map.get(key) ?? map.set(key, new Set()).get(key)).add(value);
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    add(children, edge.to, edge.from);
    add(parents, edge.from, edge.to);
  }
  const connected = nodes.filter((node) => (degree.get(node.key) ?? 0) > 0);
  const orphans = nodes.filter((node) => (degree.get(node.key) ?? 0) === 0);

  const state = new Map();
  const order = [];
  const dropped = new Set();
  const visit = (key) => {
    state.set(key, "open");
    for (const child of children.get(key) ?? []) {
      const seen = state.get(child);
      if (seen === "open") dropped.add(`${key}>${child}`);
      else if (seen === undefined) visit(child);
    }
    state.set(key, "done");
    order.push(key);
  };
  for (const node of connected) if (!state.has(node.key)) visit(node.key);
  order.reverse();

  const layerOf = new Map();
  for (const key of order) layerOf.set(key, 0);
  for (const key of order) {
    const base = layerOf.get(key) ?? 0;
    for (const child of children.get(key) ?? []) {
      if (dropped.has(`${key}>${child}`)) continue;
      layerOf.set(child, Math.max(layerOf.get(child) ?? 0, base + 1));
    }
  }
  const layerCount = Math.max(0, ...layerOf.values()) + 1;
  const layers = Array.from({ length: layerCount }, () => []);
  for (const node of connected) layers[layerOf.get(node.key) ?? 0].push(node.key);
  for (const layer of layers) layer.sort();

  const rank = new Map();
  const sweep = (index, neighbours) => {
    const scored = layers[index].map((key, position) => {
      const near = [...(neighbours.get(key) ?? [])].map((other) => rank.get(other)).filter((v) => v !== undefined);
      const score = near.length === 0 ? position : near.reduce((a, b) => a + b, 0) / near.length;
      return { key, score, position };
    });
    scored.sort((a, b) => a.score - b.score || a.position - b.position);
    layers[index] = scored.map((entry) => entry.key);
    layers[index].forEach((key, position) => rank.set(key, position));
  };
  layers[0]?.forEach((key, position) => rank.set(key, position));
  for (let index = 1; index < layers.length; index += 1) sweep(index, parents);
  for (let index = layers.length - 2; index >= 0; index -= 1) sweep(index, children);

  const nodeByKey = new Map(nodes.map((node) => [node.key, node]));
  const heights = layers.map(
    (layer) => layer.reduce((total, key) => total + (nodeByKey.get(key)?.h ?? 0), 0) + Math.max(0, layer.length - 1) * GAP_Y,
  );
  const tallest = Math.max(0, ...heights);
  layers.forEach((layer, index) => {
    let y = (tallest - heights[index]) / 2;
    for (const key of layer) {
      positions.set(key, { x: index * (CARD_W + GAP_X), y });
      y += (nodeByKey.get(key)?.h ?? 0) + GAP_Y;
    }
  });

  if (orphans.length > 0) {
    const graphWidth = layers.length * (CARD_W + GAP_X) - GAP_X;
    const columns = Math.max(
      ORPHAN_COLS_MIN,
      layers.length === 0
        ? Math.min(4, Math.ceil(Math.sqrt(orphans.length)))
        : Math.floor((graphWidth + GAP_X) / (CARD_W + GAP_X)),
    );
    let y = layers.length === 0 ? 0 : tallest + ORPHAN_GAP;
    for (let start = 0; start < orphans.length; start += columns) {
      const row = orphans.slice(start, start + columns);
      row.forEach((node, index) => positions.set(node.key, { x: index * (CARD_W + GAP_X), y }));
      y += Math.max(...row.map((node) => node.h)) + GAP_Y;
    }
  }
  return positions;
}

/** wires.ts: orthogonal wires, the vertical leg in the channel beside the referenced card. */
function routeWires(edges, nodeByKey, positions) {
  const drafts = [];
  for (const edge of edges) {
    const from = nodeByKey.get(edge.from);
    const to = nodeByKey.get(edge.to);
    const fromAt = positions.get(edge.from);
    const toAt = positions.get(edge.to);
    if (!from || !to || !fromAt || !toAt) continue;
    const y1 = fromAt.y + rowCentre(edge.fromColumn);
    const y2 = toAt.y + rowCentre(edge.toColumn);
    const fromMid = fromAt.x + from.w / 2;
    let x1, x2, startDir, endDir, lane;
    if (toAt.x >= fromMid) {
      x1 = fromAt.x + from.w;
      x2 = toAt.x;
      startDir = 1;
      endDir = -1;
      lane = x2 - Math.min(GAP_X / 2, (x2 - x1) / 2);
    } else if (toAt.x + to.w <= fromMid) {
      x1 = fromAt.x;
      x2 = toAt.x + to.w;
      startDir = -1;
      endDir = 1;
      lane = x2 + Math.min(GAP_X / 2, (x1 - x2) / 2);
    } else {
      x1 = fromAt.x + from.w;
      x2 = toAt.x + to.w;
      startDir = 1;
      endDir = 1;
      lane = Math.max(x1, x2) + LOOP_REACH;
    }
    drafts.push({ edge, start: { x: x1, y: y1 }, startDir, end: { x: x2, y: y2 }, endDir, lane });
  }
  const channels = new Map();
  for (const draft of drafts) {
    const key = Math.round(draft.lane / (GAP_X / 2));
    (channels.get(key) ?? channels.set(key, []).get(key)).push(draft);
  }
  for (const group of channels.values()) {
    group.sort((a, b) => a.start.y - b.start.y || a.end.y - b.end.y);
    group.forEach((draft, index) => {
      const spread = (index - (group.length - 1) / 2) * LANE_GAP;
      draft.lane += draft.endDir === -1 ? -spread : spread;
    });
  }
  return drafts.map((draft) => ({ ...draft, d: orthogonalPath(draft) }));
}

function orthogonalPath({ start, end, lane }) {
  const { x: x1, y: y1 } = start;
  const { x: x2, y: y2 } = end;
  if (Math.abs(y2 - y1) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const dx1 = Math.sign(lane - x1);
  const dx2 = Math.sign(x2 - lane);
  const dy = Math.sign(y2 - y1);
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(lane - x1), Math.abs(x2 - lane));
  return [
    `M ${x1} ${y1}`,
    `H ${lane - dx1 * r}`,
    `Q ${lane} ${y1} ${lane} ${y1 + dy * r}`,
    `V ${y2 - dy * r}`,
    `Q ${lane} ${y2} ${lane + dx2 * r} ${y2}`,
    `H ${x2}`,
  ].join(" ");
}

function wireBounds(wire) {
  const xs = [wire.start.x, wire.end.x, wire.lane];
  const ys = [wire.start.y, wire.end.y];
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y: y - 1, w: Math.max(...xs) - x, h: Math.max(...ys) - y + 2 };
}

const escapeHtml = (text) =>
  String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// @font-face does not apply from inside a shadow root, so the faces go on the document, once. The
// marker and URLs are <perch-workspace>'s, so whichever element loads first registers them.
function registerFonts() {
  if (document.querySelector("style[data-perch-workspace-fonts]")) return;
  const ranges = {
    latin:
      "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD",
    "latin-ext":
      "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF",
  };
  const faces = [];
  for (const [family, file] of [["Geist Variable", "geist"], ["Geist Mono Variable", "geist-mono"]]) {
    for (const [subset, range] of Object.entries(ranges)) {
      faces.push(
        `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;` +
          `src:url("${asset(`fonts/${file}-${subset}.woff2`)}") format("woff2-variations");unicode-range:${range}}`,
      );
    }
  }
  const style = document.createElement("style");
  style.dataset.perchWorkspaceFonts = "";
  style.textContent = faces.join("\n");
  document.head.append(style);
}

let data;
const loadData = () => (data ??= fetch(asset("data/relations.json")).then((r) => r.json()));

const frameCss = (width, height) => `
:host { display: block; position: relative; }
:host([hidden]) { display: none; }
.pr-stage { position: relative; width: 100%; height: calc(var(--pr-scale, 0) * ${height + TITLEBAR}px); visibility: hidden; }
.pr-stage[data-ready] { visibility: visible; }
.pr-window {
  position: absolute; top: 0; left: 0; width: ${width}px; height: ${height + TITLEBAR}px;
  transform: scale(var(--pr-scale, 0)); transform-origin: 0 0;
  border-radius: 10px; overflow: hidden; isolation: isolate;
  background: var(--background); box-shadow: var(--bui-shadow-overlay);
}
.pr-titlebar {
  position: relative; z-index: 1; height: ${TITLEBAR}px; display: flex; align-items: center; justify-content: center;
  background: var(--sidebar); border-bottom: 1px solid var(--border); box-sizing: border-box;
}
.pr-lights { position: absolute; left: 14px; top: 0; bottom: 0; display: flex; align-items: center; gap: 8px; }
.pr-lights span { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2); }
.pr-lights span:nth-child(1) { background: #ff5f57; }
.pr-lights span:nth-child(2) { background: #febc2e; }
.pr-lights span:nth-child(3) { background: #28c840; }
.pr-address {
  height: 24px; padding: 0 14px; border-radius: 6px; display: flex; align-items: center;
  background: var(--secondary); color: var(--muted-foreground);
  font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
}
.pr-app { position: absolute; top: ${TITLEBAR}px; left: 0; width: ${width}px; height: ${height}px; contain: layout; overflow: hidden; }
.pr-app * { scrollbar-width: none; }
.pr-app *::-webkit-scrollbar { display: none; }
.pr-under .cm-content { cursor: default; }
/* The app's canvas takes every touch (touch-none); on a page, a finger on the empty canvas has to
   scroll the page, and only a press that starts on a card is the diagram's. */
.pr-viewport { touch-action: manipulation; }
[data-table] { touch-action: none; }
[data-table]:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
.pr-pre [data-table], .pr-pre .pr-wires { opacity: 0 !important; }
.pr-held .animate-wire-pulse { animation-play-state: paused; }
`;

class PerchRelations extends HTMLElement {
  static observedAttributes = ["paused", "autoplay"];

  #root;
  #ready;
  #data;
  #icons = {};
  #stage;
  #window;
  #titlebar;
  #popup;
  #backdrop;
  #viewport;
  #canvas;
  #svg;
  #zoomLabel;
  #keysButton;
  #cards = new Map();
  #wires = new Map();
  #wireList = [];

  #keysOnly = false;
  #expanded = new Set();
  #stored = { all: null, keys: null };
  #graph;
  #nodeByKey;
  #referenced;
  #positions = new Map();
  #view = { pan: { x: 0, y: 0 }, zoom: 1 };
  #selected = null;
  #hovered = null;
  #drag = null;
  #frame = null;
  #pending = null;

  #width = 1280;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)");
  #visible = false;
  #resize;
  #observer;
  #anims = new Set();
  #token = 0;
  #phase = "idle"; // idle → entrance → done
  #pulsing = false;
  #drawing = false;
  #touched = false;
  #closed = false;
  #reopen = null;
  #played = false;
  #doneSent = false;
  #tourOwns = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#ready = this.#build();
  }

  get ready() {
    return this.#ready;
  }

  get anchors() {
    const cards = {};
    for (const [key, card] of this.#cards) cards[key.slice(key.indexOf(".") + 1)] = card;
    return { window: this.#window ?? null, titlebar: this.#titlebar ?? null, cards };
  }

  connectedCallback() {
    this.#resize ??= new ResizeObserver(() => this.#fit());
    this.#resize.observe(this);
    this.#fit();
    this.#observer ??= new IntersectionObserver(
      ([entry]) => {
        this.#visible = entry.isIntersecting && entry.intersectionRatio >= 0.4;
        this.#sync();
      },
      { threshold: [0, 0.4] },
    );
    this.#observer.observe(this);
    this.#reduced.addEventListener("change", this.#onMotionPreference);
  }

  disconnectedCallback() {
    this.#resize?.disconnect();
    this.#observer?.disconnect();
    this.#reduced.removeEventListener("change", this.#onMotionPreference);
    this.#visible = false;
    this.#sync();
  }

  attributeChangedCallback() {
    this.#sync();
  }

  play() {
    this.removeAttribute("paused");
    this.#ready.then(() => {
      // With autoplay off the picture opens finished; the first play() is what shows the entrance.
      if (!this.#autoplay && !this.#played && !this.#touched) {
        this.#played = true;
        this.#restore(true);
      }
      this.#sync();
    });
  }

  pause() {
    this.setAttribute("paused", "");
  }

  reset() {
    this.#ready.then(() => {
      this.#restore(this.#autoplay);
      this.#sync();
    });
  }

  get #autoplay() {
    return this.getAttribute("autoplay") !== "false";
  }

  get #running() {
    return this.isConnected && this.#visible && !this.hasAttribute("paused");
  }

  #onMotionPreference = () => {
    this.#ready.then(() => {
      this.#restore(this.#autoplay);
      this.#sync();
    });
  };

  async #build() {
    registerFonts();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = asset("css/app.css");
    const linked = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    this.#data = await loadData();
    const { width, height } = this.#data;
    this.#width = width;
    this.#icons = this.#data.icons;

    const frame = document.createElement("style");
    frame.textContent = frameCss(width, height);
    this.#stage = document.createElement("div");
    this.#stage.className = "pr-stage";
    this.#stage.innerHTML = `
      <div class="pr-window dark antialiased" role="group" aria-label="Perch's Relationship View: drag a table to move it, click one to focus on what it touches">
        <div class="pr-titlebar">
          <div class="pr-lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="pr-address">127.0.0.1:4600</div>
        </div>
        <div class="pr-app bg-background text-foreground font-sans">
          <div class="pr-under contents" inert aria-hidden="true">${this.#data.workspace}${this.#data.backdrop}</div>
          ${this.#data.dialog}
        </div>
      </div>`;
    this.#root.append(link, frame, this.#stage);
    this.#fit();
    this.#window = this.#stage.querySelector(".pr-window");
    this.#titlebar = this.#stage.querySelector(".pr-titlebar");
    this.#backdrop = this.#stage.querySelector("[data-slot=dialog-backdrop]");
    this.#popup = this.#stage.querySelector("[data-slot=dialog-popup]");
    for (const name of ["role", "tabindex", "id", "aria-labelledby", "aria-describedby", "data-base-ui-focusable"]) {
      this.#popup.removeAttribute(name);
    }
    this.#stage.querySelectorAll("[data-base-ui-tooltip-trigger]").forEach((button) => {
      button.removeAttribute("data-base-ui-tooltip-trigger");
      button.removeAttribute("id");
    });
    this.#viewport = this.#popup.querySelector("header + div");
    this.#viewport.classList.add("pr-viewport");
    this.#canvas = this.#viewport.querySelector(".origin-top-left");
    this.#zoomLabel = this.#popup.querySelector("header .w-10");
    this.#keysButton = this.#popup.querySelector("header button[aria-pressed]");

    this.#svg = document.createElementNS(SVG_NS, "svg");
    for (const [name, value] of [["aria-hidden", "true"], ["class", "pointer-events-none absolute top-0 left-0 overflow-visible will-change-transform pr-wires"], ["height", "1"], ["width", "1"]]) {
      this.#svg.setAttribute(name, value);
    }
    this.#canvas.append(this.#svg);
    for (const table of this.#data.tables) this.#canvas.append(this.#makeCard(table));

    this.#listen();
    this.#restore(this.#autoplay);
    await Promise.all([
      linked,
      document.fonts.load('400 12px "Geist Mono Variable"'),
      document.fonts.load('400 12px "Geist Variable"'),
      document.fonts.load('500 14px "Geist Variable"'),
    ]).catch(() => {});
    this.#stage.dataset.ready = "";
    this.#sync();
  }

  #fit() {
    const width = this.getBoundingClientRect().width || this.clientWidth;
    if (width && this.#stage) this.#stage.style.setProperty("--pr-scale", String(width / this.#width));
  }

  /** The first frame: the captured layout and view, and either the empty canvas or the finished one. */
  #restore(entrance) {
    this.#token++;
    for (const anim of this.#anims) anim.cancel();
    this.#anims.clear();
    this.#finishDraw();
    clearTimeout(this.#reopen);
    this.#setClosed(false);
    this.#keysOnly = isWide(this.#data.tables);
    this.#showKeysOnly();
    this.#expanded = new Set();
    this.#stored = { all: null, keys: null };
    this.#selected = null;
    this.#hovered = null;
    this.#tourOwns = false;
    this.#drag = null;
    this.#pending = null;
    this.#doneSent = false;
    this.#relayout();
    this.#view = structuredClone(this.#data.view);
    this.#applyView();
    const motion = !this.#reduced.matches;
    this.#phase = entrance && motion ? "idle" : "done";
    this.#pulsing = this.#phase === "done" && motion;
    this.#drawing = this.#phase === "idle";
    this.#stage.classList.toggle("pr-pre", this.#phase === "idle");
    this.#render();
  }

  #sync() {
    if (this.#stage?.dataset.ready === undefined) return;
    const running = this.#running;
    this.#stage.classList.toggle("pr-held", !running);
    for (const anim of this.#anims) running ? anim.play() : anim.pause();
    if (!running) return;
    if (this.#phase === "idle") this.#entrance();
    else if (this.#phase === "done" && !this.#doneSent) {
      this.#doneSent = true;
      this.#emitDone();
    }
  }

  #emitDone() {
    this.dispatchEvent(new CustomEvent("scene:done", { bubbles: true, composed: true, detail: { scene: "relations" } }));
  }

  /** A WAAPI animation as a timer: it pauses, resumes and cancels with everything else. */
  #track(anim) {
    this.#anims.add(anim);
    if (!this.#running) anim.pause();
    const done = anim.finished.then(
      () => true,
      () => false,
    );
    done.then(() => this.#anims.delete(anim));
    return done;
  }

  #wait(ms) {
    return this.#track(this.#stage.animate([], { duration: ms }));
  }

  async #entrance() {
    const token = ++this.#token;
    this.#phase = "entrance";
    this.#stage.classList.remove("pr-pre");
    const order = [...this.#cards.entries()].sort(([a], [b]) => {
      const pa = this.#positions.get(a);
      const pb = this.#positions.get(b);
      return pa.x - pb.x || pa.y - pb.y;
    });
    const cardsIn = order.map(([, card], index) =>
      this.#track(
        card.animate(
          [
            { opacity: 0, transform: "translateY(10px) scale(0.985)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: CARD_IN, delay: index * CARD_STAGGER, easing: EASE_OUT, fill: "backwards" },
        ),
      ),
    );

    // Each wire draws from the key it points at back to the column that holds it: parent to child.
    const wires = [...this.#wireList].sort((a, b) => {
      const pa = this.#positions.get(a.edge.to);
      const pb = this.#positions.get(b.edge.to);
      return pa.x - pb.x || pa.y - pb.y || a.start.y - b.start.y;
    });
    const drawn = wires.map((wire, index) => {
      const parts = this.#wires.get(wire.edge.id);
      const at = WIRES_AT + index * WIRE_STAGGER;
      parts.line.setAttribute("pathLength", "1");
      return Promise.all([
        this.#track(
          parts.line.animate(
            [
              { strokeDasharray: "1 2", strokeDashoffset: -1 },
              { strokeDasharray: "1 2", strokeDashoffset: 0 },
            ],
            { duration: WIRE_DRAW, delay: at, easing: EASE_IN_OUT, fill: "backwards" },
          ),
        ),
        this.#track(parts.bar.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: at, easing: "linear", fill: "backwards" })),
        this.#track(
          parts.crow.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 240,
            delay: at + WIRE_DRAW - 120,
            easing: "linear",
            fill: "backwards",
          }),
        ),
      ]);
    });
    await Promise.all([...cardsIn, ...drawn]);
    this.#finishDraw();
    if (token !== this.#token) return;

    // The wires drew in the app's lit stroke; they cool to the resting one as the pulses arrive.
    this.#coolWires(`${WIRE_COOL}ms`);
    this.#drawing = false;
    this.#pulsing = true;
    this.#render();
    const pulses = [...this.#wires.values()].map((parts) => parts.pulse).filter(Boolean);
    await Promise.all([
      ...pulses.map((pulse) => this.#track(pulse.animate([{ opacity: 0 }, { opacity: 1 }], { duration: PULSE_IN, easing: EASE_OUT }))),
      this.#wait(WIRE_COOL),
    ]);
    this.#coolWires("");
    if (token !== this.#token) return;
    this.#phase = "done";
    this.#doneSent = true;
    this.#emitDone();
    this.#tour(token);
  }

  #finishDraw() {
    for (const parts of this.#wires.values()) parts.line.removeAttribute("pathLength");
  }

  #coolWires(duration) {
    for (const parts of this.#wires.values()) {
      for (const element of [parts.line, parts.crow, parts.bar]) element.style.transitionDuration = duration;
    }
  }

  /** Until the visitor takes over: now and then, focus sightings the way a click would, then let go. */
  async #tour(token) {
    let gap = TOUR_FIRST;
    while (!this.#touched && token === this.#token) {
      if (!(await this.#wait(gap)) || this.#touched || token !== this.#token) return;
      gap = TOUR_GAP;
      if (this.#hovered || this.#drag || this.#selected || this.#closed) continue;
      this.#tourOwns = true;
      this.#hovered = TOUR_TABLE;
      this.#render();
      if (!(await this.#wait(TOUR_LIT)) || this.#touched || token !== this.#token) return;
      this.#hovered = null;
      this.#selected = TOUR_TABLE;
      this.#render();
      if (!(await this.#wait(TOUR_HOLD)) || this.#touched || token !== this.#token) return;
      this.#selected = null;
      this.#tourOwns = false;
      this.#render();
    }
  }

  /** The visitor's first touch ends everything that plays by itself, for good. */
  #takeOver() {
    this.#settle();
    if (this.#touched) return;
    this.#touched = true;
    for (const anim of [...this.#anims]) anim.cancel();
    this.#token++;
    if (this.#tourOwns) {
      this.#tourOwns = false;
      this.#selected = null;
      this.#hovered = null;
      this.#render();
    }
  }

  /** Whatever the entrance had left to do, done now, so a hand on the diagram meets the real thing. */
  #settle() {
    if (this.#phase === "done") return;
    for (const anim of [...this.#anims]) anim.finish();
    this.#token++;
    this.#stage.classList.remove("pr-pre");
    this.#finishDraw();
    this.#coolWires("");
    this.#drawing = false;
    this.#pulsing = !this.#reduced.matches;
    this.#phase = "done";
    this.#render();
    if (!this.#doneSent) {
      this.#doneSent = true;
      this.#emitDone();
    }
  }

  #relayout() {
    const base = buildGraph(this.#data.tables, this.#keysOnly, new Set());
    this.#positions = autoLayout(base.nodes, base.edges);
    const stored = this.#stored[this.#keysOnly ? "keys" : "all"];
    if (stored) for (const [key, at] of stored) if (this.#positions.has(key)) this.#positions.set(key, { ...at });
    this.#rebuildGraph();
  }

  #rebuildGraph() {
    this.#graph = buildGraph(this.#data.tables, this.#keysOnly, this.#expanded);
    this.#nodeByKey = new Map(this.#graph.nodes.map((node) => [node.key, node]));
    this.#referenced = new Set(this.#graph.edges.map((edge) => edge.to));
    for (const node of this.#graph.nodes) this.#fillCard(node);
    this.#makeWires();
    this.#place();
  }

  #icon(name, cls) {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
      `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-${name} ${cls}" aria-hidden="true">` +
      `${this.#icons[name] ?? this.#icons["table-2"]}</svg>`
    );
  }

  #makeCard(table) {
    const card = document.createElement("div");
    card.dataset.table = tableKey(table);
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-roledescription", "table");
    card.setAttribute("aria-label", `${table.name}: arrow keys move it, Enter focuses it`);
    card.addEventListener("pointerenter", () => this.#hover(card.dataset.table));
    card.addEventListener("pointerleave", () => this.#hover(null, card.dataset.table));
    this.#cards.set(card.dataset.table, card);
    return card;
  }

  /** table-card.tsx, as markup. */
  #fillCard(node) {
    const { table } = node;
    const references = new Map();
    for (const fk of table.foreignKeys) {
      fk.columns.forEach((column, index) => {
        references.set(column, `${fk.refTable}.${fk.refColumns[index] ?? fk.refColumns[0] ?? ""}`);
      });
    }
    const referenced = this.#referenced.has(node.key);
    const head =
      `<div class="flex h-8 items-center gap-1.5 border-b bg-muted/60 px-2.5">` +
      this.#icon(KIND_ICON[table.kind], "size-3.5 shrink-0 text-muted-foreground") +
      `<span class="min-w-0 truncate font-medium text-sm">` +
      (this.#data.showSchema ? `<span class="text-muted-foreground">${escapeHtml(table.schema)}.</span>` : "") +
      `${escapeHtml(table.name)}</span>` +
      (table.rowEstimate === undefined
        ? ""
        : `<span class="ms-auto shrink-0 font-mono text-muted-foreground text-xs tabular-nums">~${table.rowEstimate}</span>`) +
      `</div>`;
    const rows =
      node.rows.length === 0
        ? `<div class="flex h-6 items-center px-2.5 text-muted-foreground text-xs">${table.columns.length === 0 ? "No columns" : "No keys"}</div>`
        : node.rows.map((column) => this.#row(column, references.get(column.name), column.pk && referenced)).join("");
    const footer = node.footer
      ? `<button class="flex h-6 w-full cursor-pointer items-center gap-1.5 px-2.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:text-foreground" type="button">` +
        `<span class="flex size-3.5 shrink-0 items-center justify-center">${this.#icon(node.footer === "more" ? "chevron-down" : "chevron-up", "size-3")}</span>` +
        (node.footer === "more" ? `${node.hidden} more ${node.hidden === 1 ? "column" : "columns"}` : "Keys only") +
        `</button>`
      : "";
    const card = this.#cards.get(node.key);
    card.innerHTML = `${head}<div class="py-1">${rows}${footer}</div>`;
  }

  #row(column, reference, referenced) {
    const title = [
      `${column.name} ${column.type}${column.nullable ? " NULL" : " NOT NULL"}`,
      column.pk ? "Primary key" : null,
      reference ? `References ${reference}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    const marker = column.pk
      ? this.#icon("key-round", `size-3 ${referenced ? "text-warning-foreground" : "text-warning-foreground/70"}`)
      : reference
        ? this.#icon("link-2", "size-3 text-info-foreground")
        : `<span class="size-1 rounded-full bg-muted-foreground/40"></span>`;
    return (
      `<div class="flex h-6 items-center gap-1.5 px-2.5 text-xs" title="${escapeHtml(title)}">` +
      `<span class="flex size-3.5 shrink-0 items-center justify-center">${marker}</span>` +
      `<span class="min-w-0 truncate ${column.pk || reference ? "text-foreground" : "text-foreground/80"}">${escapeHtml(column.name)}</span>` +
      `<span class="ms-auto shrink-0 truncate font-mono text-muted-foreground tabular-nums">${escapeHtml(column.type)}` +
      (column.nullable ? `<span class="text-muted-foreground/60">?</span>` : "") +
      `</span></div>`
    );
  }

  #makeWires() {
    this.#svg.replaceChildren();
    this.#wires.clear();
    const path = (attributes) => {
      const element = document.createElementNS(SVG_NS, "path");
      for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
      return element;
    };
    this.#graph.edges.forEach((edge, index) => {
      const g = document.createElementNS(SVG_NS, "g");
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = `${edge.from}.${edge.fk.columns.join(", ")} → ${edge.to}.${edge.fk.refColumns.join(", ")}`;
      const stroke = { class: "transition-colors stroke-border", d: "", fill: "none", "stroke-width": "1.5" };
      const line = path(stroke);
      const crow = path(stroke);
      const bar = path(stroke);
      g.append(title, line, crow, bar);
      this.#svg.append(g);
      this.#wires.set(edge.id, { g, line, crow, bar, pulse: null, index, path });
    });
  }

  /** Positions to the cards, and the wires re-routed to follow them. */
  #place() {
    for (const [key, at] of this.#positions) {
      const card = this.#cards.get(key);
      card.style.setProperty("--x", `${at.x}px`);
      card.style.setProperty("--y", `${at.y}px`);
    }
    this.#wireList = routeWires(this.#graph.edges, this.#nodeByKey, this.#positions);
    for (const wire of this.#wireList) {
      const parts = this.#wires.get(wire.edge.id);
      const { d, start, startDir, end, endDir } = wire;
      parts.line.setAttribute("d", d);
      parts.pulse?.setAttribute("d", d);
      parts.crow.setAttribute(
        "d",
        `M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y - 5} M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y + 5}`,
      );
      parts.bar.setAttribute("d", `M ${end.x + endDir * 7} ${end.y - 5} L ${end.x + endDir * 7} ${end.y + 5}`);
    }
  }

  #applyView() {
    const { pan, zoom } = this.#view;
    this.#canvas.style.setProperty("--pan-x", `${pan.x}px`);
    this.#canvas.style.setProperty("--pan-y", `${pan.y}px`);
    this.#canvas.style.setProperty("--zoom", String(zoom));
    this.#zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  }

  /** Card and wire states, as diagram-canvas.tsx derives them. */
  #render() {
    const active = this.#selected ?? this.#hovered;
    let related = null;
    if (active) {
      related = new Set([active]);
      for (const edge of this.#graph.edges) {
        if (edge.from === active) related.add(edge.to);
        if (edge.to === active) related.add(edge.from);
      }
    }
    const dragging = this.#drag?.kind === "card" ? this.#drag.key : null;
    for (const [key, card] of this.#cards) {
      const selected = this.#selected === key;
      const dim = this.#selected !== null && related !== null && !related.has(key);
      const classes = [dragging === key ? CARD.replace(" shadow-sm/5", "") : CARD];
      classes.push(dragging === key ? "cursor-grabbing shadow-lg/10" : "cursor-grab");
      if (selected) classes.push("border-ring ring-2 ring-ring/40");
      if (dim) classes.push("opacity-40");
      card.className = classes.join(" ");
      if (selected) card.dataset.selected = "true";
      else delete card.dataset.selected;
      card.setAttribute("aria-pressed", String(selected));
    }

    const { pan, zoom } = this.#view;
    const visible = {
      x: -pan.x / zoom,
      y: -pan.y / zoom,
      w: this.#viewport.clientWidth / zoom,
      h: this.#viewport.clientHeight / zoom,
    };
    const paused = this.#drag !== null;
    for (const wire of this.#wireList) {
      const parts = this.#wires.get(wire.edge.id);
      const touches = wire.edge.from === active || wire.edge.to === active;
      const state = active === null ? "idle" : touches ? "lit" : this.#selected ? "hidden" : "muted";
      const lit = state === "lit";
      parts.g.setAttribute(
        "class",
        `transition-opacity duration-200${state === "muted" ? " opacity-25" : state === "hidden" ? " opacity-0" : ""}`,
      );
      const stroke = `transition-colors ${lit || this.#drawing ? "stroke-foreground/60" : "stroke-border"}`;
      for (const element of [parts.line, parts.crow, parts.bar]) element.setAttribute("class", stroke);
      const animate = this.#pulsing && state !== "hidden" && intersects(wireBounds(wire), visible);
      if (animate && !parts.pulse) {
        parts.pulse = parts.path({
          class: "",
          d: wire.d,
          fill: "none",
          pathLength: "1",
          "stroke-dasharray": `${PULSE_LEN} 1`,
          "stroke-linecap": "round",
          "stroke-width": "2",
          style: `--wire-delay: ${-((parts.index % PULSE_PHASES) * (TRAVEL_S / PULSE_PHASES))}s;`,
        });
        parts.line.after(parts.pulse);
      } else if (!animate && parts.pulse) {
        parts.pulse.remove();
        parts.pulse = null;
      }
      parts.pulse?.setAttribute(
        "class",
        `animate-wire-pulse transition-colors${paused ? " paused" : ""} ${lit ? "stroke-info" : "stroke-info/70"}`,
      );
    }
    this.#viewport.classList.toggle("cursor-grabbing", this.#drag?.kind === "pan");
    this.#viewport.classList.toggle("cursor-grab", this.#drag?.kind !== "pan");
  }

  #hover(key, leaving) {
    if (leaving && this.#hovered !== leaving) return;
    if (this.#hovered === key) return;
    this.#hovered = key;
    this.#render();
  }

  /** Runs the latest piece of work once, on the next frame — pointers move faster than frames. */
  #schedule(work) {
    this.#pending = work;
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = null;
      const run = this.#pending;
      this.#pending = null;
      run?.();
    });
  }

  #flush() {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    const run = this.#pending;
    this.#pending = null;
    run?.();
  }

  #moveCard(key, at) {
    this.#positions.set(key, at);
    this.#place();
    this.#render();
  }

  #savePositions() {
    this.#stored[this.#keysOnly ? "keys" : "all"] = new Map([...this.#positions].map(([k, v]) => [k, { ...v }]));
  }

  /** CSS px on the page per app px: the window is drawn at native size and scaled to fit. */
  #pageScale() {
    return this.#window.getBoundingClientRect().width / this.#width || 1;
  }

  #listen() {
    const viewport = this.#viewport;
    viewport.addEventListener("pointerdown", (event) => {
      this.#takeOver();
      if (this.#drag || (event.pointerType === "mouse" && event.button !== 0)) return;
      const card = event.target.closest("[data-table]");
      if (card && event.target.closest("button")) return;
      const origin = { x: event.clientX, y: event.clientY };
      const scale = this.#pageScale();
      if (card) {
        const key = card.dataset.table;
        viewport.setPointerCapture(event.pointerId);
        this.#drag = { kind: "card", pointerId: event.pointerId, key, origin, at: { ...this.#positions.get(key) }, moved: false, scale, touch: event.pointerType === "touch" };
      } else if (event.pointerType === "touch") {
        // Left to the page: if the finger scrolls, the browser cancels this pointer.
        this.#drag = { kind: "tap", pointerId: event.pointerId, origin, moved: false, scale, touch: true };
        return;
      } else {
        viewport.setPointerCapture(event.pointerId);
        this.#drag = { kind: "pan", pointerId: event.pointerId, origin, pan: { ...this.#view.pan }, moved: false, scale, touch: false };
      }
      this.#render();
    });
    viewport.addEventListener("pointermove", (event) => {
      const drag = this.#drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.origin.x;
      const dy = event.clientY - drag.origin.y;
      if (!drag.moved && Math.hypot(dx, dy) <= (drag.touch ? TOUCH_SLOP : CLICK_SLOP)) return;
      drag.moved = true;
      if (drag.kind === "pan") {
        const pan = { x: drag.pan.x + dx / drag.scale, y: drag.pan.y + dy / drag.scale };
        this.#schedule(() => {
          this.#view.pan = pan;
          this.#applyView();
        });
      } else if (drag.kind === "card") {
        const k = drag.scale * this.#view.zoom;
        const next = { x: drag.at.x + dx / k, y: drag.at.y + dy / k };
        this.#schedule(() => this.#moveCard(drag.key, next));
      }
    });
    const end = (event) => {
      const drag = this.#drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
      this.#flush();
      this.#drag = null;
      if (event.type === "pointerup" && !drag.moved) {
        this.#selected = drag.kind === "card" && this.#selected !== drag.key ? drag.key : null;
      } else if (drag.kind === "card" && drag.moved) {
        this.#savePositions();
      }
      this.#render();
    };
    viewport.addEventListener("pointerup", end);
    viewport.addEventListener("pointercancel", end);
    viewport.addEventListener("lostpointercapture", (event) => {
      if (this.#drag?.pointerId === event.pointerId && this.#drag.kind !== "tap") end(event);
    });

    viewport.addEventListener("click", (event) => {
      const button = event.target.closest("[data-table] button");
      if (button) this.#toggleCard(button.closest("[data-table]").dataset.table);
    });
    viewport.addEventListener("keydown", (event) => {
      const card = event.target.closest?.("[data-table]");
      if (!card || event.target !== card) return;
      this.#takeOver();
      const key = card.dataset.table;
      const step = event.shiftKey ? NUDGE_FAR : NUDGE;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (delta) {
        event.preventDefault();
        const at = this.#positions.get(key);
        this.#moveCard(key, { x: at.x + delta[0], y: at.y + delta[1] });
        this.#savePositions();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.#selected = this.#selected === key ? null : key;
        this.#render();
      } else if (event.key === "Escape" && this.#selected) {
        this.#selected = null;
        this.#render();
      }
    });
    this.#stage.addEventListener("focusin", () => this.#takeOver());

    this.#popup.querySelector("header").addEventListener("click", (event) => {
      const button = event.target.closest("button");
      if (!button) return;
      this.#takeOver();
      if (button === this.#keysButton) return this.#setKeysOnly(!this.#keysOnly);
      const label = button.getAttribute("aria-label");
      if (label === "Zoom out") this.#zoomBy(1 / ZOOM_STEP);
      else if (label === "Zoom in") this.#zoomBy(ZOOM_STEP);
      else if (label === "Fit to view") this.#fitView();
      else if (label === "Reset layout") this.#resetLayout();
      else if (label === "Close") this.#close();
    });
    this.#window.addEventListener("pointerdown", (event) => {
      if (this.#closed && !this.#popup.contains(event.target)) this.#setClosed(false);
    });
  }

  #setKeysOnly(next) {
    this.#keysOnly = next;
    this.#showKeysOnly();
    this.#expanded = new Set();
    this.#relayout();
    this.#render();
  }

  #showKeysOnly() {
    this.#keysButton.className = this.#data.keysOnly[this.#keysOnly ? "on" : "off"];
    this.#keysButton.setAttribute("aria-pressed", String(this.#keysOnly));
  }

  /** use-diagram-layout.ts: opening one card pushes the cards under it down, nothing else moves. */
  #toggleCard(key) {
    const node = this.#nodeByKey.get(key);
    const at = this.#positions.get(key);
    if (!node || !at) return;
    const next = new Set(this.#expanded);
    if (!next.delete(key)) next.add(key);
    const delta = buildNode(node.table, this.#keysOnly, next).h - node.h;
    this.#expanded = next;
    if (delta !== 0) {
      for (const [other, otherAt] of this.#positions) {
        if (other === key || otherAt.y <= at.y || Math.abs(otherAt.x - at.x) >= CARD_W) continue;
        this.#positions.set(other, { x: otherAt.x, y: otherAt.y + delta });
      }
    }
    this.#rebuildGraph();
    this.#render();
  }

  #bounds() {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.#graph.nodes) {
      const at = this.#positions.get(node.key);
      if (!at) continue;
      minX = Math.min(minX, at.x);
      minY = Math.min(minY, at.y);
      maxX = Math.max(maxX, at.x + node.w);
      maxY = Math.max(maxY, at.y + node.h);
    }
    if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: minX - GAP_X, y: minY - GAP_Y, w: maxX - minX + GAP_X * 2, h: maxY - minY + GAP_Y * 2 };
  }

  #fitView() {
    const bounds = this.#bounds();
    if (bounds.w === 0) return;
    const width = this.#viewport.clientWidth;
    const height = this.#viewport.clientHeight;
    const zoom = Math.max(ZOOM_MIN, Math.min(1, (width - FIT_PAD * 2) / bounds.w, (height - FIT_PAD * 2) / bounds.h));
    this.#view = {
      zoom,
      pan: { x: (width - bounds.w * zoom) / 2 - bounds.x * zoom, y: (height - bounds.h * zoom) / 2 - bounds.y * zoom },
    };
    this.#applyView();
    this.#render();
  }

  #zoomBy(factor) {
    const previous = this.#view;
    const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, previous.zoom * factor));
    const pivot = { x: this.#viewport.clientWidth / 2, y: this.#viewport.clientHeight / 2 };
    const scale = zoom / previous.zoom;
    this.#view = {
      zoom,
      pan: { x: pivot.x - (pivot.x - previous.pan.x) * scale, y: pivot.y - (pivot.y - previous.pan.y) * scale },
    };
    this.#applyView();
    this.#render();
  }

  #resetLayout() {
    this.#stored[this.#keysOnly ? "keys" : "all"] = null;
    this.#expanded = new Set();
    this.#relayout();
    this.#fitView();
  }

  /** The app closes the dialog onto the workspace; here it comes back on the next press, or soon. */
  #close() {
    this.#setClosed(true);
    this.#reopen = setTimeout(() => this.#setClosed(false), 2400);
  }

  #setClosed(closed) {
    if (this.#closed === closed) return;
    this.#closed = closed;
    clearTimeout(this.#reopen);
    for (const element of [this.#popup, this.#backdrop]) {
      element.toggleAttribute("data-ending-style", closed);
      element.toggleAttribute("data-open", !closed);
    }
    this.#popup.style.pointerEvents = closed ? "none" : "";
  }
}

customElements.define("perch-relations", PerchRelations);

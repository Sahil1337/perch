/**
 * <perch-terminal> — installing Perch and starting it for the first time, replayed from a recording
 * of the real installer and binary (assets/data/terminal.json), ending on the browser `perch` opens.
 *
 *   <script type="module" src="assets/js/terminal.js"></script>
 *   <perch-terminal></perch-terminal>
 *
 * Attributes
 *   autoplay  On unless autoplay="false". Plays while at least 40% visible, pauses offscreen.
 *   paused    Holds the scene where it is; removing it resumes.
 *
 * Methods
 *   play()   Starts or resumes the scene.
 *   pause()  Holds the scene.
 *   reset()  Back to the empty prompt.
 *
 * Properties
 *   anchors  { window, titlebar, browser }: the terminal window, its titlebar and the browser
 *            window, live elements inside the shadow root, never replaced once `ready` resolves.
 *   ready    Resolves once the recording, both frames of the app and the fonts are in.
 *
 * Events (CustomEvent, bubbles, composed)
 *   scene:done  The browser window has landed in front of the terminal.
 *   scene:loop  The scene starts over.
 *
 * Fills its container's width. The terminal fills the box and the browser lands over its empty
 * lower part: from 640px wide over the lower right, narrower under every line of the session. The
 * box is only as tall as that composition. Text wraps at the terminal's column count, the way a
 * terminal does.
 * Animation only: it loops on its own and takes no pointer or key. Under prefers-reduced-motion it
 * shows the end state.
 */

const ASSETS = new URL("../", import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const START_MS = 1100;
const BEFORE_ENTER_MS = 520;
const PROMPT_MS = 60;
const RISE = { duration: 820, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
const SINK = { duration: 520, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };
const FADE = { duration: 360, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };
const HOLD_MS = 7000;

// A person typing a long URL: steady, a little slower around the punctuation they check.
const SEED = 0x5eed;
const KEY = { base: 44, jitter: 26, space: 80, pipe: 170, slash: 26, dot: 14, first: 120 };

const CANCELLED = Symbol("cancelled");

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function keyDelay(char, index, next, pace) {
  let ms = (KEY.base + (next() - 0.5) * 2 * KEY.jitter) * pace;
  if (index === 0) ms += KEY.first;
  if (char === " ") ms += KEY.space;
  else if (char === "|") ms += KEY.pipe;
  else if (char === "/") ms += KEY.slash;
  else if (char === ".") ms += KEY.dot;
  return Math.max(18, Math.round(ms));
}

/** Hard-wraps styled text at `cols`, the way a terminal fills its grid: mid-word, no reflow. */
function wrap(parts, cols) {
  const rows = [[]];
  let used = 0;
  for (const [text, cls] of parts) {
    let i = 0;
    while (i < text.length) {
      if (used === cols) {
        rows.push([]);
        used = 0;
      }
      const take = Math.min(cols - used, text.length - i);
      rows[rows.length - 1].push([text.slice(i, i + take), cls]);
      i += take;
      used += take;
    }
  }
  return rows;
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// A pausable clock: every wait and animation in the scene goes through it, so pausing offscreen
// freezes the scene mid-keystroke and resuming carries on from the same instant.
class Clock {
  #running = false;
  #timers = new Set();
  #anims = new Set();

  wait(ms) {
    return new Promise((resolve) => {
      const timer = { left: ms, at: 0, id: 0, resolve };
      this.#timers.add(timer);
      if (this.#running) this.#arm(timer);
    });
  }

  animate(el, frames, options) {
    const anim = el.animate(frames, options);
    this.#anims.add(anim);
    if (!this.#running) anim.pause();
    const drop = () => this.#anims.delete(anim);
    anim.finished.then(drop, drop);
    return anim.finished;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    for (const timer of this.#timers) this.#arm(timer);
    for (const anim of this.#anims) anim.play();
  }

  stop() {
    if (!this.#running) return;
    this.#running = false;
    const now = performance.now();
    for (const timer of this.#timers) {
      clearTimeout(timer.id);
      timer.left = Math.max(0, timer.left - (now - timer.at));
    }
    for (const anim of this.#anims) anim.pause();
  }

  clear() {
    for (const timer of this.#timers) clearTimeout(timer.id);
    this.#timers.clear();
    for (const anim of this.#anims) anim.cancel();
    this.#anims.clear();
  }

  #arm(timer) {
    timer.at = performance.now();
    timer.id = setTimeout(() => {
      this.#timers.delete(timer);
      timer.resolve();
    }, timer.left);
  }
}

// @font-face does not apply from inside a shadow root, so the faces go on the document, once, under
// the same marker <perch-workspace> and the page use, so whichever comes first wins.
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

let recording;
function loadRecording() {
  recording ??= fetch(asset("data/terminal.json")).then((r) => {
    if (!r.ok) throw new Error(`terminal.json: ${r.status}`);
    return r.json();
  });
  return recording;
}

const CSS = `
:host {
  display: block; position: relative; container-type: inline-size;
  --t-page: var(--app-page, oklch(20.9% 0.004 264.477));
  --t-bar: oklch(23.1% 0.004 264.487);
  --t-field: oklch(29.3% 0.006 271.223);
  --t-ink: var(--ink, oklch(96.4% 0.002 247.839));
  --t-ink-2: var(--ink-2, oklch(73.1% 0.008 260.731));
  --t-ink-3: var(--ink-3, oklch(54.1% 0.01 264.484));
  --t-line: var(--line, oklch(30.8% 0.006 258.354));
  --t-accent: var(--accent, oklch(68% 0.173 253.301));
  --t-mono: var(--font-mono, "Geist Mono Variable", ui-monospace, SFMono-Regular, monospace);
  --t-sans: var(--font-sans, "Geist Variable", ui-sans-serif, system-ui, sans-serif);
  --t-radius: var(--radius-window, 12px);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }

/* The terminal fills the box and the browser lands over its lower part, so the box is only as tall
   as the composition: the rows that stay in sight above the browser (--t-rows-above, under the
   terminal's titlebar and top padding), then the browser itself, a titlebar over the recording's
   800:500 view; 2.42 is those two titlebars and the padding, in titlebar heights. The browser
   overhangs the terminal into a band below it. From 640px wide every
   line but the first is short, so the browser covers the right of the terminal below row three;
   narrower, the lines run the terminal's width and the browser takes the space under all of them.
   The page reserves this same height before the module runs (scenes/legacy/legacy.css). */
.stage {
  position: relative; width: 100%; visibility: hidden;
  --t-bar-h: clamp(28px, 3cqw, 38px);
  --t-font: clamp(11px, 1.2cqw, 15px);
  --t-rows-above: 3.5;
  --t-browser-w: 56cqw;
  --t-browser-inset: 3cqw;
  --t-band: calc(28px + clamp(10px, 1.2cqw, 14px));
  height: calc(2.42 * var(--t-bar-h) + var(--t-rows-above) * 1.6 * var(--t-font) + 0.625 * var(--t-browser-w));
}
.stage[data-ready] { visibility: visible; }

.window {
  position: absolute; display: flex; flex-direction: column; overflow: hidden; isolation: isolate;
  border-radius: var(--t-radius); background: var(--t-page);
  box-shadow: 0 0 0 1px oklch(100% 0 0 / 0.15), 0 8px 28px oklch(0% 0 0 / 0.34);
}
.bar {
  position: relative; flex: none; height: var(--t-bar-h); display: flex; align-items: center;
  justify-content: center; background: var(--t-bar); border-bottom: 1px solid var(--t-line);
}
.lights {
  position: absolute; left: calc(var(--t-bar-h) * 0.36); top: 0; bottom: 0;
  display: flex; align-items: center; gap: calc(var(--t-bar-h) * 0.2);
}
.lights span {
  width: calc(var(--t-bar-h) * 0.3); height: calc(var(--t-bar-h) * 0.3); border-radius: 50%;
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2); transition: background-color 240ms ease;
}
.lights span:nth-child(1) { background: #ff5f57; }
.lights span:nth-child(2) { background: #febc2e; }
.lights span:nth-child(3) { background: #28c840; }
.title {
  font: 500 calc(var(--t-bar-h) * 0.32) / 1 var(--t-sans); color: var(--t-ink-2);
  letter-spacing: 0.01em; transition: color 240ms ease;
}

.term { left: 0; top: 0; width: 100%; height: calc(100% - var(--t-band)); }
.screen {
  position: relative; flex: 1; min-height: 0; display: flex; cursor: default;
  padding: calc(var(--t-bar-h) * 0.42) calc(var(--t-bar-h) * 0.5);
  font-family: var(--t-mono); font-size: var(--t-font); line-height: 1.6; color: var(--t-ink-2);
  font-variant-ligatures: none; font-feature-settings: "liga" 0, "calt" 0;
  -webkit-font-smoothing: antialiased;
}
.screen ::selection { background: color-mix(in oklab, var(--t-accent) 30%, transparent); }
.grid { position: relative; flex: 1; min-width: 0; overflow: hidden; }
.r { height: 1lh; white-space: pre; overflow: hidden; }
.dir { color: var(--t-ink-2); }
.sym { color: var(--t-ink-3); }
.cmd { color: var(--t-ink); }
.probe { position: absolute; visibility: hidden; white-space: pre; }

.caret {
  display: inline-block; width: 1ch; height: 1.3em; vertical-align: -0.3em; border-radius: 1px;
  background: var(--t-accent); user-select: none;
  animation: blink 1.1s ease-in-out 0.55s infinite;
}
@keyframes blink {
  0%, 42% { opacity: 1; }
  50%, 92% { opacity: 0; }
  100% { opacity: 1; }
}

/* The browser has focus: the terminal goes inactive the way a macOS window does. */
.stage[data-focus="browser"] .term .lights span { background: oklch(38% 0.006 264); }
.stage[data-focus="browser"] .term .title { color: var(--t-ink-3); }
.stage[data-focus="browser"] .caret {
  background: transparent; box-shadow: inset 0 0 0 1.25px var(--t-accent); animation: none;
}

.browser {
  right: var(--t-browser-inset); bottom: 0; width: var(--t-browser-w); visibility: hidden; transform-origin: 50% 100%;
  box-shadow: 0 0 0 1px oklch(100% 0 0 / 0.15), 0 10px 30px oklch(0% 0 0 / 0.34),
    0 34px 90px -12px oklch(0% 0 0 / 0.55);
}
.stage[data-browser] .browser { visibility: visible; }
.address {
  height: calc(var(--t-bar-h) * 0.6); padding: 0 calc(var(--t-bar-h) * 0.36); display: flex;
  align-items: center; border-radius: calc(var(--t-bar-h) * 0.15); background: var(--t-field);
  color: var(--t-ink-2); font: 400 calc(var(--t-bar-h) * 0.3) / 1 var(--t-sans);
  font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
}
.view { position: relative; flex: none; aspect-ratio: var(--t-view); background: var(--t-page); }
.view img {
  position: absolute; inset: 0; width: 100%; height: 100%; display: block;
  user-select: none; -webkit-user-drag: none;
}
/* Opacity, not visibility: a child set visible would show through the hidden window. */
.view .found { opacity: 0; }
.stage[data-found] .view .found { opacity: 1; }

/* The first-run screen's link animation, redrawn over the still at the wire's captured place. */
.wire { position: absolute; overflow: hidden; border-radius: 999px; }
.pulse {
  position: absolute; top: 0; bottom: 0; left: 0; width: 66.667%;
  background: linear-gradient(to right, transparent, var(--t-ink), transparent);
  animation: pulse var(--t-travel, 2200ms) linear infinite;
}
@keyframes pulse {
  from { transform: translateX(-120%); }
  to { transform: translateX(220%); }
}
.stage[data-reduced] .pulse { display: none; }

.stage[data-paused] * { animation-play-state: paused !important; }

@container (max-width: 639.98px) {
  .stage { --t-font: clamp(10px, 2.85cqw, 13px); --t-rows-above: 11.4; --t-browser-w: 82cqw; }
}
`;

class PerchTerminal extends HTMLElement {
  static observedAttributes = ["paused", "autoplay"];

  #root;
  #ready;
  #built = false;
  #data;
  #el = {};
  #lines = [];
  #caretLine = -1;
  #cols = 80;
  #rowsVisible = 20;
  #lineHeight = 0;
  #clock = new Clock();
  #token = null;
  #visible = false;
  #playRequested = false;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)");
  #observer;
  #resize;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#ready = this.#build();
  }

  get ready() {
    return this.#ready;
  }

  get anchors() {
    return { window: this.#el.term ?? null, titlebar: this.#el.titlebar ?? null, browser: this.#el.browser ?? null };
  }

  connectedCallback() {
    this.#resize ??= new ResizeObserver(() => this.#measure());
    this.#resize.observe(this);
    this.#observer ??= new IntersectionObserver(
      ([entry]) => {
        this.#visible = entry.intersectionRatio >= 0.4;
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
    this.#playRequested = true;
    this.removeAttribute("paused");
    this.#sync();
  }

  pause() {
    this.setAttribute("paused", "");
  }

  reset() {
    this.#cancel();
    this.#ready.then(() => {
      this.#showStart();
      this.#sync();
    });
  }

  #onMotionPreference = () => this.reset();

  async #build() {
    registerFonts();
    const style = document.createElement("style");
    style.textContent = CSS;
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.setAttribute("role", "group");
    stage.setAttribute("aria-label", "Installing Perch in a terminal and starting it");
    stage.innerHTML = `
      <section class="window term" aria-label="Terminal">
        <div class="bar">
          <div class="lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="title"></div>
        </div>
        <div class="screen"><div class="grid"><div class="rows"></div></div><span class="probe" aria-hidden="true"></span></div>
      </section>
      <section class="window browser" aria-label="Browser">
        <div class="bar">
          <div class="lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="address"></div>
        </div>
        <div class="view">
          <img class="scan" alt="" draggable="false" decoding="async" />
          <img class="found" draggable="false" decoding="async"
            alt="Perch's first-run screen, Connect a database, listing the Postgres server it found on this machine" />
          <div class="wire" aria-hidden="true"><div class="pulse"></div></div>
        </div>
      </section>`;
    this.#root.append(style, stage);

    const q = (s) => stage.querySelector(s);
    this.#el = {
      stage,
      term: q(".term"),
      titlebar: q(".term .bar"),
      title: q(".title"),
      screen: q(".screen"),
      grid: q(".grid"),
      rows: q(".rows"),
      probe: q(".probe"),
      browser: q(".browser"),
      address: q(".address"),
      view: q(".view"),
      scan: q(".view .scan"),
      found: q(".view .found"),
      wire: q(".wire"),
    };
    this.#el.probe.textContent = "0".repeat(50);

    const data = (this.#data = await loadRecording());
    const [vw, vh] = data.browser.viewport;
    const wire = data.browser.wire;
    this.#el.address.textContent = data.host;
    this.#el.view.style.setProperty("--t-view", `${vw} / ${vh}`);
    this.#el.wire.style.cssText =
      `left:${(wire.x / vw) * 100}%;width:${(wire.w / vw) * 100}%;height:${(wire.h / vh) * 100}%;` +
      `top:${(wire.y.scan / vh) * 100}%`;
    this.#el.wire.style.setProperty("--t-travel", `${wire.travelMs}ms`);
    this.#el.scan.src = asset(data.browser.frames.scan);
    this.#el.found.src = asset(data.browser.frames.found);

    await Promise.all([
      this.#el.scan.decode(),
      this.#el.found.decode(),
      document.fonts.load('400 14px "Geist Mono Variable"'),
      document.fonts.load('500 13px "Geist Variable"'),
    ]).catch(() => {});

    this.#built = true;
    this.#measure();
    this.#showStart();
    stage.dataset.ready = "";
    this.#sync();
  }

  #measure() {
    if (!this.#built) return;
    const { grid, probe } = this.#el;
    const ch = probe.getBoundingClientRect().width / 50;
    const lh = parseFloat(getComputedStyle(grid).lineHeight);
    if (!ch || !lh) return;
    const width = grid.clientWidth;
    const height = grid.clientHeight;
    const cols = Math.max(20, Math.floor(width / ch + 0.01));
    const rows = Math.max(4, Math.floor(height / lh + 0.01));
    if (cols === this.#cols && rows === this.#rowsVisible && lh === this.#lineHeight) return;
    this.#cols = cols;
    this.#rowsVisible = rows;
    this.#lineHeight = lh;
    this.#render();
  }

  #render() {
    const rows = [];
    this.#lines.forEach((parts, index) => {
      const wrapped = wrap(parts, this.#cols);
      if (index === this.#caretLine) {
        const length = parts.reduce((n, [text]) => n + text.length, 0);
        if (length > 0 && length % this.#cols === 0) wrapped.push([]);
        wrapped[wrapped.length - 1].push(["", "caret"]);
      }
      rows.push(...wrapped);
    });
    this.#el.rows.innerHTML = rows
      .map(
        (row) =>
          `<div class="r">${row
            .map(([text, cls]) =>
              cls === "caret" ? '<span class="caret"></span>' : cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text),
            )
            .join("")}</div>`,
      )
      .join("");
    // A full screen scrolls the way a terminal does: whole rows, no easing.
    const overflow = Math.max(0, rows.length - this.#rowsVisible);
    this.#el.rows.style.transform = overflow ? `translateY(${-overflow * this.#lineHeight}px)` : "";
  }

  #promptLine(command = "") {
    const [dir, ...rest] = this.#data.prompt.split(" ");
    return [
      [dir, "dir"],
      [` ${rest.join(" ")} `, "sym"],
      [command, "cmd"],
    ];
  }

  #showStart() {
    const { stage } = this.#el;
    this.#lines = [this.#promptLine()];
    this.#caretLine = 0;
    this.#el.title.textContent = this.#data.title;
    delete stage.dataset.browser;
    delete stage.dataset.found;
    delete stage.dataset.focus;
    this.#placeWire(false);
    this.#render();
  }

  #showEnd() {
    const { stage } = this.#el;
    this.#lines = [];
    for (const step of this.#data.session) {
      this.#lines.push(this.#promptLine(step.command));
      for (const line of step.output) this.#lines.push([[line.text, ""]]);
      if (step.title) this.#el.title.textContent = step.title;
    }
    this.#lines.push([["", ""]]);
    this.#caretLine = this.#lines.length - 1;
    stage.dataset.browser = "";
    stage.dataset.found = "";
    stage.dataset.focus = "browser";
    this.#placeWire(true);
    this.#render();
  }

  #placeWire(found) {
    const { wire, viewport } = this.#data.browser;
    this.#el.wire.style.top = `${((found ? wire.y.found : wire.y.scan) / viewport[1]) * 100}%`;
  }

  #cancel() {
    this.#clock.clear();
    this.#token = null;
  }

  #sync() {
    if (!this.#built) return;
    const { stage } = this.#el;
    if (this.#reduced.matches) {
      this.#cancel();
      stage.dataset.reduced = "";
      this.#showEnd();
      return;
    }
    delete stage.dataset.reduced;
    const autoplay = this.getAttribute("autoplay") !== "false";
    const play = this.#visible && !this.hasAttribute("paused") && (autoplay || this.#playRequested);
    if (play) {
      if (!this.#token) this.#start();
      delete stage.dataset.paused;
      this.#clock.start();
    } else {
      this.#clock.stop();
      stage.dataset.paused = "";
    }
  }

  #start() {
    const token = (this.#token = {});
    this.#run(token).catch((error) => {
      if (error !== CANCELLED && error?.name !== "AbortError") throw error;
    });
  }

  #emit(name) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }

  async #run(token) {
    const live = () => {
      if (token !== this.#token) throw CANCELLED;
    };
    const wait = async (ms) => {
      await this.#clock.wait(ms);
      live();
    };
    const animate = async (el, frames, options) => {
      await this.#clock.animate(el, frames, options);
      live();
    };
    const { stage, browser, screen } = this.#el;
    const data = this.#data;

    for (let loop = 0; ; loop++) {
      if (loop > 0) {
        this.#emit("scene:loop");
        this.#showStart();
        await animate(screen, [{ opacity: 0 }, { opacity: 1 }], FADE);
      }
      await wait(START_MS);

      for (const step of data.session) {
        const next = random(SEED);
        const line = this.#lines.length - 1;
        // A short word is typed deliberately; a long URL is typed in a practised run.
        const pace = step.command.length < 12 ? 1.8 : 1;
        for (let i = 0; i < step.command.length; i++) {
          this.#lines[line] = this.#promptLine(step.command.slice(0, i + 1));
          this.#render();
          await wait(keyDelay(step.command[i], i, next, pace));
        }
        await wait(BEFORE_ENTER_MS);
        if (step.title) this.#el.title.textContent = step.title;
        this.#lines.push([["", ""]]);
        this.#caretLine = this.#lines.length - 1;
        this.#render();
        for (const out of step.output) {
          await wait(out.wait);
          this.#lines.splice(this.#lines.length - 1, 0, [[out.text, ""]]);
          this.#caretLine = this.#lines.length - 1;
          this.#render();
        }
        if (step.returns) {
          await wait(PROMPT_MS);
          this.#lines[this.#lines.length - 1] = this.#promptLine();
          this.#render();
          await wait(1250);
        }
      }

      await wait(data.browser.opensAfter);
      stage.dataset.browser = "";
      stage.dataset.focus = "browser";
      await animate(
        browser,
        [
          { opacity: 0, transform: "translateY(7%) scale(0.965)" },
          { opacity: 1, transform: "none" },
        ],
        RISE,
      );
      this.#emit("scene:done");
      await wait(data.browser.scanMs);
      stage.dataset.found = "";
      this.#placeWire(true);

      await wait(HOLD_MS);
      await animate(browser, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(4%) scale(0.98)" }], {
        ...SINK,
        fill: "forwards",
      });
      delete stage.dataset.browser;
      delete stage.dataset.focus;
      browser.getAnimations().forEach((a) => a.cancel());
      await wait(420);
      await animate(screen, [{ opacity: 1 }, { opacity: 0 }], { ...FADE, fill: "forwards" });
      screen.getAnimations().forEach((a) => a.cancel());
    }
  }
}

if (!customElements.get("perch-terminal")) customElements.define("perch-terminal", PerchTerminal);

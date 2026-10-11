/**
 * <perch-workspace> — the Perch workspace, rebuilt from captures of the real app (see
 * site/capture/), playing scripted scenes on recorded data.
 *
 *   <script type="module" src="assets/js/workspace.js"></script>
 *   <perch-workspace scene="hero"></perch-workspace>
 *
 * Attributes
 *   scene     Read when the element first connects.
 *             "hero" (default) — a query finished with completion and run.
 *             "join" — JOINs written with foreign-key completion, then a column from the joined table.
 *             "notebook" — a .sql file of three `-- %%` cells, run one after another.
 *   autoplay  On unless autoplay="false". Plays while at least 40% visible, pauses offscreen.
 *   paused    Holds the scene where it is; removing it resumes.
 *   camera    "off" keeps the whole window in view throughout.
 *
 * Methods
 *   play()   Starts or resumes the scene (after the visitor took over, starts it afresh).
 *   pause()  Holds the scene.
 *   reset()  Back to the first frame.
 *
 * Properties
 *   anchors  { window, titlebar, runButton, editorTabs, resultsHeader, sidebar, statusBar }: live
 *            elements, most inside the shadow root, for getBoundingClientRect. Complete once
 *            `ready` resolves; never replaced afterwards, so a reference stays good. In the
 *            notebook, resultsHeader is the "Run all" bar.
 *   ready    Resolves once markup, styles, data and fonts are in.
 *   aspect   The scene's native width / height, window chrome included (hero and join 1.6,
 *            notebook 1280 / 920).
 *
 * Events (CustomEvent, bubbles, composed)
 *   scene:typed  The editor scenes' typing is done. detail: { scene, file }
 *   scene:ran    Results are on screen. detail: { scene, file, rowCount, durationMs }
 *   scene:done   The end of the loop's main beat, just after scene:ran.
 *   scene:loop   The scene starts over.
 *
 * Renders at its native size and scales to the container's width. In a narrow container, or for
 * join and notebook at any width, a camera eases in on the caret or the running cell and back out
 * for the results. Clicking, or a key press inside, hands the window to the visitor: the scene
 * stops and the controls work. Under prefers-reduced-motion it shows the last frame, no camera.
 */

const ASSETS = new URL("../", import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const SCENES = {
  hero: { camera: "narrow" },
  join: { camera: "always" },
  notebook: { camera: "always" },
};
const TITLEBAR = 40;
const ROW_HEIGHT = 28;
const NARROW = 700;

// The app's motion constants (packages/ui/src/lib/motion.ts and the components that use them).
const FADE = { duration: 220, easing: "cubic-bezier(0.4, 0, 0.2, 1)" };
const ROW_FADE = { duration: 220, easing: "cubic-bezier(0.25, 0.1, 0.35, 1)", stagger: 12, cap: 12 };
const COLLAPSE = { height: [320, "cubic-bezier(0.23, 1, 0.32, 1)"], opacity: [160, "ease-out"] };
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
const SPRING = springEasing(320, 30);
// The camera is the site's, not the app's: slow, symmetric, no overshoot.
const CAMERA = { duration: 1000, easing: "cubic-bezier(0.65, 0, 0.35, 1)" };

const AUTOSAVE_MS = 1200;
const RUNNING_MS = 650;
const HOLD_MS = 8500;

const KEYWORDS = new Set(
  ("select from where join left right inner outer full cross on using as group by order having " +
    "limit offset desc asc distinct and or not in is like ilike between case when then else end " +
    "union all with insert into values update set delete returning exists filter over partition")
    .split(" "),
);
const FUNCTIONS = new Set("count sum min max avg coalesce greatest least lower upper round now extract".split(" "));
const LITERALS = new Set(["null", "true", "false"]);
const TOKEN = /--.*$|'(?:[^']|'')*'?|\d+(?:\.\d+)?|[A-Za-z_][\w$]*|<>|<=|>=|!=|\|\||\s+|./g;

/** SQL as the app's editor marks it up: the same spans and classes CodeMirror produces there. */
export function highlightSql(line) {
  let html = "";
  let previous = "";
  for (const [token] of line.matchAll(TOKEN)) {
    const word = token.toLowerCase();
    let cls = "";
    if (token.startsWith("--")) cls = "text-muted-foreground italic";
    else if (token.startsWith("'")) cls = "text-success-foreground";
    else if (/^\d/.test(token) || LITERALS.has(word)) cls = "text-warning-foreground";
    else if (/^[A-Za-z_]/.test(token)) {
      if (previous !== "." && (KEYWORDS.has(word) || FUNCTIONS.has(word))) cls = "text-info-foreground";
    } else if (/^[,()=<>!+*/|-]/.test(token)) cls = "text-muted-foreground";
    html += cls ? `<span class="${cls}">${escape(token)}</span>` : escape(token);
    if (!/^\s+$/.test(token)) previous = token;
  }
  return html;
}

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** `grid-template-columns` exactly as packages/ui/src/workspace/results-grid/grid-sizing.ts builds it. */
function columnTemplate(columns, rows) {
  const sampled = Math.min(rows.length, 200);
  return columns
    .map((column, index) => {
      let widest = column.name.length + column.type.length + 1;
      for (let row = 0; row < sampled; row++) {
        const value = rows[row][index];
        widest = Math.max(widest, (value === null ? "null" : String(value)).length);
      }
      const ch = Math.min(48, Math.max(6, widest + 2));
      return `minmax(${ch}ch, ${ch}fr)`;
    })
    .join(" ");
}

/** The workspace spring (stiffness 320, damping 30) as a CSS `linear()` easing and its duration. */
function springEasing(stiffness, damping) {
  const dt = 1 / 600;
  const points = [];
  let x = 0;
  let v = 0;
  let t = 0;
  while (t < 2) {
    v += (-stiffness * (x - 1) - damping * v) * dt;
    x += v * dt;
    t += dt;
    points.push(x);
    if (Math.abs(x - 1) < 0.0005 && Math.abs(v) < 0.02) break;
  }
  const n = 40;
  const samples = Array.from({ length: n + 1 }, (_, i) => points[Math.round((i / n) * (points.length - 1))]);
  samples[0] = 0;
  samples[n] = 1;
  const easing = `linear(${samples.map((s) => +s.toFixed(4)).join(", ")})`;
  const supported = globalThis.CSS?.supports?.("animation-timing-function", "linear(0, 1)");
  return { duration: Math.round(t * 1000), easing: supported ? easing : EASE_OUT };
}

const plural = (count, noun) => `${count.toLocaleString("en-US")} ${noun}${count === 1 ? "" : "s"}`;

const parse = (html) => {
  const t = document.createElement("template");
  t.innerHTML = html;
  return t.content;
};

// @font-face does not apply from inside a shadow root, so the faces are registered on the document,
// once, under the family names the app's stylesheet asks for.
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

const loaded = new Map();
function loadScene(name) {
  if (!loaded.has(name)) {
    const get = (path, as) => fetch(asset(path)).then((r) => (r.ok ? r[as]() : Promise.reject(new Error(`${path}: ${r.status}`))));
    loaded.set(
      name,
      Promise.all([get(`markup/${name}.html`, "text"), get(`markup/${name}.json`, "json")]).then(async ([markup, scene]) => {
        const queries = Object.fromEntries(
          await Promise.all(scene.files.map(async (file) => [file, await get(`data/${file}.json`, "json")])),
        );
        return { markup, scene, queries };
      }),
    );
  }
  return loaded.get(name);
}

const FRAME_CSS = `
:host { display: block; position: relative; }
:host([hidden]) { display: none; }
.pw-stage { position: relative; width: 100%; height: calc(var(--pw-scale, 0) * var(--pw-h, 800px)); visibility: hidden; }
.pw-stage[data-ready] { visibility: visible; }
.pw-window {
  position: absolute; top: 0; left: 0; width: var(--pw-w, 1280px); height: var(--pw-h, 800px);
  transform: scale(var(--pw-scale, 0)); transform-origin: 0 0;
  border-radius: 10px; overflow: hidden; isolation: isolate;
  background: var(--background); box-shadow: var(--bui-shadow-overlay);
}
.pw-titlebar {
  position: relative; z-index: 1; height: ${TITLEBAR}px; display: flex; align-items: center; justify-content: center;
  background: var(--sidebar); border-bottom: 1px solid var(--border); box-sizing: border-box;
}
.pw-lights { position: absolute; left: 14px; top: 0; bottom: 0; display: flex; align-items: center; gap: 8px; }
.pw-lights span { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2); }
.pw-lights span:nth-child(1) { background: #ff5f57; }
.pw-lights span:nth-child(2) { background: #febc2e; }
.pw-lights span:nth-child(3) { background: #28c840; }
.pw-address {
  height: 24px; padding: 0 14px; border-radius: 6px; display: flex; align-items: center;
  background: var(--secondary); color: var(--muted-foreground);
  font: 400 12px/1 var(--font-sans); font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
}
.pw-app { position: absolute; top: ${TITLEBAR}px; left: 0; width: var(--pw-w, 1280px); height: calc(var(--pw-h, 800px) - ${TITLEBAR}px); contain: layout; overflow: hidden; }
.pw-app > div { transform-origin: 0 0; }
.pw-app * { scrollbar-width: none; }
.pw-app *::-webkit-scrollbar { display: none; }
.pw-app .cm-content { cursor: default; }
`;

class PerchWorkspace extends HTMLElement {
  static observedAttributes = ["paused", "autoplay", "scene", "camera"];

  #root;
  #app;
  #stage;
  #name;
  #def;
  #data;
  #size = [1280, 760];
  #tpl = {};
  #ready;
  #visible = false;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)");
  #observer;
  #resize;
  #token = null;
  #clock = { running: false, timers: new Set(), held: [] };
  #playRequested = false;
  #final = false;
  #takenOver = false;
  #started = false;
  #ran = false;
  #running = false;
  #tab = 0;
  #cursors = {};
  #saveGeneration = 0;
  #camera = { s: 1, cx: 0, cy: 0 };
  #cameraAnimation = null;

  #settle;
  #built = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#ready = new Promise((resolve) => (this.#settle = resolve));
  }

  get ready() {
    return this.#ready;
  }

  get aspect() {
    return this.#size[0] / (this.#size[1] + TITLEBAR);
  }

  get anchors() {
    const q = (s) => this.#root.querySelector(s);
    return {
      window: q(".pw-window"),
      titlebar: q(".pw-titlebar"),
      runButton: this.#app?.firstElementChild ? this.#runButton() : null,
      editorTabs: q("main .h-9"),
      resultsHeader: this.#name === "notebook" ? this.#tpl.runAllBar ?? null : q("#group-results section > div"),
      sidebar: q("aside"),
      statusBar: q("footer"),
    };
  }

  connectedCallback() {
    // The scene is read on first connection, so an element made with createElement can be given
    // its scene attribute before it is added.
    if (!this.#built) {
      this.#built = true;
      // `ready` always settles: a scene that fails to build is reported, not thrown at the page.
      this.#build()
        .catch((error) => console.error("<perch-workspace> could not build its scene:", error))
        .then(() => this.#settle());
    }
    this.#resize ??= new ResizeObserver(() => this.#fit());
    this.#resize.observe(this);
    this.#fit();
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

  attributeChangedCallback(name, before, after) {
    if (name === "scene" && this.#stage && before !== after && SCENES[after] && after !== this.#name) {
      console.warn("<perch-workspace>: the scene is read when the element connects; set it before then.");
    }
    this.#sync();
  }

  play() {
    this.#playRequested = true;
    if (this.#takenOver) {
      this.#takenOver = false;
      this.reset();
    }
    this.removeAttribute("paused");
    this.#sync();
  }

  pause() {
    this.setAttribute("paused", "");
  }

  reset() {
    this.#stop();
    this.#ready.then(() => {
      this.#restore();
      this.#sync();
    });
  }

  #onMotionPreference = () => {
    this.#stop();
    this.#ready.then(() => {
      this.#restore();
      this.#sync();
    });
  };

  async #build() {
    this.#name = SCENES[this.getAttribute("scene")] ? this.getAttribute("scene") : "hero";
    this.#def = SCENES[this.#name];
    registerFonts();
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = asset("css/app.css");
    const linked = new Promise((resolve) => {
      link.onload = resolve;
      link.onerror = resolve;
    });
    const frame = document.createElement("style");
    frame.textContent = FRAME_CSS;
    this.#stage = document.createElement("div");
    this.#stage.className = "pw-stage";
    this.#stage.innerHTML = `
      <div class="pw-window dark antialiased" role="group" aria-label="Perch, a SQL workspace, open in a browser">
        <div class="pw-titlebar">
          <div class="pw-lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="pw-address">127.0.0.1:4600</div>
        </div>
        <div class="pw-app bg-background text-foreground font-sans"></div>
      </div>`;
    this.#root.append(link, frame, this.#stage);
    this.#app = this.#stage.querySelector(".pw-app");

    this.#data = await loadScene(this.#name);
    this.#size = this.#data.scene.size;
    this.style.setProperty("--pw-w", `${this.#size[0]}px`);
    this.style.setProperty("--pw-h", `${this.#size[1] + TITLEBAR}px`);
    this.#fit();
    this.#app.innerHTML = this.#data.markup;
    this.#prepare();
    await Promise.all([
      linked,
      document.fonts.load('400 13px "Geist Mono Variable"'),
      document.fonts.load('400 13px "Geist Variable"'),
      document.fonts.load('500 13px "Geist Variable"'),
    ]).catch(() => {});
    this.#stage.dataset.ready = "";
    this.#restore();
    this.#sync();
  }

  #fit() {
    const width = this.getBoundingClientRect().width || this.clientWidth;
    if (width) this.style.setProperty("--pw-scale", String(width / this.#size[0]));
  }

  // One-time adjustments to the captured markup, and the templates scenes draw from.
  #prepare() {
    const app = this.#app;
    const { scene, queries } = this.#data;
    const states = scene.states;
    app.querySelectorAll("#DndDescribedBy-0, #DndLiveRegion-0").forEach((el) => el.remove());
    app.querySelectorAll("[href]").forEach((el) => el.removeAttribute("href"));
    const header = (state) => parse(states[state].header);

    this.#tpl.saved = this.#saveLabel()?.cloneNode(true);
    this.#tpl.unsaved = states.dirty?.header && this.#saveLabel(header("dirty"))?.cloneNode(true);
    for (const label of [this.#tpl.saved, this.#tpl.unsaved]) label?.removeAttribute("style");
    this.#tpl.runIdle = this.#runButton().cloneNode(true);
    this.#tpl.runBusy = this.#runButton(header("running")).cloneNode(true);
    this.#tpl.dot = states.dirty?.tabs && parse(states.dirty.tabs).querySelector('[aria-label="Unsaved changes"]');
    const finished = states.results ?? states.done;
    this.#tpl.footerMs = [...parse(finished.footer).querySelector("footer").children].find((s) => / ms$/.test(s.textContent));
    this.#tpl.tree = states.tree && parse(states.tree.sidebar);
    this.#tpl.tabs = [...app.querySelector("main .h-9").querySelectorAll(".group\\/tab")];
    this.#tpl.tabClass = {
      on: this.#tpl.tabs[0].className,
      off: this.#tpl.tabs.find((t) => !t.querySelector("[aria-current]"))?.className,
      buttonOn: this.#tpl.tabs[0].firstElementChild.className,
      buttonOff: this.#tpl.tabs.find((t) => !t.querySelector("[aria-current]"))?.firstElementChild.className,
    };

    if (this.#name === "notebook") {
      this.#tpl.cards = [...app.querySelectorAll("main article")];
      this.#tpl.cardHtml = {
        idle: scene.cards.idle.map((html) => parse(html).firstElementChild.innerHTML),
        done: scene.cards.done.map((html) => parse(html).firstElementChild.innerHTML),
      };
      this.#tpl.runAllBar = app.querySelector("main .flex.h-10.shrink-0");
      this.#tpl.runAll = { idle: this.#tpl.runAllBar.innerHTML, busy: parse(states.running.runAll).firstElementChild.innerHTML };
    } else {
      const section = (state) => parse(states[state].results).querySelector("section");
      this.#tpl.empty = {
        head: app.querySelector("#group-results section > div").cloneNode(true),
        body: app.querySelector("#group-results section > div:last-child > div").cloneNode(true),
      };
      const running = section("running");
      this.#tpl.running = { head: running.firstElementChild, body: running.lastElementChild.firstElementChild };
      const done = section("results");
      this.#tpl.done = { head: done.firstElementChild, body: done.lastElementChild.firstElementChild };
      // The editors in tab order, matched by their first line, which is each query's comment.
      const panes = [...app.querySelectorAll("main .relative.min-h-0.flex-1 > .absolute.inset-0")];
      this.#tpl.panes = scene.files.map((file) => {
        const first = queries[file].sql.split("\n")[0];
        return panes.find((p) => p.querySelector(".cm-line")?.textContent === first);
      });
      this.#tpl.lines = [...this.#tpl.panes[0].querySelectorAll(".cm-line")].map((line) => line.innerHTML);
      const cursor = this.#tpl.panes[0].querySelector(".cm-cursor");
      this.#tpl.caret = `${cursor.style.left} ${cursor.style.top}`;
    }

    // Only the controls the rebuild drives stay in the tab order.
    const live = new Set([
      this.#runButton(),
      ...(this.#tpl.tabs.length > 1 ? this.#tpl.tabs.map((t) => t.firstElementChild) : []),
      ...(this.#tpl.tree ? app.querySelectorAll("aside button[aria-expanded]") : []),
      ...(this.#tpl.runAllBar ? this.#tpl.runAllBar.querySelectorAll("button") : []),
      ...app.querySelectorAll('main article button[aria-label^="Run cell"]'),
    ]);
    app.querySelectorAll("button, [tabindex], a").forEach((el) => {
      if (!live.has(el)) el.setAttribute("tabindex", "-1");
    });
    app.querySelectorAll('[contenteditable="true"]').forEach((el) => el.setAttribute("contenteditable", "false"));

    app.addEventListener("pointerdown", this.#onPointer);
    app.addEventListener("click", this.#onClick);
    app.addEventListener("keydown", this.#onKey);
  }

  #saveLabel(scope = this.#app) {
    const button = [...scope.querySelectorAll("header button")].find((b) => /Saved|Unsaved/.test(b.textContent));
    return button?.firstElementChild;
  }

  #runButton(scope = this.#app) {
    return [...scope.querySelectorAll('header button[data-slot="button"]')].find((b) => /Run|Cancel/.test(b.textContent));
  }

  #editor() {
    return this.#tpl.panes[0];
  }

  #sync() {
    if (!this.#stage?.hasAttribute("data-ready")) return;
    if (this.#reduced.matches) {
      this.#stop();
      if (!this.#takenOver && !this.#final) this.#renderFinal();
      return;
    }
    const want =
      !this.#takenOver &&
      (this.getAttribute("autoplay") !== "false" || this.#playRequested) &&
      !this.hasAttribute("paused") &&
      this.#visible;
    if (want) this.#resume();
    else this.#hold();
  }

  // The scene's clock only advances while it plays, so pausing mid-keystroke resumes there.
  #sleep(ms, token = this.#token) {
    return new Promise((resolve, reject) => {
      const timer = { remaining: ms, resolve, reject, token, id: 0, start: 0 };
      this.#clock.timers.add(timer);
      if (this.#clock.running) this.#arm(timer);
    });
  }

  #arm(timer) {
    timer.start = performance.now();
    timer.id = setTimeout(() => {
      this.#clock.timers.delete(timer);
      if (timer.token?.cancelled) timer.reject(timer.token);
      else timer.resolve();
    }, timer.remaining);
  }

  #resume() {
    if (!this.#started) {
      this.#started = true;
      this.#token = { cancelled: false };
      this.#clock.running = true;
      const scene = this.#name === "notebook" ? this.#notebookScene() : this.#editorScene();
      scene.catch((err) => {
        if (!err?.cancelled) throw err;
      });
      return;
    }
    if (this.#clock.running) return;
    this.#clock.running = true;
    for (const timer of this.#clock.timers) this.#arm(timer);
    for (const animation of this.#clock.held) animation.play();
    this.#clock.held = [];
  }

  #hold() {
    if (!this.#clock.running) return;
    this.#clock.running = false;
    const now = performance.now();
    for (const timer of this.#clock.timers) {
      clearTimeout(timer.id);
      timer.remaining = Math.max(0, timer.remaining - (now - timer.start));
    }
    this.#clock.held = this.#root.getAnimations().filter((a) => a.playState === "running");
    for (const animation of this.#clock.held) animation.pause();
  }

  #stop() {
    if (this.#token) this.#token.cancelled = true;
    for (const timer of this.#clock.timers) {
      clearTimeout(timer.id);
      timer.reject(timer.token ?? { cancelled: true });
    }
    this.#clock.timers.clear();
    this.#clock.running = false;
    this.#started = false;
    this.#token = null;
    for (const animation of this.#clock.held) animation.play();
    this.#clock.held = [];
    for (const animation of this.#root.getAnimations()) {
      if (animation instanceof CSSAnimation || animation instanceof CSSTransition) continue;
      animation.finish();
    }
  }

  #emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true, detail: { scene: this.#name, ...detail } }));
  }

  #ranDetail() {
    const query = this.#data.queries[this.#data.scene.file];
    if (query.cells) return { file: this.#data.scene.file, rowCount: query.cells.reduce((n, c) => n + c.rowCount, 0), cells: query.cells.length };
    return { file: this.#data.scene.file, rowCount: query.rowCount, durationMs: query.durationMs };
  }

  // The editor scenes: every keystroke replayed with the state it produced in the real app.
  async #editorScene() {
    this.#restore();
    const { steps } = this.#data.scene;
    for (;;) {
      await this.#sleep(1000);
      if (this.#cameraOn()) {
        this.#cameraTo(this.#focusOn(steps[0]));
        await this.#sleep(CAMERA.duration);
      }
      for (const step of steps) {
        this.#applyStep(step);
        if (this.#cameraOn()) this.#follow(step);
        if (step.pause) await this.#sleep(step.pause);
      }
      this.#emit("scene:typed", { file: this.#data.scene.file });
      await this.#sleep(900);
      await this.#run(this.#data.scene.file, (ms) => this.#sleep(ms), () => this.#cameraOn() && this.#cameraTo(null, 1100));
      this.#ran = true;
      this.#emit("scene:ran", this.#ranDetail());
      this.#emit("scene:done", this.#ranDetail());
      await this.#sleep(HOLD_MS);
      this.#emit("scene:loop", {});
      await this.#fadeToIdle();
      await this.#sleep(600);
    }
  }

  async #notebookScene() {
    this.#restore();
    const cards = this.#tpl.cards;
    for (;;) {
      await this.#sleep(1200);
      this.#setRunAll(true);
      for (const [i, card] of cards.entries()) {
        // Narrow, a whole card is too small to read: the camera holds its code, then crosses to
        // the badge and the numbers once the result is in.
        const narrow = this.#cameraOn() && this.getBoundingClientRect().width < NARROW;
        if (this.#cameraOn()) {
          this.#cameraTo(this.#focusOnCard(card, narrow ? "left" : "all"));
          await this.#sleep(i === 0 ? CAMERA.duration : 750);
        }
        await this.#sleep(i === 0 ? 300 : 250);
        this.#showCell(i, true);
        await this.#sleep(this.#cameraOn() ? 900 : 450);
        if (narrow) {
          this.#cameraTo(this.#focusOnCard(card, "right"), 900);
          await this.#sleep(1500);
        }
      }
      this.#setRunAll(false);
      this.#setFooter({ ms: this.#data.queries[this.#data.scene.file].cells.at(-1).runMs });
      if (this.#cameraOn()) this.#cameraTo(null, 1100);
      this.#ran = true;
      this.#emit("scene:ran", this.#ranDetail());
      this.#emit("scene:done", this.#ranDetail());
      await this.#sleep(HOLD_MS);
      this.#emit("scene:loop", {});
      await this.#notebookToIdle();
      await this.#sleep(600);
    }
  }

  // Back to the first frame, in place: every anchor element survives.
  #restore() {
    this.#ran = false;
    this.#running = false;
    this.#final = false;
    this.#cursors = {};
    this.#cameraTo(null, 0);
    this.#setRunButton(false, false);
    this.#setSaved(true, false);
    this.#setFooter({ ms: null });
    this.#collapseTree();
    if (this.#name === "notebook") {
      this.#tpl.cards.forEach((_, i) => this.#showCell(i, false, "idle"));
      this.#setRunAll(false, false);
    } else {
      this.#setTab(0, false);
      this.#restoreEditor();
      this.#showResults("empty");
    }
    if (this.#reduced.matches && !this.#takenOver) this.#renderFinal();
  }

  #restoreEditor() {
    const lines = this.#editor().querySelectorAll(".cm-line");
    this.#tpl.lines.forEach((html, i) => (lines[i].innerHTML = html));
    const { caret } = this.#data.scene;
    this.#placeCaret(caret.line, caret.col, this.#tpl.caret);
    this.#setPopup(null);
  }

  #renderFinal() {
    this.#final = true;
    this.#cameraTo(null, 0);
    if (this.#name === "notebook") {
      this.#tpl.cards.forEach((_, i) => this.#showCell(i, false));
      this.#setFooter({ ms: this.#data.queries[this.#data.scene.file].cells.at(-1).runMs });
    } else {
      this.#setTab(0, false);
      this.#applyStep(this.#data.scene.steps.at(-1), false);
      this.#setPopup(null);
      this.#setSaved(true, false);
      this.#showResults("done", this.#data.scene.file, { animate: false });
      this.#setFooter({ ms: this.#data.queries[this.#data.scene.file].runMs });
    }
    this.#ran = true;
  }

  #applyStep(step, live = true) {
    const lines = this.#editor().querySelectorAll(".cm-line");
    const text = step.doc.split("\n");
    let changed = false;
    text.forEach((line, i) => {
      if (!lines[i] || lines[i].textContent === line) return;
      lines[i].innerHTML = line ? highlightSql(line) : "<br>";
      changed = true;
    });
    this.#placeCaret(step.line, step.col, step.cursor);
    this.#setPopup(step.tooltip);
    if (changed && live) {
      // Autosave, as the app does it: a beat after the last edit.
      this.#setSaved(false);
      const generation = ++this.#saveGeneration;
      this.#sleep(AUTOSAVE_MS)
        .then(() => generation === this.#saveGeneration && this.#setSaved(true))
        .catch(() => {});
    }
  }

  #placeCaret(line, col, cursor) {
    const editor = this.#editor();
    editor.querySelectorAll(".cm-activeLine").forEach((el) => el.classList.remove("cm-activeLine"));
    editor.querySelectorAll(".cm-activeLineGutter").forEach((el) => el.classList.remove("cm-activeLineGutter"));
    editor.querySelectorAll(".cm-line")[line - 1]?.classList.add("cm-activeLine");
    // The first gutter element is CodeMirror's hidden width probe; line n is the one after it.
    editor.querySelectorAll(".cm-lineNumbers .cm-gutterElement")[line]?.classList.add("cm-activeLineGutter");
    const layer = editor.querySelector(".cm-cursorLayer");
    const [left, top] = cursor.split(" ");
    Object.assign(layer.querySelector(".cm-cursor").style, { left, top });
    // CodeMirror restarts the blink on every change by flipping between two identical keyframes.
    layer.style.animationName = layer.style.animationName === "cm-blink" ? "cm-blink2" : "cm-blink";
    this.#cursors[0] = { line, col };
    if (this.#tab === 0) this.#setFooter({ line, col: col + 1 });
  }

  #setPopup(html) {
    const editor = this.#editor().querySelector(".cm-editor");
    editor.querySelector(".cm-tooltip-autocomplete")?.remove();
    if (html) editor.append(parse(html).firstElementChild);
  }

  // The loop's way back: the typed text, the summary and the timing fade, the rows crossfade to the
  // empty panel, and the caret is home again.
  async #fadeToIdle() {
    const initial = this.#tpl.lines;
    const lines = [...this.#editor().querySelectorAll(".cm-line")];
    const leaving = [
      ...lines.filter((line, i) => line.innerHTML !== initial[i]),
      this.#app.querySelector("#group-results section > div > p"),
      this.#app.querySelector("footer [data-pw-ms]"),
    ].filter(Boolean);
    const fades = leaving.map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { ...FADE, fill: "forwards" }));
    await this.#sleep(FADE.duration);
    this.#restoreEditor();
    this.#setFooter({ ms: null });
    this.#showResults("empty");
    fades.forEach((fade) => fade.cancel());
    this.#ran = false;
  }

  async #notebookToIdle() {
    // A card is header, editor, then the result; the result and the header's badge leave.
    const results = this.#tpl.cards.flatMap((card) => [...card.children].slice(2));
    const badges = this.#tpl.cards.map((card) => card.firstElementChild.querySelector('[data-slot="badge"]')).filter(Boolean);
    const fades = [...results, ...badges].map((el) => el.animate([{ opacity: 1 }, { opacity: 0 }], { ...FADE, fill: "forwards" }));
    await this.#sleep(FADE.duration);
    this.#tpl.cards.forEach((_, i) => this.#showCell(i, true, "idle"));
    fades.forEach((fade) => fade.cancel());
    this.#setFooter({ ms: null });
    this.#ran = false;
  }

  // The visitor's turn: the scene stops where it is, settled to a consistent frame.
  #takeOver() {
    if (this.#takenOver) return;
    this.#takenOver = true;
    const wasRunning = this.#running;
    this.#stop();
    this.#cameraTo(null, 0);
    if (this.#name === "notebook") {
      if (wasRunning) this.#tpl.cards.forEach((_, i) => this.#showCell(i, false));
      this.#setRunAll(false, false);
    } else {
      this.#applyStep(this.#data.scene.steps.at(-1), false);
      this.#setPopup(null);
      this.#setSaved(true, false);
      if (wasRunning || this.#ran) this.#showResults("done", this.#data.scene.file, { animate: false });
    }
    this.#setRunButton(false, false);
    this.#running = false;
  }

  #pressed = null;

  #onPointer = (event) => {
    this.#pressed = event.target;
    this.#takeOver();
  };

  #onClick = (event) => {
    // Settling the scene on pointerdown can replace the label under the pointer; the press is what
    // was aimed at.
    const target = event.target.isConnected ? event.target : this.#pressed ?? event.target;
    if (this.#runButton().contains(target)) return this.#userRun();
    const runAll = this.#tpl.runAllBar?.querySelector("button");
    if (runAll?.contains(target)) return this.#userRun();
    const cellRun = target.closest('main article button[aria-label^="Run cell"]');
    if (cellRun) return this.#userRunCell(this.#tpl.cards.indexOf(cellRun.closest("article")));
    const tab = this.#tpl.tabs.length > 1 ? this.#tpl.tabs.findIndex((t) => t.firstElementChild.contains(target)) : -1;
    if (tab !== -1) return this.#setTab(tab, true);
    const row = target.closest("aside button[aria-expanded]");
    if (row && this.#tpl.tree) return this.#toggleTable(row);
    const cell = target.closest('[role="gridcell"]');
    if (cell) return this.#selectCell(cell);
  };

  #onKey = (event) => {
    this.#takeOver();
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.#userRun();
      return;
    }
    const cell = event.target.closest?.('[role="gridcell"]');
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (cell && moves[event.key]) {
      event.preventDefault();
      const [r, c] = cell.dataset.cell.split(":").map(Number);
      const [dr, dc] = moves[event.key];
      const next = cell.closest('[role="grid"]').querySelector(`[data-cell="${r + dr}:${c + dc}"]`);
      if (next) this.#selectCell(next);
    }
  };

  async #userRun() {
    this.#takeOver();
    if (this.#running) return;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    if (this.#name === "notebook") {
      this.#running = true;
      this.#setRunAll(true);
      for (const i of this.#tpl.cards.keys()) {
        await wait(250);
        this.#showCell(i, true);
      }
      this.#setRunAll(false);
      this.#setFooter({ ms: this.#data.queries[this.#data.scene.file].cells.at(-1).runMs });
      this.#running = false;
      return;
    }
    await this.#run(this.#data.scene.files[this.#tab], wait);
    if (this.#tab === 0) this.#ran = true;
  }

  async #userRunCell(index) {
    this.#takeOver();
    if (this.#running || index < 0) return;
    this.#running = true;
    this.#setRunButton(true);
    await new Promise((r) => setTimeout(r, 250));
    this.#showCell(index, true);
    this.#setRunButton(false);
    this.#setFooter({ ms: this.#data.queries[this.#data.scene.file].cells[index].runMs });
    this.#running = false;
  }

  async #run(file, wait, landed) {
    this.#running = true;
    this.#setRunButton(true);
    this.#showResults("running");
    this.#setFooter({ ms: null });
    await wait(RUNNING_MS);
    this.#setRunButton(false);
    landed?.();
    this.#showResults("done", file);
    this.#setFooter({ ms: this.#data.queries[file].runMs });
    this.#running = false;
  }

  #setRunAll(busy, animate = true) {
    const bar = this.#tpl.runAllBar;
    if (!bar) return;
    this.#setRunButton(busy, animate);
    this.#running = busy;
    // Unchanged, the button stays the same element, so a click that began on it still lands.
    if (bar.dataset.busy === String(busy)) return;
    bar.dataset.busy = String(busy);
    const holder = bar.lastElementChild;
    const next = parse(busy ? this.#tpl.runAll.busy : this.#tpl.runAll.idle).lastElementChild;
    holder.replaceWith(next);
    next.querySelectorAll("button").forEach((b) => b.removeAttribute("tabindex"));
    if (animate && !this.#reduced.matches) next.animate([{ opacity: 0 }, { opacity: 1 }], FADE);
  }

  // A notebook card in one of its two captured looks. Live, it carries its height across on the
  // workspace spring the way the app's `layout` card does, and its rows land with the cascade.
  #showCell(index, animate, look = "done") {
    const card = this.#tpl.cards[index];
    const html = this.#tpl.cardHtml[look][index];
    if (card.innerHTML === html) return;
    const from = card.offsetHeight;
    card.innerHTML = html;
    card.querySelectorAll("button, [tabindex], a").forEach((el) => {
      if (!/^Run cell/.test(el.getAttribute("aria-label") ?? "")) el.setAttribute("tabindex", "-1");
    });
    card.querySelectorAll("[href]").forEach((el) => el.removeAttribute("href"));
    card.querySelectorAll('[contenteditable="true"]').forEach((el) => el.setAttribute("contenteditable", "false"));
    if (!animate || this.#reduced.matches) return;
    const to = card.offsetHeight;
    card.animate([{ height: `${from}px` }, { height: `${to}px` }], { ...SPRING });
    card.style.overflow = "hidden";
    setTimeout(() => (card.style.overflow = ""), SPRING.duration);
    const badge = card.firstElementChild.querySelector('[data-slot="badge"]');
    badge?.animate([{ opacity: 0 }, { opacity: 1 }], FADE);
    card.querySelectorAll('[role="rowgroup"] > div > [role="row"]').forEach((row, r) => {
      row.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: ROW_FADE.duration,
        easing: ROW_FADE.easing,
        delay: Math.min(r, ROW_FADE.cap) * ROW_FADE.stagger,
        fill: "backwards",
      });
    });
  }

  #setSaved(saved, animate = true) {
    const current = this.#saveLabel();
    if (!current || !this.#tpl.unsaved) return;
    const next = (saved ? this.#tpl.saved : this.#tpl.unsaved).cloneNode(true);
    const heroTab = this.#tpl.tabs[0].firstElementChild;
    heroTab.querySelector('[aria-label="Unsaved changes"]')?.remove();
    if (!saved && this.#tpl.dot) heroTab.append(this.#tpl.dot.cloneNode(true));
    this.#setFooter({ saved });
    if (current.textContent === next.textContent) return;
    if (!animate || this.#reduced.matches) {
      current.replaceWith(next);
      return;
    }
    // AnimatePresence mode="wait": the old label leaves upward, then the new one rises in.
    const exit = current.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-3px)" }], FADE);
    exit.finished.then(() => {
      if (!current.isConnected) return;
      current.replaceWith(next);
      next.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], FADE);
    }, () => {});
  }

  #setRunButton(busy, animate = true) {
    const button = this.#runButton();
    const template = busy ? this.#tpl.runBusy : this.#tpl.runIdle;
    const label = button.firstElementChild;
    const next = template.firstElementChild.cloneNode(true);
    next.removeAttribute("style");
    if (button.className === template.className && label.textContent === next.textContent && button.children.length === 1) return;
    if (!animate || this.#reduced.matches) {
      button.className = template.className;
      button.replaceChildren(next);
      return;
    }
    // popLayout: the outgoing label leaves the flow and fades where it was, the new one fades in,
    // and the button carries its width across on the workspace spring.
    const from = button.offsetWidth;
    const box = button.getBoundingClientRect();
    const scale = box.width / from || 1;
    const left = (label.getBoundingClientRect().left - box.left) / scale - button.clientLeft;
    button.className = template.className;
    label.style.position = "absolute";
    label.style.left = `${left}px`;
    button.append(next);
    const to = button.offsetWidth;
    label.animate([{ opacity: 1 }, { opacity: 0 }], FADE).finished.then(() => label.remove(), () => label.remove());
    next.animate([{ opacity: 0 }, { opacity: 1 }], FADE);
    button.animate([{ width: `${from}px` }, { width: `${to}px` }], SPRING);
  }

  #showResults(phase, file, { animate = true } = {}) {
    const section = this.#app.querySelector("#group-results section");
    const head = section.firstElementChild;
    const wrap = section.lastElementChild;
    const old = wrap.lastElementChild;
    const template = this.#tpl[phase];
    head.innerHTML = template.head.innerHTML;
    head.querySelectorAll("button, a, [tabindex]").forEach((el) => el.setAttribute("tabindex", "-1"));
    head.querySelectorAll("[href]").forEach((el) => el.removeAttribute("href"));
    const next = template.body.cloneNode(true);
    next.removeAttribute("style");
    if (phase === "done") {
      const data = this.#data.queries[file];
      head.querySelector("p").textContent = `${plural(data.rowCount, "row")} · ${data.durationMs}ms`;
      this.#fillGrid(next, data);
    }
    // A new run crossfades in; the same run going from skeleton to rows swaps in place.
    const crossfade = animate && phase !== "done" && !this.#reduced.matches && old;
    if (crossfade) {
      old.style.position = "absolute";
      old.style.inset = "0";
      wrap.append(next);
      old.animate([{ opacity: 1 }, { opacity: 0 }], FADE).finished.then(() => old.remove(), () => old.remove());
      next.animate([{ opacity: 0 }, { opacity: 1 }], FADE);
    } else {
      wrap.replaceChildren(next);
    }
    // The cascade a result lands with, as the grid's own rows do it (results-grid/grid-row.tsx).
    if (phase === "done" && animate && !this.#reduced.matches) {
      next.querySelectorAll('[role="rowgroup"] > div > [role="row"]').forEach((row, r) => {
        row.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: ROW_FADE.duration,
          easing: ROW_FADE.easing,
          delay: Math.min(r, ROW_FADE.cap) * ROW_FADE.stagger,
          fill: "backwards",
        });
      });
    }
  }

  #fillGrid(body, data) {
    const grid = body.querySelector('[role="grid"]');
    const { columns, rows } = data;
    grid.style.setProperty("--perch-grid-cols", columnTemplate(columns, rows));
    grid.setAttribute("aria-colcount", columns.length);
    grid.setAttribute("aria-rowcount", rows.length + 1);
    grid.setAttribute("tabindex", "0");

    const headRow = grid.querySelector('[role="columnheader"]').parentElement;
    const heads = [...headRow.children];
    const leftHead = heads.find((c) => !c.className.includes("justify-end")) ?? heads[0];
    const rightHead = heads.find((c) => c.className.includes("justify-end"));
    headRow.replaceChildren(
      ...columns.map((column, i) => {
        const cell = (column.align === "right" ? rightHead ?? leftHead : leftHead).cloneNode(true);
        cell.setAttribute("aria-colindex", i + 1);
        cell.children[0].textContent = column.name;
        cell.children[1].textContent = column.type;
        if (column.align === "right") cell.classList.add("justify-end");
        else cell.classList.remove("justify-end");
        return cell;
      }),
    );

    const group = grid.querySelectorAll('[role="rowgroup"]')[1];
    group.style.setProperty("--perch-grid-height", `${rows.length * ROW_HEIGHT}px`);
    const windowEl = group.firstElementChild;
    windowEl.style.setProperty("--perch-grid-offset", "0px");
    const [even, odd] = windowEl.children;
    const cellOf = (row, align) =>
      [...row.children].find((c) => c.className.includes("justify-end") === (align === "right")) ?? row.children[0];
    const nullSpan = '<span class="text-muted-foreground italic">null</span>';
    const built = rows.map((values, r) => {
      const row = (r % 2 ? odd ?? even : even).cloneNode(false);
      row.removeAttribute("style");
      row.setAttribute("aria-rowindex", r + 2);
      if (!odd && r % 2) row.classList.add("bg-muted/40");
      row.append(
        ...columns.map((column, c) => {
          const source = cellOf(r === 0 || !odd ? even : odd, column.align);
          const cell = source.cloneNode(false);
          if (column.align === "right") cell.classList.add("justify-end", "tabular-nums");
          else cell.classList.remove("justify-end", "tabular-nums");
          cell.setAttribute("aria-colindex", c + 1);
          cell.setAttribute("aria-selected", "false");
          cell.dataset.cell = `${r}:${c}`;
          const value = values[c];
          cell.innerHTML = value === null ? nullSpan : `<span class="truncate">${escape(String(value))}</span>`;
          return cell;
        }),
      );
      return row;
    });
    windowEl.replaceChildren(...built);
  }

  #selectCell(cell) {
    const grid = cell.closest('[role="grid"]');
    const ring = ["inset-ring-1", "inset-ring-ring"];
    grid.querySelectorAll('[role="gridcell"][aria-selected="true"]').forEach((c) => {
      c.setAttribute("aria-selected", "false");
      c.setAttribute("tabindex", "-1");
      c.classList.remove(...ring);
    });
    cell.setAttribute("aria-selected", "true");
    cell.setAttribute("tabindex", "0");
    cell.classList.add(...ring);
    grid.setAttribute("tabindex", "-1");
    cell.focus({ preventScroll: false });
  }

  #setTab(index, animate) {
    const { tabs, panes, tabClass } = this.#tpl;
    if (!panes || tabs.length < 2) return;
    const previous = this.#tab;
    this.#tab = index;
    const underline = tabs[previous].querySelector(".absolute.inset-x-0.bottom-0") ??
      this.#app.querySelector("main .h-9 .absolute.inset-x-0.bottom-0");
    const fromRect = underline.getBoundingClientRect();
    tabs.forEach((tab, i) => {
      const on = i === index;
      tab.className = on ? tabClass.on : tabClass.off;
      tab.firstElementChild.className = on ? tabClass.buttonOn : tabClass.buttonOff;
      if (on) tab.firstElementChild.setAttribute("aria-current", "true");
      else tab.firstElementChild.removeAttribute("aria-current");
      panes[i].classList.toggle("invisible", !on);
      panes[i].setAttribute("aria-hidden", String(!on));
    });
    tabs[index].append(underline);
    if (animate && previous !== index && !this.#reduced.matches) {
      // layoutId: the one underline slides from the old tab to the new on the spring.
      const toRect = underline.getBoundingClientRect();
      const dx = (fromRect.left - toRect.left) / (toRect.width / underline.offsetWidth || 1);
      const sx = fromRect.width / toRect.width;
      underline.style.transformOrigin = "0 0";
      underline.animate([{ transform: `translateX(${dx}px) scaleX(${sx})` }, { transform: "none" }], SPRING);
    }
    const caret = this.#cursors[0];
    this.#setFooter(index === 0 && caret ? { line: caret.line, col: caret.col + 1 } : { line: 1, col: 1 });
  }

  #setFooter({ line, col, saved, ms } = {}) {
    const footer = this.#app.querySelector("footer");
    const spans = [...footer.children];
    if (line !== undefined && col !== undefined) spans[1].textContent = `Ln ${line}, Col ${col}`;
    if (saved !== undefined) spans[2].textContent = saved ? "Saved" : "Unsaved changes";
    if (ms !== undefined) {
      footer.querySelector("[data-pw-ms]")?.remove();
      if (ms !== null) {
        const span = this.#tpl.footerMs.cloneNode(true);
        span.dataset.pwMs = "";
        span.textContent = `${ms} ms`;
        spans[2].after(span);
      }
    }
  }

  #collapseTree() {
    if (!this.#tpl.tree) return;
    this.#app.querySelectorAll('aside button[aria-expanded="true"]').forEach((button) => {
      const chevron = button.querySelector(":scope > span > span");
      if (!chevron) return;
      if (button.nextElementSibling?.matches(".overflow-hidden")) button.nextElementSibling.remove();
      button.setAttribute("aria-expanded", "false");
      chevron.style.transform = "none";
    });
    this.#app.querySelectorAll("aside button[aria-expanded].bg-sidebar-accent").forEach((b) => b.classList.remove("bg-sidebar-accent"));
  }

  #toggleTable(button) {
    const name = button.querySelector('span[class="truncate"]')?.textContent;
    const chevron = button.querySelector(":scope > span > span");
    if (!name || !chevron) return;
    const open = button.getAttribute("aria-expanded") === "true";
    const instant = this.#reduced.matches;
    this.#app.querySelectorAll("aside button[aria-expanded].bg-sidebar-accent").forEach((b) => b.classList.remove("bg-sidebar-accent"));
    button.classList.add("bg-sidebar-accent");
    button.setAttribute("aria-expanded", String(!open));
    const angle = open ? "none" : "rotate(90deg)";
    if (!instant) chevron.animate([{ transform: chevron.style.transform || "none" }, { transform: angle }], FADE);
    chevron.style.transform = angle;

    if (open) {
      const panel = button.nextElementSibling;
      if (!panel?.matches(".overflow-hidden")) return;
      if (instant) return panel.remove();
      panel.animate([{ height: `${panel.offsetHeight}px` }, { height: "0px" }], { duration: COLLAPSE.height[0], easing: COLLAPSE.height[1] });
      panel
        .animate([{ opacity: 1 }, { opacity: 0 }], { duration: COLLAPSE.opacity[0], easing: COLLAPSE.opacity[1], fill: "forwards" })
        .finished.then(() => setTimeout(() => panel.remove(), COLLAPSE.height[0] - COLLAPSE.opacity[0]));
      return;
    }
    const source = [...this.#tpl.tree.querySelectorAll("button[aria-expanded]")].find(
      (b) => b.querySelector('span[class="truncate"]')?.textContent === name,
    );
    const sibling = source?.nextElementSibling;
    if (!sibling?.matches(".overflow-hidden")) return;
    const panel = sibling.cloneNode(true);
    panel.removeAttribute("style");
    button.after(panel);
    if (instant) return;
    panel.animate([{ height: "0px" }, { height: `${panel.offsetHeight}px` }], { duration: COLLAPSE.height[0], easing: COLLAPSE.height[1] });
    panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: COLLAPSE.opacity[0], easing: COLLAPSE.opacity[1] });
  }

  #cameraOn() {
    if (this.#reduced.matches || this.getAttribute("camera") === "off") return false;
    if (this.#def.camera === "always") return true;
    return this.getBoundingClientRect().width < NARROW;
  }

  /** How far in to go: further the smaller the window is drawn, so popups read at any width. */
  #zoom() {
    const width = this.getBoundingClientRect().width || this.#size[0];
    return Math.min(2.6, Math.max(1.35, 1.35 * Math.sqrt(1100 / width)));
  }

  /** An element's box in the app root's own coordinates, unaffected by any transform on the way. */
  #box(el) {
    let x = 0;
    let y = 0;
    for (let e = el; e && e !== this.#app; e = e.offsetParent) {
      x += e.offsetLeft;
      y += e.offsetTop;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  /** What the camera should hold for a step: the caret, and the popup when there is one. */
  #focusOn(step) {
    const scroller = this.#box(this.#editor().querySelector(".cm-scroller"));
    const [left, top] = step.cursor.split(" ").map(parseFloat);
    let x0 = scroller.x + left - 120;
    let y0 = scroller.y + top - 70;
    let x1 = scroller.x + left + 260;
    let y1 = scroller.y + top + 110;
    if (step.tooltip) {
      const popup = this.#editor().querySelector(".cm-tooltip-autocomplete");
      if (popup) {
        const box = { x: parseFloat(popup.style.left), y: parseFloat(popup.style.top), w: popup.offsetWidth, h: popup.offsetHeight };
        x1 = Math.max(x1, box.x + box.w + 24);
        y1 = Math.max(y1, box.y + Math.min(box.h, 200) + 24);
      }
    }
    // Lines read from their start: the frame opens on the editor's left edge whenever the caret
    // still fits, and a wide popup is cut on the right instead.
    const edge = this.#box(this.#app.querySelector("main")).x;
    return { x0, y0, x1, y1, left: edge, keep: scroller.x + left + 60 };
  }

  #focusOnCard(card, part) {
    const box = this.#box(card);
    // The card may be mid-spring; its content height is where it is going.
    const h = card.scrollHeight;
    if (part === "all") return { x0: box.x - 24, y0: box.y - 24, x1: box.x + box.w + 24, y1: box.y + h + 120, fitWidth: true };
    const y0 = box.y - 16;
    const y1 = box.y + h + 16;
    if (part === "left") return { x0: box.x - 16, y0, x1: box.x + 420, y1, left: this.#box(this.#app.querySelector("main")).x };
    // The right half opens on a grid line, the left edge of the result's last column, so the frame
    // starts at a border rather than mid-word.
    const headers = card.querySelectorAll('[role="columnheader"]');
    const line = headers.length > 1 ? this.#box(headers[headers.length - 1]).x : box.x + box.w - 420;
    return { x0: line, y0, x1: Math.min(this.#size[0], box.x + box.w + 16), y1, anchor: "right", fitWidth: true, cropBottom: true };
  }

  /** Pans when the step's focus has left the middle of the view; small moves stay put. */
  #follow(step) {
    if (!step.tooltip && step.col > 0 && step.line === this.#cursors.lastFollowLine) return;
    this.#cursors.lastFollowLine = step.line;
    const focus = this.#focusOn(step);
    const { s, cx, cy } = this.#camera;
    const [w, h] = this.#size;
    const view = { x0: cx - w / (2 * s), y0: cy - h / (2 * s), x1: cx + w / (2 * s), y1: cy + h / (2 * s) };
    const margin = 24;
    const inside = focus.x0 >= view.x0 + margin && focus.x1 <= view.x1 - margin && focus.y0 >= view.y0 + margin && focus.y1 <= view.y1 - margin;
    if (!inside) this.#cameraTo(focus, 900);
  }

  // The camera moves the app inside the window frame; the chrome stays put. A null focus is the
  // whole window.
  #cameraTo(focus, duration = CAMERA.duration) {
    const root = this.#app?.firstElementChild;
    if (!root) return;
    const [w, h] = this.#size;
    let s = 1;
    let cx = w / 2;
    let cy = h / 2;
    if (focus) {
      const fw = focus.x1 - focus.x0;
      const fh = focus.y1 - focus.y0;
      s = this.#zoom();
      if (focus.fitWidth) s = Math.min(s, w / fw, focus.cropBottom ? Infinity : h / fh);
      // A frame that opens on a grid line fills the view exactly from that line to the card's edge.
      if (focus.cropBottom) s = Math.min(2.8, w / fw);
      s = Math.max(1, s);
      cx = (focus.x0 + focus.x1) / 2;
      cy = (focus.y0 + focus.y1) / 2;
      // Keep the focus's top-left in view when it is bigger than the view: the start of a line,
      // the head of a card, matter more than its far edge.
      if (fw > w / s) cx = focus.anchor === "right" ? focus.x1 - w / (2 * s) : focus.x0 + w / (2 * s);
      if (fh > h / s) cy = focus.y0 + h / (2 * s);
      if (focus.left !== undefined && (focus.keep ?? focus.x1) <= focus.left + w / s) cx = focus.left + w / (2 * s);
      // A frame edge never cuts through the sidebar or the topbar: it lands on the editor's left
      // edge or the top of its tabs, so a crop reads as framing rather than as a broken page.
      const main = this.#app.querySelector("main");
      const header = this.#app.querySelector("header");
      const left = cx - w / (2 * s);
      if (main && left > 0 && left < this.#box(main).x) cx = this.#box(main).x + w / (2 * s);
      const top = cy - h / (2 * s);
      if (header && top > 0 && top < header.offsetHeight) cy = header.offsetHeight + h / (2 * s);
      cx = Math.min(w - w / (2 * s), Math.max(w / (2 * s), cx));
      cy = Math.min(h - h / (2 * s), Math.max(h / (2 * s), cy));
    }
    this.#camera = { s, cx, cy };
    const target = s === 1 ? "none" : `translate(${(w / 2 - cx * s).toFixed(2)}px, ${(h / 2 - cy * s).toFixed(2)}px) scale(${s.toFixed(4)})`;
    // Already there, or already on the way there.
    if ((root.style.transform || "none") === target) return;
    const from = getComputedStyle(root).transform;
    this.#cameraAnimation?.cancel();
    root.style.transform = target;
    if (!duration || this.#reduced.matches || from === getComputedStyle(root).transform) return;
    this.#cameraAnimation = root.animate([{ transform: from }, { transform: target === "none" ? "matrix(1, 0, 0, 1, 0, 0)" : target }], {
      duration,
      easing: CAMERA.easing,
    });
  }
}

if (!customElements.get("perch-workspace")) customElements.define("perch-workspace", PerchWorkspace);

/**
 * <perch-walk> — Query Walk, recorded from the real app (site/capture/walk.ts), in the same window
 * chrome as <perch-workspace>, over a clause rail that follows the recording. Animation only: it
 * loops on its own and takes no pointer or key.
 *
 *   <script type="module" src="assets/js/walk.js"></script>
 *   <perch-walk></perch-walk>
 *
 * Attributes
 *   autoplay  On unless autoplay="false". Plays while at least 40% visible, pauses offscreen.
 *   paused    Holds the recording where it is; removing it resumes.
 *
 * Methods
 *   play()   Resumes (never under prefers-reduced-motion).
 *   pause()  Holds the recording.
 *   reset()  Back to the first frame, FROM.
 *
 * Properties
 *   anchors  { window, titlebar, rail }: live elements inside the shadow root.
 *   ready    Resolves once the clause times and fonts are in. The video itself loads lazily.
 *
 * Events (CustomEvent, bubbles, composed)
 *   scene:done   The recording reached its loop point. detail: { loop }
 *
 * The video is fetched only within about a viewport of the screen. Under prefers-reduced-motion it
 * is never fetched: the poster stays up.
 */

const ASSETS = new URL("../", import.meta.url);
const asset = (path) => new URL(path, ASSETS).href;

const RAIL = ["FROM", "JOIN", "WHERE", "GROUP BY", "HAVING", "WINDOW", "SELECT", "DISTINCT", "ORDER BY", "LIMIT"];
// The app's coordinate space: the recording is 1280x760 CSS px under a 40px titlebar, the size
// <perch-workspace> replays, so both windows read at one scale on the page.
const WIDTH = 1280;
const TITLEBAR = 40;
const SCREEN = 760;

const CSS = `
:host {
  display: block; position: relative; min-width: 0;
  --pw-sidebar: oklch(23.1% 0.004 264.487);
  --pw-border: oklch(30.8% 0.006 258.354);
  --pw-field: oklch(29.3% 0.006 271.223);
  --pw-muted: oklch(73.1% 0.008 260.731);
  --pw-screen: oklch(14.6% 0.003 264);
  --rail-ease: var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1));
}
:host([hidden]) { display: none; }
.wrap { container-type: inline-size; }
.window {
  position: relative; overflow: hidden; isolation: isolate;
  border-radius: var(--radius-window, 12px);
  background: var(--app-page, oklch(20.9% 0.004 264.477));
  box-shadow: 0 0 0 1px oklch(100% 0 0 / 0.15), 0 8px 28px oklch(0% 0 0 / 0.34);
}
.titlebar {
  position: relative; height: calc(100cqw * ${TITLEBAR / WIDTH}); display: flex; align-items: center; justify-content: center;
  background: var(--pw-sidebar); border-bottom: 1px solid var(--pw-border); box-sizing: border-box;
}
.lights { position: absolute; left: calc(100cqw * ${14 / WIDTH}); top: 0; bottom: 0; display: flex; align-items: center; gap: calc(100cqw * ${8 / WIDTH}); }
.lights span { width: calc(100cqw * ${12 / WIDTH}); aspect-ratio: 1; border-radius: 50%; box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.2); }
.lights span:nth-child(1) { background: #ff5f57; }
.lights span:nth-child(2) { background: #febc2e; }
.lights span:nth-child(3) { background: #28c840; }
.address {
  height: calc(100cqw * ${24 / WIDTH}); padding: 0 calc(100cqw * ${14 / WIDTH}); border-radius: calc(100cqw * ${6 / WIDTH});
  display: flex; align-items: center; background: var(--pw-field); color: var(--pw-muted);
  font: 400 calc(100cqw * ${12 / WIDTH}) / 1 var(--font-sans, "Geist Variable", ui-sans-serif, system-ui, sans-serif);
  font-variant-numeric: tabular-nums; letter-spacing: 0.01em;
}
.screen { position: relative; aspect-ratio: ${WIDTH} / ${SCREEN}; background: var(--pw-screen); }
video { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--pw-screen); }

.rail {
  position: relative; margin-top: 20px; overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x proximity; scrollbar-width: none; pointer-events: none; user-select: none;
  --fade-l: 0px; --fade-r: 0px;
  mask-image: linear-gradient(to right, transparent, #000 var(--fade-l), #000 calc(100% - var(--fade-r)), transparent);
}
.rail::-webkit-scrollbar { display: none; }
.rail[data-more-left] { --fade-l: 28px; }
.rail[data-more-right] { --fade-r: 28px; }
.track { position: relative; min-width: max-content; width: 100%; padding-bottom: 8px; }
ol { display: flex; align-items: center; margin: 0; padding: 0; list-style: none; }
li { display: flex; align-items: center; }
li.sep { flex: 1 1 0; min-width: 22px; padding: 0 4px; color: var(--line-strong, oklch(35.6% 0.007 264.474)); transition: color 300ms ease; }
li.sep[data-passed] { color: color-mix(in oklch, var(--accent, oklch(68% 0.173 253.301)) 55%, var(--line-strong, oklch(35.6% 0.007 264.474))); }
.sep .line { flex: 1; height: 1px; background: currentColor; }
.sep svg { flex: none; width: 5px; height: 8px; margin-left: -1px; }
.chip {
  position: relative; flex: none; scroll-snap-align: center;
  margin: 0; padding: 7px 10px; border: 0; border-radius: var(--radius-control, 8px); background: transparent;
  font: 400 13px/1 var(--font-mono, "Geist Mono Variable", ui-monospace, SFMono-Regular, monospace);
  letter-spacing: 0; white-space: nowrap; color: var(--ink-3, oklch(54.1% 0.01 264.484));
  transition: color 280ms ease, background-color 280ms ease;
}
.chip[data-passed] { color: var(--ink-2, oklch(73.1% 0.008 260.731)); }
.chip[data-current] { color: var(--ink, oklch(96.4% 0.002 247.839)); background: color-mix(in oklch, var(--surface, oklch(26% 0.006 271.191)) 70%, transparent); }
.chip[data-unused] { color: color-mix(in oklch, var(--ink-3, oklch(54.1% 0.01 264.484)) 55%, transparent); }
.underline {
  position: absolute; left: 0; bottom: 2px; height: 2px; width: 0; border-radius: 1px; overflow: hidden;
  background: color-mix(in oklch, var(--accent, oklch(68% 0.173 253.301)) 32%, transparent);
  transition: transform 460ms var(--rail-ease), width 460ms var(--rail-ease);
  pointer-events: none;
}
.underline i { position: absolute; inset: 0; background: var(--accent, oklch(68% 0.173 253.301)); transform-origin: 0 50%; transform: scaleX(0); }
.underline[hidden] { display: block; opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .chip, li.sep, .underline { transition: none; }
}
`;

function registerFonts() {
  const has = (family) => [...document.fonts].some((face) => face.family.replace(/"/g, "") === family);
  if (has("Geist Mono Variable") && has("Geist Variable")) return;
  if (document.querySelector("style[data-perch-walk-fonts]")) return;
  const latin =
    "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  const style = document.createElement("style");
  style.dataset.perchWalkFonts = "";
  style.textContent = [["Geist Variable", "geist"], ["Geist Mono Variable", "geist-mono"]]
    .map(([family, file]) =>
      `@font-face{font-family:"${family}";font-style:normal;font-display:swap;font-weight:100 900;` +
      `src:url("${asset(`fonts/${file}-latin.woff2`)}") format("woff2-variations");unicode-range:${latin}}`)
    .join("\n");
  document.head.append(style);
}

let data;
const loadData = () => (data ??= fetch(asset("data/walk.json")).then((r) => r.json()));

class PerchWalk extends HTMLElement {
  static observedAttributes = ["paused", "autoplay"];

  #root;
  #ready;
  #video;
  #window;
  #titlebar;
  #rail;
  #underline;
  #fill;
  #chips = [];
  #seps = [];
  #stages = [];
  #duration = 0;
  #done = 0;
  #active = -1;
  #visible = false;
  #loops = 0;
  #lastTime = 0;
  #frame = 0;
  #reduced = matchMedia("(prefers-reduced-motion: reduce)");
  #seen;
  #approach;
  #resize;
  #source;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: "open" });
    this.#build();
    this.#ready = this.#load();
  }

  get ready() {
    return this.#ready;
  }

  get anchors() {
    return { window: this.#window, titlebar: this.#titlebar, rail: this.#rail };
  }

  connectedCallback() {
    this.#reduced.addEventListener("change", this.#onMotion);
    this.#seen ??= new IntersectionObserver(([entry]) => {
      this.#visible = entry.isIntersecting && entry.intersectionRatio >= 0.4;
      this.#sync();
    }, { threshold: [0, 0.4] });
    this.#approach ??= new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      this.#approach.disconnect();
      this.#video.poster = asset("clips/walk.webp");
      if (!this.#reduced.matches) this.#fetchVideo();
    }, { rootMargin: "100% 0px 100% 0px" });
    this.#resize ??= new ResizeObserver(() => this.#placeUnderline(false));
    this.#seen.observe(this);
    this.#approach.observe(this);
    this.#resize.observe(this.#rail);
  }

  disconnectedCallback() {
    this.#reduced.removeEventListener("change", this.#onMotion);
    this.#seen?.disconnect();
    this.#approach?.disconnect();
    this.#resize?.disconnect();
    this.#visible = false;
    this.#sync();
  }

  attributeChangedCallback() {
    this.#sync();
  }

  play() {
    this.removeAttribute("paused");
    this.#sync();
  }

  pause() {
    this.setAttribute("paused", "");
  }

  reset() {
    this.#loops = 0;
    this.#seek(0);
  }

  #build() {
    const style = document.createElement("style");
    style.textContent = CSS;
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML = `
      <div class="window" role="group" aria-label="Perch's Query Walk, recorded from the app">
        <div class="titlebar" inert>
          <div class="lights" aria-hidden="true"><span></span><span></span><span></span></div>
          <div class="address">127.0.0.1:4600</div>
        </div>
        <div class="screen">
          <video muted playsinline loop disablepictureinpicture preload="none" inert></video>
        </div>
      </div>
      <div class="rail" aria-hidden="true">
        <div class="track"><ol></ol><span class="underline"><i></i></span></div>
      </div>`;
    this.#root.append(style, wrap);
    this.#window = wrap.querySelector(".window");
    this.#titlebar = wrap.querySelector(".titlebar");
    this.#rail = wrap.querySelector(".rail");
    this.#video = wrap.querySelector("video");
    this.#video.muted = true;

    const list = wrap.querySelector("ol");
    RAIL.forEach((clause, i) => {
      if (i > 0) {
        const sep = document.createElement("li");
        sep.className = "sep";
        sep.setAttribute("aria-hidden", "true");
        sep.innerHTML = `<span class="line"></span><svg viewBox="0 0 5 8"><path d="M.75.75 4 4 .75 7.25" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        list.append(sep);
        this.#seps.push(sep);
      }
      const item = document.createElement("li");
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = clause;
      item.append(chip);
      list.append(item);
      this.#chips.push(chip);
    });
    this.#underline = wrap.querySelector(".underline");
    this.#underline.hidden = true;
    this.#fill = this.#underline.firstChild;

    this.#rail.addEventListener("scroll", () => this.#edges(), { passive: true });

    const video = this.#video;
    video.addEventListener("play", () => this.#tick());
    video.addEventListener("seeked", () => this.#update(video.currentTime));
  }

  async #load() {
    registerFonts();
    try {
      const walk = await loadData();
      this.#stages = walk.stages.map((s) => ({ ...s, index: RAIL.indexOf(s.clause) })).filter((s) => s.index >= 0);
      this.#duration = walk.duration;
      this.#done = walk.done;
      // The video is inert, so what it shows is told by the window around it.
      this.#window.setAttribute(
        "aria-label",
        `Perch's Query Walk, recorded from the app, stepping through: ${walk.query.replace(/\s+/g, " ")}`,
      );
    } catch {
      this.#stages = [];
    }
    const used = new Set(this.#stages.map((s) => s.index));
    this.#chips.forEach((chip, i) => chip.toggleAttribute("data-unused", !used.has(i)));
    await Promise.all([
      document.fonts.load('400 13px "Geist Mono Variable"'),
      document.fonts.load('400 12px "Geist Variable"'),
    ]).catch(() => {});
    this.#update(0);
    this.#edges();
  }

  // The whole clip as a blob: seekable anywhere at once, so a chip lands instantly, even from a
  // server that ignores Range requests (python's http.server does). It is a few megabytes, fetched
  // a viewport ahead of the reader.
  #fetchVideo() {
    if (this.#source) return;
    const video = this.#video;
    video.poster = asset("clips/walk.webp");
    const url = asset(this.#pick());
    this.#source = fetch(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(r.statusText))))
      .then((blob) => URL.createObjectURL(blob), () => url)
      .then((src) => {
        video.preload = "auto";
        video.src = src;
        this.#sync();
      });
  }

  // The 1x clip wherever the window is drawn under ~1440 device pixels wide (phones, 1x desktops):
  // scaled down that far by the browser, the 2x clip's text comes out jagged. Elsewhere AV1 where
  // it decodes, H.264 everywhere else.
  #pick() {
    const pixels = (this.getBoundingClientRect().width || innerWidth) * devicePixelRatio;
    if (pixels <= 1440) return "clips/walk-small.mp4";
    return this.#video.canPlayType('video/webm; codecs="av01.0.12M.08"') ? "clips/walk.webm" : "clips/walk.mp4";
  }

  #onMotion = () => this.#sync();

  #wanted() {
    if (!this.#visible || this.hasAttribute("paused")) return false;
    return this.getAttribute("autoplay") !== "false" && !this.#reduced.matches;
  }

  #sync() {
    const video = this.#video;
    if (this.#wanted()) {
      this.#fetchVideo();
      if (video.paused && video.src) video.play().catch(() => {});
    } else if (!video.paused) {
      video.pause();
    }
  }

  // Frame-accurate where the browser offers it: the rail changes on the frame the video does.
  #tick = () => {
    const video = this.#video;
    const frames = "requestVideoFrameCallback" in video;
    if (frames) video.cancelVideoFrameCallback(this.#frame);
    else cancelAnimationFrame(this.#frame);
    if (video.paused) return;
    const step = (_, meta) => {
      const time = meta?.mediaTime ?? video.currentTime;
      if (time + 1 < this.#lastTime && this.#lastTime > this.#duration - 1.5) {
        this.#loops += 1;
        this.dispatchEvent(new CustomEvent("scene:done", { bubbles: true, composed: true, detail: { loop: this.#loops } }));
      }
      this.#lastTime = time;
      this.#update(time);
      if (!video.paused) schedule();
    };
    const schedule = () => {
      this.#frame = frames ? video.requestVideoFrameCallback(step) : requestAnimationFrame(() => step(0, null));
    };
    schedule();
  };

  #stageAt(time) {
    let at = 0;
    for (let i = 0; i < this.#stages.length; i++) if (this.#stages[i].t <= time + 0.02) at = i;
    return at;
  }

  #update(time) {
    if (!this.#stages.length) return;
    const at = this.#stageAt(time);
    const stage = this.#stages[at];
    const next = this.#stages[at + 1];
    const end = next ? next.t : this.#done;
    const progress = Math.min(1, Math.max(0, (time - stage.t) / Math.max(0.1, end - stage.t)));
    this.#fill.style.transform = `scaleX(${progress.toFixed(4)})`;
    if (at === this.#active) return;
    const first = this.#active === -1;
    this.#active = at;
    const index = stage.index;
    this.#chips.forEach((chip, i) => {
      chip.toggleAttribute("data-passed", i < index && !chip.hasAttribute("data-unused"));
      chip.toggleAttribute("data-current", i === index);
    });
    this.#seps.forEach((sep, i) => sep.toggleAttribute("data-passed", i < index));
    this.#placeUnderline(!first);
    this.#follow();
  }

  #placeUnderline(animate) {
    const stage = this.#stages[this.#active];
    if (!stage) return;
    const chip = this.#chips[stage.index];
    const line = this.#underline;
    if (!animate) line.style.transition = "none";
    line.style.width = `${chip.offsetWidth - 20}px`;
    line.style.transform = `translateX(${chip.offsetLeft + 10}px)`;
    line.hidden = false;
    if (!animate) {
      line.getBoundingClientRect();
      line.style.transition = "";
    }
    this.#edges();
  }

  // Keep the lit chip in view when the rail is narrower than its chips, without touching the page's
  // scroll.
  #follow() {
    const rail = this.#rail;
    if (rail.scrollWidth <= rail.clientWidth + 1) return;
    const chip = this.#chips[this.#stages[this.#active].index];
    const left = chip.offsetLeft + chip.offsetWidth / 2 - rail.clientWidth / 2;
    rail.scrollTo({ left, behavior: this.#reduced.matches ? "auto" : "smooth" });
  }

  #edges() {
    const rail = this.#rail;
    const hidden = rail.scrollWidth - rail.clientWidth;
    rail.toggleAttribute("data-more-left", hidden > 1 && rail.scrollLeft > 1);
    rail.toggleAttribute("data-more-right", hidden > 1 && rail.scrollLeft < hidden - 1);
  }

  #seek(time) {
    const video = this.#video;
    this.#lastTime = time;
    this.#update(time);
    this.#fetchVideo();
    const go = () => {
      video.currentTime = time;
    };
    if (video.readyState >= 1) go();
    else video.addEventListener("loadedmetadata", go, { once: true });
  }
}

customElements.define("perch-walk", PerchWalk);

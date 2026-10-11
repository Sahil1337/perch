// Records the real Perch app for <perch-workspace>: runs the built binary against the birdwatch
// database, drives it in headless Chrome over the DevTools protocol, and writes what the element
// replays — the app's CSS, each scene's markup and keystroke-by-keystroke states, and the query
// results.
//
//   bun apps/site/capture/capture.ts
//
// See README.md next to this file for prerequisites and what lands where.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const ASSETS = join(REPO, "apps/site/public/legacy");
const QUERIES = join(import.meta.dir, "queries");
const PERCH = join(REPO, "apps/server/dist/perch");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.CAPTURE_PORT ?? 4691);
const CDP_PORT = Number(process.env.CAPTURE_CDP_PORT ?? 9311);
const REF = process.env.CAPTURE_REF ?? join(tmpdir(), "perch-site-reference");
const PG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.CAPTURE_DB ?? "perch_site_demo",
};

// The app is captured at these sizes; the element renders each scene at exactly its size and
// scales. The notebook is taller so all three cells and their results fit without scrolling.
const WIDTH = 1280;
const HEIGHT = 760;
const NOTEBOOK_HEIGHT = 880;
// Where the editor/results split is dragged to: the queries fit with a line to spare.
const SPLIT_Y = 302;

// A step is one key (or a click that moves the caret) and how long the scene holds after it. The
// element replays exactly these, with the state each one produced in the real app.
type Step = { key?: string; click?: [line: number, col: number]; pause: number };

const HERO = {
  file: "spring-migration.sql",
  others: ["rare-sightings.sql", "busiest-sites.sql"],
  // The GROUP BY line is blank and the caret waits on it.
  initial: (sql: string) => sql.replace("group by s.common_name", ""),
  caret: [6, 0] as [number, number],
  script: [
    { key: "g", pause: 150 },
    { key: "r", pause: 130 },
    { key: "o", pause: 620 },
    { key: "Enter", pause: 230 },
    { key: " ", pause: 160 },
    { key: "s", pause: 150 },
    { key: ".", pause: 1100 },
    { key: "Enter", pause: 0 },
  ] as Step[],
};

const JOIN = {
  file: "sightings-by-site.sql",
  // Neither join is written yet, and the select list has only the sum.
  initial: (sql: string) =>
    sql
      .replace("t.name, sum", "sum")
      .replace("join checklists c on g.checklist_id = c.id", "")
      .replace("join sites t on c.site_id = t.id", ""),
  caret: [4, 0] as [number, number],
  script: [
    { key: "j", pause: 140 },
    { key: "o", pause: 560 },
    { key: "Enter", pause: 260 },
    { key: " ", pause: 380 },
    // ⌃Space: the tables, the ones a foreign key reaches from `sightings` first.
    { key: "CtrlSpace", pause: 1500 },
    { key: "Enter", pause: 260 },
    { key: " ", pause: 140 },
    { key: "c", pause: 150 },
    { key: " ", pause: 140 },
    { key: "o", pause: 120 },
    { key: "n", pause: 140 },
    { key: " ", pause: 380 },
    // The join condition, written out from the foreign key.
    { key: "CtrlSpace", pause: 1400 },
    { key: "Enter", pause: 650 },
    { key: "ArrowDown", pause: 300 },
    { key: "j", pause: 120 },
    { key: "o", pause: 110 },
    { key: "i", pause: 110 },
    { key: "n", pause: 130 },
    { key: " ", pause: 380 },
    { key: "CtrlSpace", pause: 950 },
    { key: "ArrowDown", pause: 1000 },
    { key: "Enter", pause: 260 },
    { key: " ", pause: 140 },
    { key: "t", pause: 150 },
    { key: " ", pause: 140 },
    { key: "o", pause: 120 },
    { key: "n", pause: 140 },
    { key: " ", pause: 380 },
    { key: "CtrlSpace", pause: 1300 },
    { key: "Enter", pause: 700 },
    // Back to the select list: only the joined tables' columns are offered.
    { click: [2, 7], pause: 450 },
    { key: "n", pause: 160 },
    { key: "a", pause: 1100 },
    { key: "Enter", pause: 200 },
    { key: ",", pause: 140 },
    { key: " ", pause: 0 },
  ] as Step[],
};

const NOTEBOOK = { file: "field-notes.sql", name: "field-notes" };

// The visible editor's CodeMirror view, reached through the DOM node it owns.
const VIEW = `(() => { const e = [...document.querySelectorAll('.cm-content')].find(e => e.getBoundingClientRect().width > 0); return (e.cmTile ?? e.cmView).view; })()`;

// Regions of the root a state can change. A state stores only the regions that differ from its
// scene's first frame, so the element fetches one base and a small set of fragments.
const REGIONS: Record<string, string> = {
  header: "header",
  sidebar: "aside",
  tabs: "main .h-9",
  results: "#group-results",
  footer: "footer",
  runAll: "main .flex.h-10.shrink-0",
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = `http://127.0.0.1:${PORT}`;
const temporary: string[] = [];

// Machine paths must never reach the site. Each scene's workspace reads as ~/birdwatch and perch's
// home as ~/.perch, the way the app shows them on a normal install.
const replacements: [string, string][] = [];
function scrub(text: string): string {
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text
    .replace(/\/(?:Users|home)\/[^/"'<>\s]+/g, "~")
    .replace(new RegExp(`\\b${userInfo().username}\\b`, "g"), "birder");
}

async function waitFor(url: string, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function json(path: string, init?: RequestInit) {
  const res = await fetch(`${api}${path}`, { ...init, headers: { "content-type": "application/json" } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

mkdirSync(REF, { recursive: true });
const profile = mkdtempSync(join(tmpdir(), "perch-capture-chrome-"));
temporary.push(profile);
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    "--window-size=1440,900", "--force-device-scale-factor=2", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

const runtimeCss: string[] = [];
let cssText = "";
const recorded: Record<string, unknown> = {};

try {
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const page = await cdp();
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.send("Network.enable");

  await withApp("hero", HEIGHT, async () => {
    await openFiles([HERO.file, ...HERO.others]);
    await page.drag("#group-results", SPLIT_Y);
    await page.clickTab(HERO.file);
    const scene = await editorScene("hero", HERO);
    // The other two tabs' results, for when a visitor switches to them and presses Run.
    for (const file of HERO.others) {
      await page.clickTab(file);
      await page.clickLine(1);
      await page.runQuery();
      recorded[file] = await lastRun(file);
      await page.snapshot(`hero-${file.replace(".sql", "")}`);
    }
    scene.json.states.tree = await expandedTree("hero");
    write("hero", scene, [HERO.file, ...HERO.others]);
  });

  await withApp("join", HEIGHT, async () => {
    await openFiles([JOIN.file]);
    await page.drag("#group-results", SPLIT_Y);
    const scene = await editorScene("join", JOIN);
    scene.json.states.tree = await expandedTree("join");
    write("join", scene, [JOIN.file]);
  });

  await withApp("notebook", NOTEBOOK_HEIGHT, async () => {
    await page.clickText("Files", "aside");
    await sleep(400);
    await page.click('[aria-label="New document"]');
    await sleep(400);
    await page.clickText("New notebook");
    await sleep(900);
    // Pasted into the first card, the way a file's text arrives; its `-- %%` lines make the cells.
    await page.click("article .cm-content");
    await sleep(300);
    await page.send("Input.insertText", { text: readFileSync(join(QUERIES, NOTEBOOK.file), "utf8") });
    await sleep(600);
    await page.press("s", 4);
    await page.until(`!!document.querySelector('[role=dialog] input')`);
    await page.evaluate(`document.querySelector('[role=dialog] input').select()`);
    await page.send("Input.insertText", { text: NOTEBOOK.name });
    await page.press("Enter");
    await page.until(`document.querySelector('main .h-9')?.textContent.includes(${JSON.stringify(NOTEBOOK.file)})`);
    await page.evaluate("document.activeElement?.blur()");
    await page.parkPointer();
    await sleep(1500);
    const idle = await page.snapshot("notebook-idle");
    const cards = () => page.evaluate<string[]>(`[...document.querySelectorAll('main article')].map(a => a.outerHTML)`);

    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await page.clickText("Run all");
    await page.parkPointer();
    await sleep(700);
    const running = await page.snapshot("notebook-running");
    const runningCards = (await cards()).map(prepare);
    await page.until(`document.querySelectorAll('main article [role=grid]').length === 3`, 20000);
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await sleep(1200);
    const done = await page.snapshot("notebook-done");
    const doneCards = (await cards()).map(prepare);

    const runs = (await json("/api/runs")).slice(0, 3).reverse();
    const cells = [];
    for (const summary of runs) cells.push(statementOf(await json(`/api/runs/${summary.id}`)));
    recorded[NOTEBOOK.file] = { file: NOTEBOOK.file, sql: readFileSync(join(QUERIES, NOTEBOOK.file), "utf8").trimEnd(), cells };
    write("notebook", {
      idle,
      json: {
        size: [WIDTH, NOTEBOOK_HEIGHT],
        file: NOTEBOOK.file.replace(".sql", ""),
        cards: { idle: (await cardsOf(idle.html)).map(prepare), running: runningCards, done: doneCards },
        states: { running: diffRegions(idle, running), done: diffRegions(idle, done) },
      },
    }, [NOTEBOOK.file]);
  });

  writeOut("css/app.css", adaptCss(scrub(cssText), runtimeCss.join("\n")));
  writeOut("data/schema.json", JSON.stringify(recorded.schema));
  for (const [file, data] of Object.entries(recorded)) {
    if (file.endsWith(".sql")) writeOut(`data/${file.replace(".sql", ".json")}`, JSON.stringify(data));
  }
  copyFonts();
  console.log(`captured into ${ASSETS}; reference screenshots and full snapshots in ${REF}`);
  page.close();

  // A scene runs against its own server and an empty browser origin: no history, no restored tabs,
  // no results left over from the scene before.
  async function withApp(name: string, height: number, body: () => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), `perch-capture-${name}-`));
    temporary.push(dir);
    const home = join(dir, "home");
    const workspace = join(dir, "birdwatch");
    for (const path of [home, workspace]) mkdirSync(path, { recursive: true });
    for (const file of readdirSync(QUERIES)) {
      if (file !== NOTEBOOK.file) copyFileSync(join(QUERIES, file), join(workspace, file));
    }
    for (const [path, shown] of [[workspace, "~/birdwatch"], [home, "~/.perch"]] as const) {
      replacements.push([realpathSync(path), shown], [path, shown]);
    }
    const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
      env: { ...process.env, PERCH_HOME: home },
      stdout: "ignore",
      stderr: "inherit",
    });
    try {
      await waitFor(`${api}/api/health`);
      await json("/api/connections", { method: "POST", body: JSON.stringify({ name: "birdwatch", dialect: "postgres", ...PG }) });
      await json("/api/settings", { method: "PUT", body: JSON.stringify({ onboarded: true, theme: "dark", workspaces: [workspace] }) });
      // An unrecorded query first opens the pool, so a scene's timings are its query's, not the
      // first connection's setup.
      await json("/api/query/sync", { method: "POST", body: JSON.stringify({ connectionId: "birdwatch", sql: "select 1", record: false }) });
      recorded.schema ??= await json("/api/connections/birdwatch/schema");
      delete (recorded.schema as Record<string, unknown>).fetchedAt;
      await page.send("Storage.clearDataForOrigin", { origin: api, storageTypes: "all" });
      await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height, deviceScaleFactor: 2, mobile: false });
      await page.navigate(api);
      await page.until(`!!document.querySelector('aside') && document.body.innerText.includes('species')`);
      await sleep(800);
      await body();
      const css = await page.styles();
      cssText = await (await fetch(css.href)).text();
      // CodeMirror names its classes when each theme module loads, so every scene's page agrees on
      // them; a scene only adds the rules for editors the others did not mount.
      for (const rule of css.runtime) if (!runtimeCss.includes(rule)) runtimeCss.push(rule);
    } finally {
      perch.kill();
      await perch.exited;
    }
  }

  async function openFiles(files: string[]) {
    await page.clickText("Files", "aside");
    await sleep(500);
    for (const file of files) {
      await page.clickText(file, "aside");
      await sleep(500);
    }
    await page.clickText("Schema", "aside");
    await sleep(500);
  }

  // Types a scene's script into its file and records every state it passes through, then runs it.
  async function editorScene(name: string, def: typeof HERO | typeof JOIN) {
    const full = readFileSync(join(QUERIES, def.file), "utf8");
    await page.clickTab(def.file);
    await page.evaluate(`(() => { const v = ${VIEW}; v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: ${JSON.stringify(def.initial(full))} } }); })()`);
    await sleep(2500);
    await page.clickLine(def.caret[0], def.caret[1]);
    await sleep(1500);
    const idle = await page.snapshot(`${name}-idle`);
    const steps = [];
    let dirty: Record<string, string> | undefined;
    for (const [i, step] of def.script.entries()) {
      if (step.click) await page.clickLine(step.click[0], step.click[1]);
      else await page.press(step.key!);
      await sleep(step.key && step.key.length === 1 ? 450 : 500);
      steps.push({ pause: step.pause, ...(await page.editorState()) });
      if (!dirty && steps.at(-1)!.doc !== (steps.at(-2)?.doc ?? def.initial(full))) {
        const snap = await page.snapshot(`${name}-dirty`);
        if (snap.regions.footer.includes("Unsaved")) dirty = diffRegions(idle, snap);
      }
      if (steps.at(-1)!.tooltip) await page.shot(`${name}-step-${String(i).padStart(2, "0")}`);
    }
    if (steps.at(-1)!.doc !== full) throw new Error(`${name}: the script typed\n${steps.at(-1)!.doc}\nnot\n${full}`);
    await sleep(2000);
    await page.snapshot(`${name}-typed`);

    // The real run takes milliseconds; latency on the request holds the running state long enough
    // to photograph it without changing anything the server measures.
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
    await page.press("Enter", 4);
    await sleep(700);
    const running = await page.snapshot(`${name}-running`);
    await page.until(`/\\d+ rows? ·/.test(document.querySelector('#group-results')?.innerText ?? '')`);
    await page.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    recorded[def.file] = await lastRun(def.file);
    await sleep(900);
    const results = await page.snapshot(`${name}-results`);
    return {
      idle,
      json: {
        size: [WIDTH, HEIGHT],
        file: def.file.replace(".sql", ""),
        caret: { line: def.caret[0], col: def.caret[1] },
        steps,
        states: {
          dirty: dirty ?? {},
          running: diffRegions(idle, running),
          results: diffRegions(idle, results),
        } as Record<string, Record<string, string>>,
      },
    };
  }

  // Every table unfolded, for the sidebar's disclosure. One at a time: a row clicked while the one
  // above is still unfolding has moved.
  async function expandedTree(name: string) {
    const tables: string[] = await page.evaluate(`[...document.querySelectorAll('aside button[aria-expanded=false] > span[class="truncate"]')].map(e => e.textContent)`);
    const toggleAll = async () => {
      for (const table of tables) {
        await page.clickText(table, "aside");
        await sleep(500);
      }
    };
    await toggleAll();
    const tree = { sidebar: (await page.snapshot(`${name}-tree`)).regions.sidebar };
    await toggleAll();
    return tree;
  }

  async function cardsOf(html: string) {
    return page.evaluate<string[]>(`(() => { const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(html)}; return [...t.content.querySelectorAll('main article')].map(a => a.outerHTML); })()`);
  }

  function write(name: string, scene: { idle: Snapshot; json: Record<string, unknown> }, files: string[]) {
    writeOut(`markup/${name}.html`, prepare(scene.idle.html));
    writeOut(`markup/${name}.json`, JSON.stringify({ ...scene.json, files: files.map((f) => f.replace(".sql", "")) }));
  }
} finally {
  chrome.kill();
  await chrome.exited;
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
}

function statementOf(record: any) {
  const statement = record.results[0];
  return {
    columns: statement.columns.map(({ name, type, align }: any) => ({ name, type, align })),
    rows: statement.rows,
    rowCount: statement.rowCount,
    durationMs: statement.durationMs,
    runMs: record.durationMs,
  };
}

async function lastRun(file: string) {
  const [latest] = await json("/api/runs");
  return {
    file,
    sql: readFileSync(join(QUERIES, file), "utf8").trimEnd(),
    ...statementOf(await json(`/api/runs/${latest.id}`)),
  };
}

function writeOut(path: string, content: string) {
  const target = join(ASSETS, path);
  mkdirSync(resolve(target, ".."), { recursive: true });
  writeFileSync(target, scrub(content));
}

type Snapshot = { html: string; regions: Record<string, string> };

function diffRegions(base: Snapshot, next: Snapshot): Record<string, string> {
  return Object.fromEntries(Object.entries(next.regions).filter(([name, html]) => html !== base.regions[name]));
}

function prepare(html: string): string {
  return scrub(html)
    .replace(/\bh-svh\b/, "h-full")
    .replace(/contenteditable="true"/g, 'contenteditable="false"')
    .replace(/ aria-describedby="DndDescribedBy-\d+"/g, "");
}

// The app's stylesheet, made to work inside a shadow root at a fixed width:
// - fonts are dropped (the element registers them on the document, where @font-face works);
// - @property does nothing in a shadow tree, so each registration becomes a plain initial value;
// - viewport media queries are resolved for WIDTH, because the page's viewport is not the app's;
// - :root tokens are re-pointed at :host, and so are the .dark ones: the element is always dark,
//   and a token like --color-background resolves where it is declared, so the dark values have to
//   be in force at :host, not only on the .dark wrapper inside it.
function adaptCss(css: string, runtime: string): string {
  css = css.replace(/@font-face\{[^}]*\}/g, "");
  const initial: string[] = [];
  const inherited: string[] = [];
  css = css.replace(/@property\s+(--[\w-]+)\s*\{([^}]*)\}/g, (_, name: string, body: string) => {
    const value = /initial-value:([^;]+)/.exec(body)?.[1]?.trim();
    if (value !== undefined) (/inherits:\s*true/.test(body) ? inherited : initial).push(`${name}:${value}`);
    return "";
  });
  css = resolveMedia(css);
  css = css.replace(/:root\b/g, ":host").replace(/\}\.dark\{/g, "}:host,.dark{");
  const properties =
    `@layer properties{:host{${inherited.join(";")}}*,:before,:after,::backdrop{${initial.join(";")}}}`;
  return `${css}\n${properties}\n${runtime.replace(/:root\b/g, ":host")}\n`;
}

function resolveMedia(css: string): string {
  const rem = 16;
  const evaluate = (query: string): boolean | null => {
    const negated = /^not all and /.test(query);
    const m = /\((width|min-width|max-width)\s*(>=|<=|<|>|:)\s*([\d.]+)(rem|px)\)/.exec(query);
    if (!m) return null;
    const px = Number(m[3]) * (m[4] === "rem" ? rem : 1);
    const op = m[2] === ":" ? (m[1] === "max-width" ? "<=" : ">=") : m[2];
    const result = { ">=": WIDTH >= px, "<=": WIDTH <= px, "<": WIDTH < px, ">": WIDTH > px }[op]!;
    return negated ? !result : result;
  };
  let out = "";
  let i = 0;
  for (;;) {
    const at = css.indexOf("@media", i);
    if (at === -1) return out + css.slice(i);
    const open = css.indexOf("{", at);
    const query = css.slice(at + 6, open).trim();
    const close = matchBrace(css, open);
    const verdict = evaluate(query);
    out += css.slice(i, at);
    if (verdict === null) out += css.slice(at, open + 1) + resolveMedia(css.slice(open + 1, close)) + "}";
    else if (verdict) out += resolveMedia(css.slice(open + 1, close));
    i = close + 1;
  }
}

function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === "\\") i++;
    else if (ch === "/" && css[i + 1] === "*") i = css.indexOf("*/", i + 2) + 1;
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  throw new Error("unbalanced CSS");
}

function copyFonts() {
  const dir = join(ASSETS, "fonts");
  mkdirSync(dir, { recursive: true });
  const source = join(REPO, "node_modules/@fontsource-variable");
  for (const family of ["geist", "geist-mono"]) {
    for (const subset of ["latin", "latin-ext"]) {
      copyFileSync(join(source, family, "files", `${family}-${subset}-wght-normal.woff2`), join(dir, `${family}-${subset}.woff2`));
    }
  }
  const [geist, mono] = ["geist", "geist-mono"].map((f) => readFileSync(join(source, f, "LICENSE"), "utf8").split("\n"));
  writeFileSync(join(dir, "OFL.txt"), [geist[0], mono[0], ...geist.slice(1)].join("\n"));
}

async function cdp() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = targets.find((t: any) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map<number, [(v: any) => void, (e: Error) => void]>();
  const listeners: ((m: any) => void)[] = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      msg.error ? waiter[1](new Error(JSON.stringify(msg.error))) : waiter[0](msg.result);
    } else listeners.forEach((l) => l(msg));
  };
  const send = (method: string, params: any = {}) =>
    new Promise<any>((res, rej) => {
      const i = ++id;
      pending.set(i, [res, rej]);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");

  async function evaluate<T = any>(expression: string): Promise<T> {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  // The page shows the throwaway paths; the references should read the way the site does.
  async function shot(name: string) {
    await evaluate(`(() => {
      const swap = (s) => ${JSON.stringify(replacements)}.reduce((t, [a, b]) => t.split(a).join(b), s);
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (n.nodeValue.includes('/')) n.nodeValue = swap(n.nodeValue);
    })()`);
    const r = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(REF, `${name}.png`), Buffer.from(r.data, "base64"));
  }
  async function until(expression: string, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(100);
    }
    await shot("timeout");
    throw new Error(`timed out (see ${join(REF, "timeout.png")}): ${expression}`);
  }
  async function navigate(url: string) {
    const loaded = new Promise<void>((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
    await send("Page.navigate", { url });
    await loaded;
  }
  let held = false;
  async function mouse(type: string, x: number, y: number) {
    const pressed = type === "mousePressed" || held;
    if (type === "mousePressed") held = true;
    if (type === "mouseReleased") held = false;
    await send("Input.dispatchMouseEvent", {
      type, x, y, clickCount: 1,
      button: type === "mouseMoved" && !held ? "none" : "left",
      buttons: pressed && type !== "mouseReleased" ? 1 : 0,
    });
  }
  // Park the pointer on the status bar, where no hover style lands, so snapshots are not caught
  // mid-hover.
  async function parkPointer() {
    const height = await evaluate<number>("innerHeight");
    await mouse("mouseMoved", WIDTH / 2, height - 4);
  }
  async function clickAt(x: number, y: number) {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
    await parkPointer();
  }
  async function click(selector: string) {
    const r = await evaluate<{ x: number; y: number } | null>(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
    if (!r) throw new Error(`no ${selector}`);
    await clickAt(r.x, r.y);
  }
  async function clickText(text: string, scope = "body") {
    const point = await evaluate<{ x: number; y: number } | null>(`(() => {
      const hits = [...document.querySelectorAll(${JSON.stringify(scope)} + ' *')].filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === ${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0);
      const e = hits.at(-1);
      if (!e) return null;
      e.scrollIntoView({ block: "nearest" });
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing reads "${text}"`);
    await clickAt(point.x, point.y);
  }
  // Through the sidebar's file list: a synthetic click on a tab can wake its drag sensor.
  async function clickTab(file: string) {
    await clickText("Files", "aside");
    await sleep(400);
    await clickText(file, "aside");
    await sleep(400);
    await clickText("Schema", "aside");
    await sleep(500);
  }
  async function clickLine(line: number, col = -1) {
    const point = await evaluate<{ x: number; y: number }>(`(() => {
      const v = ${VIEW};
      const l = v.state.doc.line(${line});
      const r = v.coordsAtPos(${col} < 0 ? l.from : l.from + ${col});
      return { x: r.left + ${col < 0 ? 4 : 1}, y: (r.top + r.bottom) / 2 };
    })()`);
    await clickAt(point.x, point.y);
  }
  async function drag(selector: string, y: number) {
    const from = await evaluate<{ x: number; y: number }>(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)}).previousElementSibling.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await mouse("mouseMoved", from.x, from.y);
    await mouse("mousePressed", from.x, from.y);
    for (let step = 1; step <= 12; step++) await mouse("mouseMoved", from.x, from.y + ((y - from.y) * step) / 12);
    await mouse("mouseReleased", from.x, y);
    await parkPointer();
    await sleep(500);
  }
  async function press(key: string, modifiers = 0) {
    const named: Record<string, [string, number, string?]> = {
      Enter: ["Enter", 13, "\r"],
      ArrowDown: ["ArrowDown", 40],
      CtrlSpace: ["Space", 32],
    };
    const spec = named[key];
    if (key === "CtrlSpace") modifiers = 2;
    if (spec) {
      const name = key === "CtrlSpace" ? " " : key;
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: spec[0], windowsVirtualKeyCode: spec[1], modifiers });
      if (spec[2] && !modifiers) await send("Input.dispatchKeyEvent", { type: "char", key: name, text: spec[2] });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: spec[0], windowsVirtualKeyCode: spec[1], modifiers });
      return;
    }
    if (modifiers) {
      const code = `Key${key.toUpperCase()}`;
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0), modifiers });
      return;
    }
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key, unmodifiedText: key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key });
  }
  async function runQuery() {
    const before = await evaluate<string>(`document.querySelector('#group-results')?.innerText ?? ''`);
    await press("Enter", 4);
    await until(`(() => { const t = document.querySelector('#group-results')?.innerText ?? ''; return t !== ${JSON.stringify(before)} && /\\d+ rows? ·/.test(t) && !t.includes('Running'); })()`);
    await sleep(900);
  }
  // What the visible editor holds after a step, and what is drawn over it.
  async function editorState() {
    const state = await evaluate<{ doc: string; line: number; col: number; cursor: string; tooltip: string | null }>(`(() => {
      const v = ${VIEW};
      const head = v.state.selection.main.head;
      const line = v.state.doc.lineAt(head);
      const cursor = v.dom.querySelector('.cm-cursor');
      const tooltip = document.querySelector('.cm-tooltip-autocomplete');
      return {
        doc: v.state.doc.toString(), line: line.number, col: head - line.from,
        cursor: cursor ? cursor.style.left + ' ' + cursor.style.top : '',
        tooltip: tooltip ? tooltip.outerHTML : null,
      };
    })()`);
    return { ...state, tooltip: state.tooltip && prepare(state.tooltip) };
  }
  async function snapshot(name: string): Promise<Snapshot> {
    const { html, regions } = await evaluate<Snapshot>(`(() => {
      const regions = {};
      for (const [name, selector] of Object.entries(${JSON.stringify(REGIONS)})) {
        regions[name] = document.querySelector(selector)?.outerHTML ?? '';
      }
      return { html: document.body.querySelector(':scope > div').outerHTML, regions };
    })()`);
    await shot(name);
    writeFileSync(join(REF, `${name}.html`), scrub(html));
    return {
      html: scrub(html),
      regions: Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, prepare(v)])),
    };
  }
  async function styles() {
    return evaluate<{ href: string; runtime: string[] }>(`(() => ({
      href: document.querySelector('link[rel=stylesheet]').href,
      runtime: [...document.styleSheets].filter((s) => s.ownerNode && s.ownerNode.tagName === 'STYLE')
        .concat(document.adoptedStyleSheets)
        .flatMap((s) => [...s.cssRules].map((r) => r.cssText)),
    }))()`);
  }
  return { send, evaluate, until, navigate, shot, parkPointer, click, clickText, clickTab, clickLine, drag, press, runQuery, editorState, snapshot, styles, close: () => ws.close() };
}

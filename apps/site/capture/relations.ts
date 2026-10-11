// Records the real Relationship View for <perch-relations>: runs the built binary against the
// birdwatch database, opens the view in headless Chrome over the DevTools protocol, and writes
// what the element rebuilds it from — the dialog's markup, the icons its cards use and the schema
// they are drawn from.
//
//   bun apps/site/capture/relations.ts
//
// Environment, all optional: PGHOST, PGPORT, PGUSER, CAPTURE_DB (the database);
// RELATIONS_PORT, RELATIONS_CDP_PORT (default 4692, 9312); CHROME; CAPTURE_TMP (where the
// throwaway perch home, workspace and browser profile are made, default $TMPDIR); CAPTURE_REF
// (reference screenshots and the geometry the app drew, default $TMPDIR/perch-site-reference).

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const OUT = join(REPO, "apps/site/public/legacy/data/relations.json");
const QUERIES = join(import.meta.dir, "queries");
const PERCH = join(REPO, "apps/server/dist/perch");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.RELATIONS_PORT ?? 4692);
const CDP_PORT = Number(process.env.RELATIONS_CDP_PORT ?? 9312);
const REF = process.env.CAPTURE_REF ?? join(tmpdir(), "perch-site-reference");
const PG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.CAPTURE_DB ?? "perch_site_demo",
};

// The app's viewport. The window around it adds a 40px titlebar; the element renders the pair at
// exactly this size and scales. The view opens on whatever pan and zoom the app's fit lands on here
// (it measures the dialog mid-way through its opening scale, so 71.8%, not the settled 73.4%), and
// the element opens on the same numbers.
const WIDTH = Number(process.env.RELATIONS_WIDTH ?? 1280);
const HEIGHT = Number(process.env.RELATIONS_HEIGHT ?? 840);
const FOCUS = "public.sightings";

const run = mkdtempSync(join(process.env.CAPTURE_TMP ?? tmpdir(), "perch-relations-"));
const home = join(run, "home");
const workspace = join(run, "birdwatch");
const profile = join(run, "chrome");
for (const dir of [home, workspace, profile, REF]) mkdirSync(dir, { recursive: true });
for (const file of ["spring-migration.sql", "rare-sightings.sql", "busiest-sites.sql"]) {
  copyFileSync(join(QUERIES, file), join(workspace, file));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = `http://127.0.0.1:${PORT}`;

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

const replacements: [string, string][] = [];
for (const [path, shown] of [[workspace, "~/birdwatch"], [home, "~/.perch"]] as const) {
  replacements.push([realpathSync(path), shown], [path, shown]);
}
function scrub(text: string): string {
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text
    .replace(/\/(?:Users|home)\/[^/"'<>\s]+/g, "~")
    .replace(new RegExp(`\\b${userInfo().username}\\b`, "g"), "birder");
}

const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
  env: { ...process.env, PERCH_HOME: home },
  stdout: "ignore",
  stderr: "inherit",
});
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    "--window-size=1440,1000", "--force-device-scale-factor=2", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

// Geometry the app drew, read back for checking the rebuild against: where each card is, the
// pan and zoom, and every wire's path.
const GEOMETRY = `(() => {
  const canvas = document.querySelector('[data-slot=dialog-popup] .origin-top-left');
  const cards = {};
  for (const card of canvas.querySelectorAll(':scope > div')) {
    const name = card.querySelector('.font-medium').textContent;
    cards[name] = { x: parseFloat(card.style.getPropertyValue('--x')), y: parseFloat(card.style.getPropertyValue('--y')) };
  }
  const wires = [...canvas.querySelectorAll('svg > g')].map((g) => ({
    title: g.querySelector('title').textContent,
    d: [...g.querySelectorAll('path')].map((p) => p.getAttribute('d')),
    style: g.querySelector('[pathLength]')?.getAttribute('style') ?? null,
  }));
  return {
    pan: { x: parseFloat(canvas.style.getPropertyValue('--pan-x')), y: parseFloat(canvas.style.getPropertyValue('--pan-y')) },
    zoom: parseFloat(canvas.style.getPropertyValue('--zoom')),
    cards,
    wires,
  };
})()`;

try {
  await waitFor(`${api}/api/health`);
  await json("/api/connections", { method: "POST", body: JSON.stringify({ name: "birdwatch", dialect: "postgres", ...PG }) });
  await json("/api/settings", { method: "PUT", body: JSON.stringify({ onboarded: true, theme: "dark" }) });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

  const page = await cdp();
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 2, mobile: false });
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.navigate(api);
  await page.until(`!!document.querySelector('aside') && document.body.innerText.includes('species')`);
  await sleep(800);

  // The workspace behind the dialog is the one the hero shows: the three files open, the hero's tab
  // in front, the sidebar on the schema.
  await page.clickText("Files");
  await sleep(500);
  for (const file of ["spring-migration.sql", "rare-sightings.sql", "busiest-sites.sql", "spring-migration.sql"]) {
    await page.clickText(file);
    await sleep(500);
  }
  await page.clickText("Schema");
  await sleep(800);

  await page.evaluate(`window.dispatchEvent(new CustomEvent("perch:visualise", { detail: {} }))`);
  await page.until(`!!document.querySelector('[data-slot=dialog-popup] svg > g')`);
  await sleep(1200);
  const base = await page.snapshot("default");
  const geometry = await page.evaluate(GEOMETRY);
  writeFileSync(join(REF, "geometry.json"), JSON.stringify(geometry, null, 2));

  // A point on a card's header, where a press drags it.
  const cardCentre = (name: string) => page.evaluate<{ x: number; y: number }>(`(() => {
    const card = [...document.querySelectorAll('[data-slot=dialog-popup] .origin-top-left > div')]
      .find((c) => c.querySelector('.font-medium').textContent === ${JSON.stringify(name)});
    const r = card.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + 16 };
  })()`);

  const sightings = await cardCentre("sightings");
  await page.mouse("mouseMoved", sightings.x, sightings.y);
  await sleep(600);
  await page.snapshot("hover");
  await page.mouse("mousePressed", sightings.x, sightings.y);
  await page.mouse("mouseReleased", sightings.x, sightings.y);
  await page.mouse("mouseMoved", WIDTH - 40, HEIGHT - 60);
  await sleep(700);
  await page.snapshot("focus");
  writeFileSync(join(REF, "focus-geometry.json"), JSON.stringify(await page.evaluate(GEOMETRY), null, 2));
  // A press on the empty canvas clears the selection.
  await page.mouse("mousePressed", WIDTH - 40, HEIGHT - 60);
  await page.mouse("mouseReleased", WIDTH - 40, HEIGHT - 60);
  await sleep(600);

  // Mid-drag: species pulled down and right, held while the shot is taken.
  const species = await cardCentre("species");
  await page.mouse("mouseMoved", species.x, species.y);
  await page.mouse("mousePressed", species.x, species.y);
  for (let step = 1; step <= 12; step++) await page.mouse("mouseMoved", species.x + step * 6, species.y + step * 14);
  await sleep(400);
  await page.snapshot("drag");
  writeFileSync(join(REF, "drag-geometry.json"), JSON.stringify(await page.evaluate(GEOMETRY), null, 2));
  await page.mouse("mouseReleased", species.x + 72, species.y + 168);
  await sleep(300);
  await page.clickLabel("Reset layout");
  await sleep(800);

  // Keys-only, for the folded cards and the icons only they use.
  await page.clickText("Keys only");
  await sleep(900);
  const keys = await page.snapshot("keys");
  writeFileSync(join(REF, "keys-geometry.json"), JSON.stringify(await page.evaluate(GEOMETRY), null, 2));
  await page.evaluate(`(() => {
    const card = [...document.querySelectorAll('[data-slot=dialog-popup] .origin-top-left > div')]
      .find((c) => c.querySelector('.font-medium').textContent === 'species');
    card.querySelector('button').click();
  })()`);
  await sleep(600);
  const keysOpen = await page.snapshot("keys-open");

  const schema = await json(`/api/connections/birdwatch/schema`);
  const icons = { ...iconsFrom(base.popup), ...iconsFrom(keys.popup), ...iconsFrom(keysOpen.popup) };
  const keysButton = (html: string) => /<button[^>]*class="([^"]*)"[^>]*aria-pressed=/.exec(html)![1]!.replace(/&amp;/g, "&");

  const out = {
    width: WIDTH,
    height: HEIGHT,
    view: { pan: geometry.pan, zoom: geometry.zoom },
    workspace: prepareRoot(base.root),
    backdrop: base.backdrop,
    dialog: emptyCanvas(base.popup),
    keysOnly: { off: keysButton(base.popup), on: keysButton(keys.popup) },
    icons,
    tables: schema.schemas.flatMap((entry: any) =>
      entry.tables.map((table: any) => ({
        schema: table.schema,
        name: table.name,
        kind: table.kind,
        ...(table.rowEstimate === undefined ? {} : { rowEstimate: table.rowEstimate }),
        columns: table.columns.map(({ name, type, nullable, pk }: any) => ({ name, type, nullable, pk })),
        foreignKeys: table.foreignKeys.map(({ name, columns, refSchema, refTable, refColumns }: any) => ({
          name, columns, refSchema, refTable, refColumns,
        })),
      })),
    ),
    showSchema: schema.schemas.length > 1,
  };
  writeFileSync(OUT, scrub(JSON.stringify(out)));
  console.log(`wrote ${OUT}; reference screenshots and geometry in ${REF}`);
  page.close();
} finally {
  chrome.kill();
  perch.kill();
  await Promise.all([chrome.exited, perch.exited]);
  rmSync(run, { recursive: true, force: true });
}

// Every lucide icon the dialog draws, as its inner markup keyed by lucide name: the element wraps
// each in the same <svg> lucide renders, with the classes the use site gives it.
function iconsFrom(html: string): Record<string, string> {
  const icons: Record<string, string> = {};
  for (const [, name, inner] of html.matchAll(/<svg[^>]*class="lucide lucide-([\w-]+)[^"]*"[^>]*>(.*?)<\/svg>/g)) {
    icons[name!] ??= inner!;
  }
  return icons;
}

// The dialog with nothing on its canvas: the element draws the cards and wires itself.
function emptyCanvas(popup: string): string {
  const open = /<div class="absolute top-0 left-0 origin-top-left[^>]*>/.exec(popup)!;
  const start = open.index + open[0].length;
  let depth = 1;
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = start;
  for (let m; (m = tag.exec(popup)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return popup.slice(0, open.index) + open[0].replace(/ style="[^"]*"/, "") + popup.slice(m.index);
  }
  throw new Error("unbalanced dialog markup");
}

// The workspace under the backdrop, made inert: it sizes to the window instead of the viewport,
// and nothing in it can be edited or followed.
function prepareRoot(html: string): string {
  return html
    .replace(/\bh-svh\b/, "h-full")
    .replace(/contenteditable="true"/g, 'contenteditable="false"')
    .replace(/ href="[^"]*"/g, "")
    .replace(/ aria-describedby="DndDescribedBy-\d+"/g, "")
    .replace(/<div id="DndDescribedBy-\d+"[^>]*>.*?<\/div>|<div id="DndLiveRegion-\d+"[^>]*>.*?<\/div>/g, "");
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
  async function until(expression: string, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await evaluate(expression).catch(() => false)) return;
      await sleep(100);
    }
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(REF, "timeout.png"), Buffer.from(shot.data, "base64"));
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
  async function clickAt(x: number, y: number) {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
    await mouse("mouseMoved", WIDTH / 2, HEIGHT - 4);
  }
  async function clickText(text: string, scope = "body") {
    const point = await evaluate<{ x: number; y: number } | null>(`(() => {
      const hits = [...document.querySelectorAll(${JSON.stringify(scope)} + ' *')].filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === ${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0);
      const e = hits.at(-1);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing reads "${text}"`);
    await clickAt(point.x, point.y);
  }
  async function clickLabel(label: string) {
    const point = await evaluate<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('[aria-label=${JSON.stringify(label)}]').getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await clickAt(point.x, point.y);
  }
  async function snapshot(name: string) {
    const { root, popup, backdrop } = await evaluate<{ root: string; popup: string; backdrop: string }>(`(() => ({
      root: document.body.querySelector(':scope > div').outerHTML,
      popup: document.querySelector('[data-slot=dialog-popup]').outerHTML,
      backdrop: document.querySelector('[data-slot=dialog-backdrop]').outerHTML,
    }))()`);
    const shot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(REF, `${name}.png`), Buffer.from(shot.data, "base64"));
    writeFileSync(join(REF, `${name}.html`), scrub(popup));
    return { root: scrub(root), popup: scrub(popup), backdrop: scrub(backdrop) };
  }
  return { send, evaluate, until, navigate, mouse, clickText, clickLabel, snapshot, close: () => ws.close() };
}

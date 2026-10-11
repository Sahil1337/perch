// Records the eight crops for the page's "Also in the box" list: runs the built binary against the
// birdwatch database, drives it in headless Chrome over the DevTools protocol, and writes each state
// as a 4:3 WebP into apps/site/public/img/box-*.webp.
//
//   bun apps/site/capture/box.ts
//
// Same prerequisites as capture.ts (see README.md). Environment, all optional: PGHOST, PGPORT,
// PGUSER, CAPTURE_DB; BOX_PORT and BOX_CDP_PORT; CHROME; BOX_TMP for where the throwaway home,
// workspace and browser profile go (removed on exit); BOX_REF for full reference screenshots;
// BOX_ONLY=palette,errors,… to record a subset.

import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const OUT = join(REPO, "apps/site/public/img");
const QUERIES = join(import.meta.dir, "queries");
const PERCH = join(REPO, "apps/server/dist/perch");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.BOX_PORT ?? 4695);
const CDP_PORT = Number(process.env.BOX_CDP_PORT ?? 9317);
const TMP = process.env.BOX_TMP ?? tmpdir();
const REF = process.env.BOX_REF ?? join(TMP, "perch-box-reference");
const ONLY = process.env.BOX_ONLY?.split(",");
const PG = {
  host: process.env.PGHOST ?? "127.0.0.1",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.CAPTURE_DB ?? "perch_site_demo",
};
const WIDTH = 1440;
const HEIGHT = 900;
const SCALE = 2;
// Every crop is exported at this size, whatever region of the app it covers.
const EXPORT = { width: 1200, height: 900 };
const QUALITY = 82;
// The connection URL the hosted crop pastes: the local database, with no login in it.
const HOSTED_URL = `postgres://127.0.0.1:${PG.port}/${PG.database}`;

const FILES: Record<string, string> = {
  // The first statement's result leads with a text column: a crop that cannot reach the pane's
  // right edge still reads as a grid.
  "season-tally.sql": `-- The season so far
select region, count(*) as sites
from sites
group by region
order by sites desc;

select status, count(*) as species
from species
group by status;

select count(*) as checklists from checklists;
`,
  // Unqualified, so the server's position lands on the whole misspelled name. The lint tooltip
  // always opens above its line; on the first line that is over the tab strip, clear of the SQL.
  "migrants.sql": `select common_name, migrnt
from species
where status <> 'LC'
order by last_seen_at desc;
`,
  "observers.sql": `-- Who logged the most checklists
select o.name, count(*) as checklists
from checklists c
join observers o on o.id = c.observer_id
group by o.name
order by checklists desc;
`,
  "red-list.sql": `SELECT s.common_name,count(*) AS sightings FROM sightings g JOIN species s ON s.id=g.species_id WHERE s.status<>'LC' GROUP BY s.common_name ORDER BY sightings DESC LIMIT 5;
`,
};
const COPIED = ["spring-migration.sql", "rare-sightings.sql", "busiest-sites.sql"];
// Nothing from this machine may reach a crop: checked against the text the region shows.
const FORBIDDEN = [userInfo().username, hostname(), dirname(homedir()), TMP, realpathSync(TMP), "/var/folders", "localhost"];

type Rect = { x: number; y: number; width: number; height: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = `http://127.0.0.1:${PORT}`;
const wanted = (name: string) => !ONLY || ONLY.includes(name);
const temporary: string[] = [];
const written: string[] = [];

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
const profile = mkdtempSync(join(TMP, "perch-box-chrome-"));
temporary.push(profile);
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`, `--force-device-scale-factor=${SCALE}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

try {
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);
  const page = await cdp();
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false });

  // A fresh home: the first-run screen, the scan, and the paste-a-URL form.
  if (wanted("discover") || wanted("hosted")) {
    await withApp("first-run", { connect: false }, async () => {
      await page.until(`!!document.querySelector('[aria-label="Connect to a database"] li button')`, 20000);
      await sleep(2500);
      await page.parkPointer();
      const card = () => page.rect(`[aria-label="Connect to a database"] > div`);
      if (wanted("discover")) await page.crop("discover", fit(await card(), 40));
      if (wanted("hosted")) {
        await page.clickText("Paste a connection URL");
        await sleep(1200);
        await page.click(`[aria-label="Connect to a database"] input[placeholder^="postgres://"]`);
        await page.type(HOSTED_URL);
        await page.parkPointer();
        await sleep(1200);
        const box = await card();
        const top = await page.rectOfText("Paste a connection URL");
        const bottom = await page.rectOfText("Connect", "form");
        await page.crop("hosted", fit({ x: box.x, y: top.y, width: box.width, height: bottom.y + bottom.height - top.y }, 14));
        // The URL has to really work: press Connect and wait for the workspace.
        await page.clickText("Connect", "form");
        await page.until(`!document.querySelector('[aria-label="Connect to a database"]') && !!document.querySelector('aside')`, 20000);
        const [saved] = await json("/api/connections");
        const schema = await json(`/api/connections/${saved.id}/schema`);
        console.log(`hosted: saved ${saved.host}:${saved.port}/${saved.database}, schema has ${schema.schemas.flatMap((s: any) => s.tables).length} tables`);
      }
    });
  }

  if (["palette", "statement", "errors", "format", "export", "history"].some(wanted)) {
    await withApp("workspace", { connect: true }, async () => {
      if (wanted("palette")) {
        await page.press("k", 4);
        await page.until(`!!document.querySelector('[data-slot=command-dialog-popup] input')`);
        await sleep(400);
        await page.type("es");
        await sleep(900);
        await page.crop("palette", fit(await page.rect("[data-slot=command-dialog-popup]"), 32));
        await page.press("Escape");
        await sleep(500);
      }

      // Runs for History, in the order a person might have made them.
      for (const file of [...COPIED, "observers.sql"]) {
        await openFile(file);
        await page.clickLine(2);
        await page.runQuery();
      }

      // ⇧⌘↵ runs the whole file, and each statement in it gets a tab in the results.
      await openFile("season-tally.sql");
      const lines = await page.textRect(1, 12);
      await page.dragSplit(lines.y + lines.height + 14);
      await page.clickLine(8, 9);
      await page.runQuery(12);
      if (wanted("statement")) {
        await sleep(600);
        const text = await page.textRect(1, 11);
        const rows = await page.rects(`section[aria-label="Query results"] [role=row]`);
        const bottom = rows[3] ?? rows.at(-1)!;
        const height = bottom.y + bottom.height - text.y + 16;
        const width = Math.max(640, Math.round((height * 4) / 3));
        await page.crop("statement", { x: text.x - 1, y: Math.round(text.y - 10), width, height: Math.round((width * 3) / 4) });
      }

      // Before the failing run below, so nothing in the session has errored yet.
      if (wanted("format")) {
        await openFile("red-list.sql");
        await page.clickLine(1, 7);
        await page.contextMenu(1, 7);
        await page.clickText("Format document", "[role=menu]");
        await sleep(1000);
        // The formatted query still runs, so the rows below are its own.
        await page.clickLine(2);
        await page.runQuery();
        const text = await page.textRect(1, 9);
        // To the right of the text, so the menu (centred under the pointer) leaves the SQL readable.
        await page.contextMenuAt(text.x + text.width + 100, (await page.textRect(2, 2)).y + 10);
        await page.hoverText("Format document", "[role=menu]");
        await sleep(600);
        await page.crop("format", fit(union(text, await page.rect("[role=menu]")), 24, text.x - 1));
        await page.press("Escape");
        await sleep(400);
      }

      await openFile("migrants.sql");
      // Its tab alone, so the tooltip that rises over the tab strip hides no other file's name.
      await page.closeTabsExcept("migrants.sql");
      // The results just under the query, so the failed run's message fits in the crop too.
      const query = await page.textRect(1, 5);
      await page.dragSplit(query.y + query.height + 14);
      await page.clickLine(4, 4);
      await page.runQuery();
      if (wanted("errors")) {
        await page.until(`!!document.querySelector('.cm-lintRange-error')`);
        const mark = await page.rect(".cm-lintRange-error");
        await page.hover(mark.x + mark.width / 2, mark.y + mark.height - 3);
        await page.until(`!!document.querySelector('.cm-tooltip-hover')`);
        await sleep(600);
        const tip = await page.rect(".cm-tooltip-hover");
        const text = await page.textRect(1, 4);
        // The message block spans the pane; only its height counts, the crop cuts it on the right.
        const message = await page.rect(`section[aria-label="Query results"] [class*="border-destructive/32"]`);
        const content = union(union(text, tip), { ...message, width: 1 });
        // Clear of the connection picker, whose edge reaches a few pixels past the sidebar.
        await page.crop("errors", fit(content, 16, text.x + 6));
      }

      // Results docked left of the editor: one pane, the window's full height, beside the sidebar.
      if (wanted("history") || wanted("export")) await page.dragResultsBeside("left");

      if (wanted("history")) {
        await page.clickText("History", "aside");
        await sleep(800);
        await page.clickRun("-- Who logged the most checklists");
        await sleep(900);
        await page.click(`[aria-label="Show the whole query"]`);
        await sleep(700);
        await page.parkPointer();
        const tab = await page.rectOfText("History", "aside");
        const top = Math.round(tab.y - 12);
        const runs = await page.rects("aside button:has(.font-mono)");
        const rows = await page.rects(`section[aria-label="Query results"] [role=row]`);
        const bottom = Math.max(runs.at(-1)!.y + runs.at(-1)!.height, rows.at(-1)!.y + rows.at(-1)!.height) + 16;
        // The frame ends where the pane does: its width follows from the height the content needs.
        const width = Math.max(640, Math.round(((bottom - top) * 4) / 3));
        await page.dragDivider(width);
        await page.crop("history", { x: 0, y: top, width, height: Math.round((width * 3) / 4) });
      }

      if (wanted("export")) {
        await openFile("spring-migration.sql");
        await page.clickLine(2);
        await page.runQuery();
        const pane = `(() => { const r = document.querySelector('section[aria-label="Query results"]').closest('[id^="group-"]').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`;
        // The pane alone, its tab strip included, narrow enough that the header reads.
        await page.dragDivider((await page.evaluate<Rect>(pane)).x + 560);
        const link = `[aria-label="Export results as CSV"]`;
        // The link is the real download: say what it answers with before showing it.
        console.log(`export: ${await page.evaluate(`fetch(document.querySelector('${link}').href).then(async (r) => r.headers.get('content-type') + ' · ' + (await r.text()).split('\\n')[0])`)}`);
        const button = await page.rect(link);
        await page.hover(button.x + button.width / 2, button.y + button.height / 2);
        await sleep(600);
        const group = await page.evaluate<Rect>(pane);
        await page.crop("export", { x: group.x, y: group.y, width: group.width, height: Math.round((group.width * 3) / 4) });
      }
    });
  }

  for (const path of written) console.log(`${path}  ${(statSync(path).size / 1024).toFixed(1)} KB`);
  page.close();

  // A scene runs against its own server and an empty browser origin.
  async function withApp(name: string, opts: { connect: boolean }, body: () => Promise<void>) {
    const dir = mkdtempSync(join(TMP, `perch-box-${name}-`));
    temporary.push(dir);
    const home = join(dir, "home");
    const workspace = join(dir, "birdwatch");
    for (const path of [home, workspace]) mkdirSync(path, { recursive: true });
    for (const file of COPIED) copyFileSync(join(QUERIES, file), join(workspace, file));
    for (const [file, sql] of Object.entries(FILES)) writeFileSync(join(workspace, file), sql);
    const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
      env: { ...process.env, PERCH_HOME: home },
      stdout: "ignore",
      stderr: "inherit",
    });
    try {
      await waitFor(`${api}/api/health`);
      if (opts.connect) {
        await json("/api/connections", { method: "POST", body: JSON.stringify({ name: "birdwatch", dialect: "postgres", ...PG }) });
        await json("/api/settings", { method: "PUT", body: JSON.stringify({ onboarded: true, theme: "dark", workspaces: [workspace] }) });
      }
      await page.send("Storage.clearDataForOrigin", { origin: api, storageTypes: "all" });
      await page.navigate(api);
      if (opts.connect) await page.until(`!!document.querySelector('aside') && document.body.innerText.includes('species')`);
      await sleep(800);
      await body();
    } finally {
      perch.kill();
      await perch.exited;
    }
  }

  async function openFile(file: string) {
    await page.clickText("Files", "aside");
    await sleep(500);
    await page.clickText(file, "aside");
    await sleep(600);
    await page.clickText("Schema", "aside");
    await sleep(500);
  }
} finally {
  chrome.kill();
  await chrome.exited;
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true });
}

// A 4:3 region `width` wide, centred on `r` (shifted by dy), kept inside the viewport.
function around(r: Rect, width: number, { dy = 0 } = {}): Rect {
  const height = Math.round((width * 3) / 4);
  const x = Math.round(Math.min(Math.max(r.x + r.width / 2 - width / 2, 0), WIDTH - width));
  const y = Math.round(Math.min(Math.max(r.y + r.height / 2 - height / 2 + dy, 0), HEIGHT - height));
  return { x, y, width, height };
}

// The smallest 4:3 region holding `r` with `pad` around it, centred on it, or starting at `left`.
function fit(r: Rect, pad: number, left?: number): Rect {
  if (left === undefined) return around(r, Math.round(Math.max(r.width + 2 * pad, ((r.height + 2 * pad) * 4) / 3)));
  const width = Math.round(Math.max(r.x + r.width + pad - left, ((r.height + 2 * pad) * 4) / 3));
  const centred = around(r, width);
  return { ...centred, x: Math.round(left) };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
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

  // The scan reports the OS login so the found row can name it; the crop shows the address alone,
  // the way the row reads when no login is known.
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/discover*", requestStage: "Response" }] });
  listeners.push(async (m) => {
    if (m.method !== "Fetch.requestPaused") return;
    const { requestId } = m.params;
    const { body, base64Encoded } = await send("Fetch.getResponseBody", { requestId });
    const result = JSON.parse(base64Encoded ? Buffer.from(body, "base64").toString() : body);
    result.osUser = "";
    for (const server of result.servers ?? []) {
      const url = new URL(server.suggestedUrl);
      url.username = "";
      server.suggestedUrl = url.toString();
    }
    await send("Fetch.fulfillRequest", {
      requestId,
      responseCode: m.params.responseStatusCode,
      responseHeaders: m.params.responseHeaders,
      body: Buffer.from(JSON.stringify(result)).toString("base64"),
    });
  });

  async function evaluate<T = any>(expression: string): Promise<T> {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async function shot(name: string) {
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
  // `held` is the buttons mask during a move, for drags.
  async function mouse(type: string, x: number, y: number, button = "left", held = 0) {
    await send("Input.dispatchMouseEvent", {
      type, x, y, clickCount: type === "mouseMoved" ? 0 : 1,
      button: type === "mouseMoved" ? (held ? button : "none") : button,
      buttons: type === "mousePressed" ? (button === "right" ? 2 : 1) : held,
    });
  }
  async function hover(x: number, y: number) {
    // Arrive the way a pointer does, so hover intent and :hover both see a move.
    await mouse("mouseMoved", x - 12, y - 6);
    await sleep(60);
    await mouse("mouseMoved", x, y);
  }
  // On the status bar, where no hover style lands.
  async function parkPointer() {
    await mouse("mouseMoved", WIDTH / 2, HEIGHT - 4);
  }
  async function clickAt(x: number, y: number) {
    await mouse("mouseMoved", x, y);
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
  }
  async function rect(selector: string): Promise<Rect> {
    const r = await evaluate<Rect | null>(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.getBoundingClientRect().width > 0 && e.checkVisibility({ visibilityProperty: true })); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    if (!r) throw new Error(`no ${selector}`);
    return r;
  }
  async function rectOfText(text: string, scope = "body"): Promise<Rect> {
    const r = await evaluate<Rect | null>(`(() => {
      const hits = [...document.querySelectorAll(${JSON.stringify(scope)} + ' *, ' + ${JSON.stringify(scope)})].filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === ${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0 && e.checkVisibility({ visibilityProperty: true }));
      const e = hits.at(-1);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    })()`);
    if (!r) throw new Error(`nothing reads "${text}"`);
    return r;
  }
  async function rects(selector: string): Promise<Rect[]> {
    return evaluate<Rect[]>(`[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e => e.checkVisibility({ visibilityProperty: true })).map(e => e.getBoundingClientRect()).filter(r => r.width > 0).map(r => ({ x: r.x, y: r.y, width: r.width, height: r.height }))`);
  }
  // Lines `from`–`to` of the visible editor as drawn, from the gutter's left edge to the longest line.
  async function textRect(from: number, to: number, tries = 10): Promise<Rect> {
    // A view that just swapped documents can be a frame behind its state; ask again.
    for (let i = 1; ; i++) {
      try {
        return await textRectOnce(from, to);
      } catch (error) {
        if (i >= tries) throw error;
        await sleep(200);
      }
    }
  }
  async function textRectOnce(from: number, to: number): Promise<Rect> {
    return evaluate<Rect>(`(() => {
      const e = [...document.querySelectorAll('.cm-content')].find(e => e.checkVisibility({ visibilityProperty: true }));
      const v = (e.cmTile ?? e.cmView).view;
      const left = v.dom.querySelector('.cm-gutters').getBoundingClientRect().left;
      let top = Infinity, right = 0, bottom = 0;
      for (let n = ${from}; n <= Math.min(${to}, v.state.doc.lines); n++) {
        const line = v.state.doc.line(n);
        const a = v.coordsAtPos(line.from), b = v.coordsAtPos(line.to);
        top = Math.min(top, a.top); bottom = Math.max(bottom, b.bottom); right = Math.max(right, b.right);
      }
      return { x: left, y: top, width: right - left, height: bottom - top };
    })()`);
  }
  async function drag(from: { x: number; y: number }, to: { x: number; y: number }, steps = 16) {
    await mouse("mouseMoved", from.x, from.y);
    await mouse("mousePressed", from.x, from.y);
    for (let step = 1; step <= steps; step++) {
      await mouse("mouseMoved", from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps, "left", 1);
      await sleep(16);
    }
    await sleep(200);
    await mouse("mouseReleased", to.x, to.y);
    await parkPointer();
    await sleep(700);
  }
  // The handle between the editor and the results, dragged to `y`.
  async function dragSplit(y: number) {
    const handle = await evaluate<Rect>(`(() => { const r = document.querySelector('#group-results').previousElementSibling.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    const x = handle.x + handle.width / 2;
    await drag({ x, y: handle.y + handle.height / 2 }, { x, y });
  }
  // The Results tab, dropped on one edge of the editor's pane: the two then sit side by side.
  async function dragResultsBeside(edge: "left" | "right") {
    const tab = await rectOfText("Results", "#group-results");
    const editor = await rect(".cm-editor");
    const x = edge === "left" ? editor.x + 24 : editor.x + editor.width - 24;
    await drag({ x: tab.x + tab.width / 2, y: tab.y + tab.height / 2 }, { x, y: editor.y + editor.height / 2 }, 24);
  }
  // With the results docked left of the editor, the rule between the two, dragged to `x`.
  async function dragDivider(x: number) {
    // The drop gives the results group a new id; the editor's group keeps its own.
    const handle = await evaluate<Rect>(`(() => { const r = document.querySelector('#group-editor').previousElementSibling.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    const y = handle.y + handle.height / 2;
    await drag({ x: handle.x + handle.width / 2, y }, { x, y });
  }
  // Closes every editor tab but `keep`'s, through each tab's own close button.
  async function closeTabsExcept(keep: string) {
    for (let i = 0; i < 12; i++) {
      const r = await evaluate<Rect | null>(`(() => { const b = [...document.querySelectorAll('#group-editor [aria-label^="Close "]')].find((b) => b.getAttribute('aria-label') !== ${JSON.stringify(`Close ${keep}`)}); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
      if (!r) return;
      await hover(r.x + r.width / 2, r.y + r.height / 2);
      await clickAt(r.x + r.width / 2, r.y + r.height / 2);
      await sleep(400);
    }
    throw new Error(`tabs other than ${keep} would not close`);
  }
  async function click(selector: string) {
    const r = await rect(selector);
    await clickAt(r.x + r.width / 2, r.y + r.height / 2);
  }
  async function clickText(text: string, scope = "body") {
    const r = await rectOfText(text, scope);
    await clickAt(r.x + r.width / 2, r.y + r.height / 2);
    await parkPointer();
  }
  async function hoverText(text: string, scope = "body") {
    const r = await rectOfText(text, scope);
    await hover(r.x + r.width / 2, r.y + r.height / 2);
  }
  // The History row whose query starts with `first`.
  async function clickRun(first: string) {
    const r = await evaluate<Rect>(`(() => { const e = [...document.querySelectorAll('aside button')].find(b => b.querySelector('.font-mono')?.textContent === ${JSON.stringify(first)}); const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
    await clickAt(r.x + r.width / 2, r.y + r.height / 2);
  }
  async function linePoint(line: number, col = -1) {
    return evaluate<{ x: number; y: number }>(`(() => {
      const e = [...document.querySelectorAll('.cm-content')].find(e => e.checkVisibility({ visibilityProperty: true }));
      const v = (e.cmTile ?? e.cmView).view;
      const l = v.state.doc.line(${line});
      const r = v.coordsAtPos(${col} < 0 ? l.from : l.from + ${col});
      return { x: r.left + ${col < 0 ? 4 : 1}, y: (r.top + r.bottom) / 2 };
    })()`);
  }
  async function clickLine(line: number, col = -1) {
    const p = await linePoint(line, col);
    await clickAt(p.x, p.y);
    await parkPointer();
  }
  async function contextMenu(line: number, col: number) {
    const p = await linePoint(line, col);
    await contextMenuAt(p.x, p.y);
  }
  async function contextMenuAt(x: number, y: number) {
    const p = { x, y };
    await mouse("mouseMoved", p.x, p.y);
    await mouse("mousePressed", p.x, p.y, "right");
    await mouse("mouseReleased", p.x, p.y, "right");
    await until(`!!document.querySelector('[role=menu]')`);
    await sleep(400);
  }
  async function press(key: string, modifiers = 0) {
    const named: Record<string, [string, number, string?]> = {
      Enter: ["Enter", 13, "\r"],
      Escape: ["Escape", 27],
    };
    const spec = named[key];
    if (spec) {
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code: spec[0], windowsVirtualKeyCode: spec[1], modifiers });
      if (spec[2] && !modifiers) await send("Input.dispatchKeyEvent", { type: "char", key, text: spec[2] });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: spec[0], windowsVirtualKeyCode: spec[1], modifiers });
      return;
    }
    const code = `Key${key.toUpperCase()}`;
    const vk = key.toUpperCase().charCodeAt(0);
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  async function type(text: string) {
    for (const ch of text) {
      await send("Input.insertText", { text: ch });
      await sleep(40);
    }
  }
  // ⌘↵ runs the statement at the caret; ⇧⌘↵ (modifiers 12) the whole file.
  async function runQuery(modifiers = 4) {
    const before = await evaluate<string>(`document.querySelector('section[aria-label="Query results"]')?.innerText ?? ''`);
    await press("Enter", modifiers);
    await until(`(() => { const t = document.querySelector('section[aria-label="Query results"]')?.innerText ?? ''; return t !== ${JSON.stringify(before)} && !t.includes('Running'); })()`);
    await sleep(1000);
  }
  // Writes one crop: the region, rendered at the export size, after checking what it shows.
  async function crop(name: string, area: Rect) {
    // A width divisible by 4 keeps the height whole, so the export lands on exactly 1200×900.
    const width = Math.round(area.width / 4) * 4;
    const region = { x: Math.round(area.x), y: Math.round(area.y), width, height: (width * 3) / 4 };
    const leaks = await evaluate<string[]>(`(() => {
      const region = ${JSON.stringify(region)};
      const inside = (r) => r.width > 0 && r.right > region.x && r.x < region.x + region.width && r.bottom > region.y && r.y < region.y + region.height;
      const seen = [];
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(n);
        if ([...range.getClientRects()].some(inside)) seen.push(n.nodeValue);
      }
      for (const input of document.querySelectorAll('input, textarea')) {
        if (inside(input.getBoundingClientRect())) seen.push(input.value || input.placeholder);
      }
      return seen;
    })()`);
    const text = leaks.join("\n");
    writeFileSync(join(REF, `${name}.txt`), text);
    const hit = FORBIDDEN.find((word) => text.toLowerCase().includes(word.toLowerCase()));
    if (hit) throw new Error(`${name}: the region shows "${hit}"`);
    await shot(name);
    const r = await send("Page.captureScreenshot", {
      format: "webp",
      quality: QUALITY,
      clip: { ...region, scale: EXPORT.width / region.width / SCALE },
      captureBeyondViewport: false,
    });
    const path = join(OUT, `box-${name}.webp`);
    writeFileSync(path, Buffer.from(r.data, "base64"));
    written.push(path);
  }
  return {
    send, evaluate, until, navigate, shot, parkPointer, hover, click, clickText, hoverText, clickRun,
    clickLine, contextMenu, contextMenuAt, press, type, runQuery, rect, rects, rectOfText, textRect, dragSplit,
    dragResultsBeside, dragDivider, closeTabsExcept, crop, close: () => ws.close(),
  };
}

// Records what the landing page's Relationship View and Query Walk replay: runs the built perch
// against the birdwatch database, drives the real app in headless Chrome over the DevTools
// protocol, and keeps every API exchange the two surfaces made. The walk is played to the end, then
// stepped back and forth phase by phase and seeked from every rail station, so whatever a visitor can
// do to the walk on the page asks only questions that were asked here.
//
//   bun apps/site/scripts/record-walk.ts
//
// Needs apps/server/dist/perch (`bun run build`), the perch_site_demo database loaded from
// apps/site/capture/birdwatch.sql, and Google Chrome. Environment, all optional: PGHOST, PGPORT, PGUSER,
// RECORD_DB; RECORD_WALK_PORT and RECORD_WALK_CDP_PORT (default 4697 and 9322); CHROME; RECORD_TMP
// for where the throwaway perch home, workspace and browser profile go (removed on exit);
// RECORD_REF to also keep reference screenshots of the real app there.
//
// Writes src/shared/replay/fixtures/walk.json: every probe the walk sent, once each, as the replay's
// `Recording`s (see src/shared/replay/README.md). The schema the Relationship View draws is the one
// in birdwatch.json, recorded by record.ts from the same database.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import type { RunRecord } from "@perch/protocol";
import { normaliseSql } from "../src/shared/replay/normalise";
import type { Recording } from "../src/shared/replay/types";

const SITE = resolve(import.meta.dir, "..");
const REPO = resolve(SITE, "../..");
const OUT = join(SITE, "src/shared/replay/fixtures");
const PERCH = join(REPO, "apps/server/dist/perch");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.RECORD_WALK_PORT ?? 4697);
const CDP_PORT = Number(process.env.RECORD_WALK_CDP_PORT ?? 9322);
const REF = process.env.RECORD_REF;
const PG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.RECORD_DB ?? "perch_site_demo",
};

// The two scenes' app areas, the sizes the legacy scenes were captured at: the page draws each
// window at exactly this size under a 40px titlebar, and scales.
const RELATIONS = { width: 1280, height: 840 };
const WALK = { width: 1280, height: 760 };
const DPR = 2;

const WALK_SQL = `select f.name as family, count(*) as migrants
from species s
join families f on f.id = s.family_id
where s.migrant
group by f.name
having count(*) > 1
order by migrants desc, family
limit 4;`;

const run = mkdtempSync(join(process.env.RECORD_TMP ?? tmpdir(), "perch-record-walk-"));
const home = join(run, "home");
const workspace = join(run, "birdwatch");
const profile = join(run, "chrome");
for (const dir of [home, workspace, profile]) mkdirSync(dir, { recursive: true });
if (REF) mkdirSync(REF, { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = `http://127.0.0.1:${PORT}`;

// Nothing from this machine may reach a fixture: its paths, its login, its name.
const replacements: [string, string][] = [];
for (const [path, shown] of [[workspace, "~/birdwatch"], [home, "~/.perch"], [run, "~"]] as const) {
  replacements.push([realpathSync(path), shown], [path, shown]);
}
function scrub(text: string): string {
  for (const [from, to] of replacements) text = text.split(from).join(to);
  const login = userInfo().username;
  return text
    .replace(/\/(?:Users|home|private|var\/folders)\/[^"'<>\s]+/g, "~")
    .replace(new RegExp(`\\b${login}\\b`, "g"), "birder")
    .replace(new RegExp(hostname().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), "localhost");
}

async function waitFor(url: string, tries = 150) {
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

type Exchange = {
  method: string;
  url: string;
  body?: string;
  status?: number;
  response?: string;
  done: boolean;
};

const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
  env: { ...process.env, PERCH_HOME: home },
  stdout: "ignore",
  stderr: "inherit",
});
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    "--window-size=1440,900", `--force-device-scale-factor=${DPR}`, "--no-first-run",
    "--no-default-browser-check", "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

try {
  await waitFor(`${api}/api/health`);
  await json("/api/connections", {
    method: "POST",
    body: JSON.stringify({ name: "birdwatch", dialect: "postgres", ...PG }),
  });
  await json("/api/settings", { method: "PUT", body: JSON.stringify({ onboarded: true, theme: "dark" }) });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

  const page = await cdp();
  const errors: string[] = [];
  const exchanges = new Map<string, Exchange>();
  page.on((m) => {
    if (m.method === "Runtime.exceptionThrown") {
      errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      errors.push(m.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description).join(" "));
    }
    if (m.method === "Network.requestWillBeSent") {
      const { requestId, request } = m.params;
      if (!new URL(request.url).pathname.startsWith("/api/")) return;
      exchanges.set(requestId, { method: request.method, url: request.url, body: request.postData, done: false });
    }
    if (m.method === "Network.responseReceived") {
      const exchange = exchanges.get(m.params.requestId);
      if (exchange) exchange.status = m.params.response.status;
    }
    if (m.method === "Network.loadingFinished") {
      const exchange = exchanges.get(m.params.requestId);
      if (!exchange) return;
      page
        .send("Network.getResponseBody", { requestId: m.params.requestId })
        .then((r) => {
          exchange.response = r.base64Encoded ? Buffer.from(r.body, "base64").toString("utf8") : r.body;
        })
        .catch(() => {})
        .finally(() => (exchange.done = true));
    }
  });
  await page.send("Network.enable", { maxPostDataSize: 1 << 20 });
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.size(RELATIONS);
  await page.navigate(api);
  await page.until(`!!document.querySelector('aside') && document.body.innerText.includes('sightings')`, 20000);
  await sleep(800);

  // The Relationship View, opened the way the sidebar button opens it.
  await page.evaluate(`window.dispatchEvent(new CustomEvent("perch:visualise", { detail: {} }))`);
  await page.until(`document.querySelectorAll('[data-slot=dialog-popup] .w-64.rounded-lg').length >= 6`, 15000);
  await sleep(1500);
  if (REF) {
    await page.screenshot(join(REF, "relations-app.png"));
    const geometry = await page.evaluate(`(() => {
      const popup = document.querySelector('[data-slot=dialog-popup]').getBoundingClientRect();
      const cards = [...document.querySelectorAll('[data-slot=dialog-popup] .w-64.rounded-lg')].map((card) => {
        const r = card.getBoundingClientRect();
        return { name: card.querySelector('.truncate')?.textContent, x: r.x - popup.x, y: r.y - popup.y, w: r.width, h: r.height };
      });
      return { popup: { w: popup.width, h: popup.height }, zoom: document.querySelector('[data-slot=dialog-popup] header .w-10')?.textContent, cards };
    })()`);
    writeFileSync(join(REF, "relations-app.json"), `${JSON.stringify(geometry, null, 2)}\n`);
  }
  await page.evaluate(`document.querySelector('[data-slot=dialog-popup] button[aria-label="Close"]').click()`);
  await page.until(`!document.querySelector('[data-slot=dialog-popup]')`, 5000);

  // The walk, played by itself to the end, as the page autoplays it.
  await page.size(WALK);
  const station = `document.querySelector('nav[aria-label="Stations"] [aria-current="step"]')?.getAttribute('aria-label') ?? null`;
  const playLabel = `document.querySelector('[role="toolbar"][aria-label="Playback"] button:nth-child(2)')?.getAttribute('aria-label') ?? null`;
  await page.evaluate(`(() => {
    const marks = (window.__marks = []);
    let last;
    new MutationObserver(() => {
      const s = ${station};
      const p = ${playLabel};
      const key = s + '|' + p;
      if (key !== last) marks.push({ station: s, play: p, at: performance.now() });
      last = key;
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-label'] });
  })()`);
  await page.evaluate(`window.dispatchEvent(new CustomEvent("perch:visualise-query", { detail: { sql: ${JSON.stringify(WALK_SQL)} } }))`);
  await page.until(`window.__marks.some((m) => m.play === 'Pause')`, 20000);
  const shot = new Set<string>();
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const now = await page.evaluate<{ station: string | null; play: string | null }>(`({ station: ${station}, play: ${playLabel} })`);
    if (REF && now.station && !shot.has(now.station)) {
      shot.add(now.station);
      await sleep(1600);
      await page.screenshot(join(REF, `walk-app-${now.station.toLowerCase().replace(/\W+/g, "-")}.png`));
    }
    if (now.play === "Play") break;
    await sleep(150);
  }
  const played = await page.evaluate<{ station: string | null; play: string | null; at: number }[]>(`window.__marks`);

  // Stepping: back to the first phase of FROM, forward to the answer, then a seek from every station.
  const backDisabled = `document.querySelector('[role="toolbar"][aria-label="Playback"] button:nth-child(1)').disabled`;
  const forwardDisabled = `document.querySelector('[role="toolbar"][aria-label="Playback"] button:nth-child(3)').disabled`;
  let steps = 0;
  while (!(await page.evaluate<boolean>(backDisabled)) && steps++ < 200) {
    await page.key("ArrowLeft");
    await sleep(120);
  }
  steps = 0;
  while (!(await page.evaluate<boolean>(forwardDisabled)) && steps++ < 200) {
    await page.key("ArrowRight");
    await sleep(250);
  }
  const stations = await page.evaluate<string[]>(
    `[...document.querySelectorAll('nav[aria-label="Stations"] button')].map((b) => b.getAttribute('aria-label'))`,
  );
  for (let i = 0; i < stations.length; i++) {
    await page.evaluate(`document.querySelectorAll('nav[aria-label="Stations"] button')[${i}].click()`);
    await sleep(500);
  }
  await page.evaluate(`document.querySelector('[role="toolbar"][aria-label="Playback"] button[aria-label^="Speed"]').click()`);
  await sleep(300);
  await page.evaluate(`document.querySelector('[role="toolbar"][aria-label="Playback"] button[aria-label^="Speed"]').click()`);
  await sleep(1500);

  const pending = Date.now() + 10_000;
  while ([...exchanges.values()].some((e) => !e.done && !e.url.includes("/api/events")) && Date.now() < pending) {
    await sleep(100);
  }
  page.close();
  if (errors.length) console.warn(`console errors in the app while recording:\n  ${errors.join("\n  ")}`);

  const all = [...exchanges.values()];
  const parse = (text: string | undefined) => (text ? JSON.parse(scrub(text)) : undefined);

  // Every probe the walk sent, once each, in the order it first asked, as replay Recordings.
  const recordings: Recording[] = [];
  const seen = new Set<string>();
  for (const e of all) {
    if (e.method !== "POST" || !e.url.endsWith("/api/query/sync") || !e.body) continue;
    if (e.status !== 200 || !e.response) throw new Error(`a probe came back ${e.status}: ${e.body}`);
    const body = JSON.parse(e.body) as { sql: string; maxRows?: number; readOnly?: boolean; record?: boolean };
    if (!body.readOnly || body.record !== false) continue;
    const key = normaliseSql(body.sql);
    if (seen.has(key)) continue;
    seen.add(key);
    const record = parse(e.response) as RunRecord;
    record.id = `walk-${recordings.length + 1}`;
    recordings.push({
      key,
      kind: "probe",
      scene: "walk",
      request: { sql: scrub(body.sql), maxRows: body.maxRows, readOnly: true, record: false },
      record,
    });
  }
  if (recordings.length === 0) throw new Error("the walk sent no probes");

  mkdirSync(OUT, { recursive: true });
  const text = `${JSON.stringify(recordings, null, 2)}\n`;
  writeFileSync(join(OUT, "walk.json"), text);

  const visited = [...new Set(played.map((m) => m.station).filter(Boolean))];
  console.log(`played through: ${visited.join(" → ")}`);
  console.log(`rail: ${stations.join(", ")}`);
  console.log(`${recordings.length} probes → walk.json (${text.length} B)`);
} finally {
  chrome.kill();
  perch.kill();
  await Promise.all([chrome.exited, perch.exited]);
  rmSync(run, { recursive: true, force: true });
}

async function cdp() {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const target = targets.find((t: { type: string }) => t.type === "page");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.onopen = r;
    ws.onerror = j;
  });
  let next = 0;
  const waiting = new Map<number, [(v: any) => void, (e: Error) => void]>();
  const listeners: ((m: any) => void)[] = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    const waiter = waiting.get(msg.id);
    if (waiter) {
      waiting.delete(msg.id);
      if (msg.error) waiter[1](new Error(JSON.stringify(msg.error)));
      else waiter[0](msg.result);
    } else for (const listener of listeners) listener(msg);
  };
  const send = (method: string, params: object = {}) =>
    new Promise<any>((res, rej) => {
      const i = ++next;
      waiting.set(i, [res, rej]);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");

  async function evaluate<T = unknown>(expression: string): Promise<T> {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  const keys: Record<string, { code: string; keyCode: number }> = {
    Escape: { code: "Escape", keyCode: 27 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
  };

  return {
    send,
    evaluate,
    on: (listener: (m: any) => void) => listeners.push(listener),
    close: () => ws.close(),
    async navigate(url: string) {
      await send("Page.navigate", { url });
      await sleep(300);
    },
    async size({ width, height }: { width: number; height: number }) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: DPR, mobile: false });
    },
    async until(expression: string, timeout = 10000) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (await evaluate<boolean>(expression).catch(() => false)) return;
        await sleep(100);
      }
      throw new Error(`timed out waiting for ${expression}`);
    },
    async key(key: string) {
      const { code, keyCode } = keys[key]!;
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: keyCode });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode });
    },
    async screenshot(path: string) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(path, Buffer.from(data, "base64"));
    },
  };
}

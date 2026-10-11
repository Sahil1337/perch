// Records Query Walk for <perch-walk>: runs the built binary against the birdwatch database, opens
// the walk on walk.sql in headless Chrome, screencasts it at device scale 2, and encodes the frames
// on their real timestamps. While it plays, the rail's active station is read off the DOM, so the
// clause times in walk.json are the app's own, on the encoded video's clock.
//
//   bun apps/site/capture/walk.ts
//
// Writes assets/clips/walk.{mp4,webm,webp}, walk-small.mp4 (phones and 1x screens) and
// assets/data/walk.json. Prerequisites as in README.md, plus ffmpeg with libx264 and libsvtav1.
// Environment, all optional: WALK_PORT, WALK_CDP_PORT, WALK_CRF_H264, WALK_CRF_AV1, and WALK_WORK
// to keep the captured frames and the lossless master in that directory.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../../..");
const ASSETS = join(REPO, "apps/site/public/legacy");
const PERCH = join(REPO, "apps/server/dist/perch");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.WALK_PORT ?? 4693);
const CDP_PORT = Number(process.env.WALK_CDP_PORT ?? 9313);
const PG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.CAPTURE_DB ?? "perch_site_demo",
};

// The same app size <perch-workspace> replays, so the two windows share one scale on the page.
const WIDTH = 1280;
const HEIGHT = 760;
const DPR = 2;
const FPS = 60;
// How long the clip rests on the answer, then how long it takes to dissolve back into frame one.
const HOLD_S = 2.4;
const FADE_S = 0.7;
// The FROM card lands this long before the clip starts, so frame one is settled rather than empty.
const LEAD_S = 0.8;

const SQL = readFileSync(join(import.meta.dir, "walk.sql"), "utf8").trim();
const RAIL = "FROM JOIN WHERE GROUP_BY HAVING WINDOW SELECT DISTINCT ORDER_BY LIMIT".split(" ").map((c) => c.replace("_", " "));

// WALK_WORK keeps the frames for inspection; otherwise everything lives in a temp dir that goes.
const given = process.env.WALK_WORK;
const work = given ?? mkdtempSync(join(tmpdir(), "perch-walk-"));
const home = join(work, "home");
const workspace = join(work, "birdwatch");
const profile = join(work, "chrome");
const frames = join(work, "frames");
for (const dir of [home, workspace, profile, frames]) mkdirSync(dir, { recursive: true });
writeFileSync(join(workspace, "walk.sql"), `${SQL}\n`);

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

function ffmpeg(args: string[]) {
  const r = Bun.spawnSync(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`ffmpeg ${args.join(" ")}\n${r.stderr.toString()}`);
}

const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
  env: { ...process.env, PERCH_HOME: home },
  stdout: "ignore",
  stderr: "inherit",
});
const chrome = Bun.spawn(
  [CHROME, "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
    "--window-size=1440,900", `--force-device-scale-factor=${DPR}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "about:blank"],
  { stdout: "ignore", stderr: "ignore" },
);

type Frame = { file: string; ts: number };
type Mark = { kind: "station" | "play" | "flash"; label: string | null; at: number };

try {
  await waitFor(`${api}/api/health`);
  await json("/api/connections", { method: "POST", body: JSON.stringify({ name: "birdwatch", dialect: "postgres", ...PG }) });
  await json("/api/settings", { method: "PUT", body: JSON.stringify({ onboarded: true, theme: "dark" }) });
  await waitFor(`http://127.0.0.1:${CDP_PORT}/json/version`);

  const page = await cdp();
  const errors: string[] = [];
  page.on((m) => {
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a: any) => a.value ?? a.description).join(" "));
  });
  await page.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: DPR, mobile: false });
  await page.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await page.navigate(api);
  await page.until(`!!document.querySelector('aside') && document.body.innerText.includes('species')`);
  await sleep(800);
  await page.clickText("Files");
  await sleep(400);
  await page.clickText("walk.sql");
  await sleep(400);
  await page.clickText("Schema");
  await sleep(1200);

  // The DOM's clock and the screencast's are both wall time, but a mutation reaches the screen a
  // frame or two after it happens. A full-screen flash measures that lag, so the station times
  // written below are when the change was SEEN, which is what the video shows.
  await page.evaluate(`(() => {
    const marks = (window.__walkMarks = []);
    const now = () => performance.timeOrigin + performance.now();
    let station, play;
    const read = () => {
      const s = document.querySelector('nav[aria-label="Stations"] [aria-current="step"]')?.getAttribute('aria-label') ?? null;
      const g = document.querySelector('[role="toolbar"][aria-label="Playback"] button:nth-child(2)')?.getAttribute('aria-label') ?? null;
      const at = now();
      if (s !== station) marks.push({ kind: 'station', label: (station = s), at });
      if (g !== play) marks.push({ kind: 'play', label: (play = g), at });
    };
    new MutationObserver(read).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-current', 'aria-label'] });
    window.__walkFlash = (on) => {
      let el = document.getElementById('walk-flash');
      if (on) {
        el = document.createElement('div');
        el.id = 'walk-flash';
        el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#ff00ff';
        document.body.append(el);
      } else el?.remove();
      marks.push({ kind: 'flash', label: on ? 'on' : 'off', at: now() });
    };
  })()`);

  const captured: Frame[] = [];
  const writes: Promise<number>[] = [];
  page.on((m) => {
    if (m.method !== "Page.screencastFrame") return;
    const { data, metadata, sessionId } = m.params;
    page.send("Page.screencastFrameAck", { sessionId });
    const file = join(frames, `f${String(captured.length).padStart(5, "0")}.png`);
    captured.push({ file, ts: metadata.timestamp * 1000 });
    writes.push(Bun.write(file, Buffer.from(data, "base64")));
  });
  await page.send("Page.startScreencast", { format: "png", maxWidth: WIDTH * DPR, maxHeight: HEIGHT * DPR, everyNthFrame: 1 });
  await sleep(600);
  await page.evaluate(`__walkFlash(true)`);
  await sleep(400);
  await page.evaluate(`__walkFlash(false)`);
  await sleep(600);

  await page.evaluate(`window.dispatchEvent(new CustomEvent("perch:visualise-query", { detail: { sql: ${JSON.stringify(SQL)} } }))`);
  // Playback starts by itself; it is over when the primary control goes back to Play.
  await page.until(`window.__walkMarks.some((m) => m.kind === 'play' && m.label === 'Pause')`, 20000);
  await page.until(`(() => { const m = window.__walkMarks.filter((m) => m.kind === 'play'); return m.at(-1).label === 'Play' && m.at(-2)?.label === 'Pause'; })()`, 90000);
  await sleep((HOLD_S + FADE_S + 1) * 1000);
  await page.send("Page.stopScreencast");
  await sleep(300);
  await Promise.all(writes);
  const marks: Mark[] = await page.evaluate(`window.__walkMarks`);
  if (errors.length) console.warn(`console errors during the recording:\n  ${errors.join("\n  ")}`);

  // The lag: first magenta frame against the moment the flash went in.
  const flashAt = marks.find((m) => m.kind === "flash" && m.label === "on")!.at;
  const pixel = (file: string) => {
    const r = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-i", file, "-vf", "crop=2:2:0:0,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    return [...r.stdout];
  };
  const firstFlash = captured.find((f) => f.ts >= flashAt - 50 && (([r, g, b]) => r > 200 && g < 60 && b > 200)(pixel(f.file)));
  if (!firstFlash) throw new Error("the sync flash never reached the screencast");
  const lag = firstFlash.ts - flashAt;
  const seen = (at: number) => at + lag;

  const stations = marks.filter((m) => m.kind === "station");
  const ready = stations.find((m) => m.label === "FROM")!;
  const done = marks.filter((m) => m.kind === "play").at(-1)!;
  const t0 = seen(ready.at) + LEAD_S * 1000;
  const end = seen(done.at) + HOLD_S * 1000;
  const sec = (at: number) => Math.round((seen(at) - t0) / 10) / 100;
  // Every time the rail can seek to is a keyframe. A stage starts on the first frame at or after
  // the moment it was seen, and its stored time sits half a frame into that frame, so a seek lands
  // on the keyframe itself rather than on the frame before it.
  const frameOf = (s: number) => Math.max(0, Math.ceil(s * FPS - 1e-6));
  const stamp = (frame: number) => Math.round(((frame + 0.5) / FPS) * 1000) / 1000;
  const keyframes = new Set<number>();
  const onKey = (s: number) => {
    const frame = frameOf(s);
    keyframes.add(frame);
    return stamp(frame);
  };

  // One entry per station the walk landed on, under the rail's names ("JOIN 2" is still JOIN).
  const clauseOf = (label: string) => label.replace(/ \d+$/, "").replace(/, .*$/, "");
  const stages: { clause: string; t: number; still: number }[] = [];
  for (const m of stations) {
    if (!m.label || m.label.includes(", ")) continue;
    const clause = clauseOf(m.label);
    if (!RAIL.includes(clause) || stages.at(-1)?.clause === clause) continue;
    stages.push({ clause, t: (seen(m.at) - t0) / 1000, still: 0 });
  }
  // A stage's still is its settled card: just before the next stage starts, or the held answer.
  stages.forEach((s, i) => (s.still = (stages[i + 1]?.t ?? (end - t0) / 1000) - 0.35));
  for (const s of stages) {
    s.t = onKey(s.t);
    s.still = onKey(s.still);
  }

  // Frames on their own clock: each one holds until the next arrives. The first is whichever was on
  // screen at t0; the last is listed twice because concat drops the final entry's duration.
  const tail = end + FADE_S * 1000;
  const used = captured.filter((f) => f.ts <= tail);
  const startIndex = Math.max(0, used.findLastIndex((f) => f.ts <= t0));
  const clip = used.slice(startIndex);
  const lines: string[] = [];
  clip.forEach((f, i) => {
    const from = Math.max(f.ts, t0);
    const to = clip[i + 1]?.ts ?? tail;
    lines.push(`file '${f.file}'`, `duration ${((to - from) / 1000).toFixed(6)}`);
  });
  lines.push(`file '${clip.at(-1)!.file}'`);
  const list = join(work, "frames.txt");
  writeFileSync(list, `${lines.join("\n")}\n`);

  const main = (end - t0) / 1000;
  const duration = main + FADE_S;
  const first = clip[0]!.file;
  const clips = join(ASSETS, "clips");
  mkdirSync(clips, { recursive: true });

  // The poster is frame one, so the video takes over from it without a jump. ffmpeg builds often
  // lack a WebP encoder; the browser that is already open has one.
  const webp: string = await page.evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${readFileSync(first).toString("base64")}';
    await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  })()`);
  writeFileSync(join(clips, "walk.webp"), Buffer.from(webp, "base64"));
  page.close();

  const data = {
    query: SQL,
    width: WIDTH,
    height: HEIGHT,
    duration: Math.round(duration * 100) / 100,
    done: sec(done.at),
    stages,
  };
  writeFileSync(join(ASSETS, "data/walk.json"), `${JSON.stringify(data, null, 2)}\n`);

  const filter =
    `[0:v]fps=${FPS},trim=duration=${main + FADE_S},setpts=PTS-STARTPTS,format=rgb24[a];` +
    `[1:v]fps=${FPS},format=rgb24[b];` +
    `[a][b]xfade=transition=fade:duration=${FADE_S}:offset=${main.toFixed(3)},` +
    `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`;
  const inputs = ["-f", "concat", "-safe", "0", "-i", list, "-loop", "1", "-framerate", String(FPS), "-t", String(FADE_S + 0.5), "-i", first];
  const tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv"];
  const crf = { h264: process.env.WALK_CRF_H264 ?? "27", av1: process.env.WALK_CRF_AV1 ?? "34" };
  // A keyframe on every time the rail can seek to, so a click lands without decoding up to it.
  // A quarter frame early, so float rounding cannot push a key onto the frame after.
  const keys = ["-g", "9999", "-force_key_frames", [...keyframes].filter((f) => f > 0).sort((a, b) => a - b).map((f) => ((f - 0.25) / FPS).toFixed(5)).join(",")];

  // An intermediate, lossless master, so every encode reads one rendering of the dissolve.
  const master = join(work, "master.mkv");
  ffmpeg([...inputs, "-filter_complex", filter, "-map", "[v]", "-t", duration.toFixed(3), "-c:v", "libx264", "-qp", "0", "-preset", "ultrafast", ...tags, master]);
  // Level 5.1 and six references: veryslow's sixteen would push it to level 6, which some hardware
  // decoders refuse.
  const h264 = (out: string, extra: string[]) =>
    ffmpeg(["-i", master, ...extra, "-c:v", "libx264", "-preset", "veryslow", "-tune", "animation", "-crf", crf.h264,
      "-refs", "6", "-level", "5.1", ...keys, "-profile:v", "high", "-pix_fmt", "yuv420p", ...tags,
      "-movflags", "+faststart", "-an", join(clips, out)]);
  h264("walk.mp4", []);
  // Phones and 1x screens draw the window under ~1440 device pixels; they get the clip at 1x.
  h264("walk-small.mp4", ["-vf", `scale=${WIDTH}:${HEIGHT}:flags=lanczos`]);
  // AV1 with screen-content tools holds the same text in about three quarters of the H.264's bytes.
  ffmpeg(["-i", master, "-c:v", "libsvtav1", "-preset", "4", "-crf", crf.av1, ...keys,
    "-svtav1-params", "scm=1:tune=0", "-pix_fmt", "yuv420p", ...tags, "-an", join(clips, "walk.webm")]);
  const fps = clip.length / main;
  console.log(`${clip.length} frames over ${main.toFixed(1)}s (${fps.toFixed(1)} fps captured), lag ${lag.toFixed(0)}ms`);
  console.log(JSON.stringify(data.stages));
} finally {
  chrome.kill();
  perch.kill();
  await Promise.all([chrome.exited, perch.exited]);
  if (given) {
    for (const dir of [home, workspace, profile]) rmSync(dir, { recursive: true, force: true });
  } else rmSync(work, { recursive: true, force: true });
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
    throw new Error(`timed out: ${expression}`);
  }
  async function navigate(url: string) {
    const loaded = new Promise<void>((r) => listeners.push((m) => m.method === "Page.loadEventFired" && r()));
    await send("Page.navigate", { url });
    await loaded;
  }
  async function mouse(type: string, x: number, y: number) {
    await send("Input.dispatchMouseEvent", { type, x, y, clickCount: 1, button: type === "mouseMoved" ? "none" : "left", buttons: type === "mousePressed" ? 1 : 0 });
  }
  async function clickText(text: string) {
    const point = await evaluate<{ x: number; y: number } | null>(`(() => {
      const hits = [...document.querySelectorAll('body *')].filter((e) =>
        [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() === ${JSON.stringify(text)}) && e.getBoundingClientRect().width > 0);
      const e = hits.at(-1);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`nothing reads "${text}"`);
    await mouse("mouseMoved", point.x, point.y);
    await mouse("mousePressed", point.x, point.y);
    await mouse("mouseReleased", point.x, point.y);
    // Park the pointer where no hover style lands.
    await mouse("mouseMoved", WIDTH / 2, HEIGHT - 4);
  }
  return { send, evaluate, until, navigate, clickText, on: (l: (m: any) => void) => listeners.push(l), close: () => ws.close() };
}

// Records the real Perch for the landing page's replayed workspace. Runs the built binary against
// the birdwatch database, makes exactly the requests the app makes for the scenes, and writes every
// response the replay serves into src/shared/replay/fixtures/birdwatch.json.
//
//   bun apps/site/scripts/record.ts
//
// Needs apps/server/dist/perch (built from main) and the perch_site_demo database. The server runs
// with a throwaway PERCH_HOME and workspace, deleted on exit, so ~/.perch is never read or written.
// Everything written is scrubbed: the workspace reads ~/birdwatch, perch's home ~/.perch, the OS
// user `birder`. Grep the fixture before committing:
//
//   grep -niE "$(whoami)|/Users/|/home/|/private/|/var/folders|claude" apps/site/src/shared/replay/fixtures/*.json

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import type { Recording, ReplayFixtures } from "../src/shared/replay/types";
import { normaliseSql } from "../src/shared/replay/normalise";

const REPO = resolve(import.meta.dir, "../../..");
const PERCH = join(REPO, "apps/server/dist/perch");
const OUT = join(import.meta.dir, "../src/shared/replay/fixtures/birdwatch.json");
const PORT = Number(process.env.RECORD_PORT ?? 4696);
const API = `http://127.0.0.1:${PORT}`;
const PG = {
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? userInfo().username,
  database: process.env.RECORD_DB ?? "perch_site_demo",
};
const CONNECTION = "birdwatch";
// The address the site's window chrome shows, so the recorded server reads like a default install.
const SHOWN_URL = "http://127.0.0.1:4600";

// The files the scenes open. Kept here rather than read from elsewhere so a re-record needs nothing
// but this script, the binary and the database.
const FILES: Record<string, string> = {
  "spring-migration.sql": `-- First arrivals of spring
select s.common_name, to_char(min(g.seen_at), 'YYYY-MM-DD') as first_seen, sum(g.count) as birds
from sightings g
join species s on s.id = g.species_id
where s.migrant
group by s.common_name
order by first_seen;
`,
  "rare-sightings.sql": `-- Red List species, most recent first
select s.common_name, s.status, t.name as site, g.count, to_char(g.seen_at, 'YYYY-MM-DD') as seen_on
from sightings g
join species s on s.id = g.species_id
join checklists c on c.id = g.checklist_id
join sites t on t.id = c.site_id
where s.status <> 'LC'
order by g.seen_at desc;
`,
  "busiest-sites.sql": `-- Which sites turned up the most species?
select t.name, t.habitat, count(distinct g.species_id) as species, sum(g.count) as birds
from sites t
join checklists c on c.site_id = t.id
join sightings g on g.checklist_id = c.id
group by t.id
order by species desc;
`,
  "sightings-by-site.sql": `-- Birds counted at each site
select t.name, sum(g.count) as birds
from sightings g
join checklists c on g.checklist_id = c.id
join sites t on c.site_id = t.id
group by t.name
order by birds desc;
`,
  "field-notes.sql": `select count(*) as checklists, count(distinct observer_id) as observers from checklists;
-- %%
select o.name, count(*) as checklists from checklists c join observers o on o.id = c.observer_id
group by o.name order by checklists desc limit 3;
-- %%
select extract(hour from seen_at) as hour, count(*) as sightings from sightings
group by hour order by sightings desc limit 3;
`,
};

/** What each scene runs, as the editor sends it: a whole file, or one notebook cell. */
const SCENES: { scene: string; sql: string }[] = [
  { scene: "hero", sql: whole("spring-migration.sql") },
  { scene: "hero", sql: whole("rare-sightings.sql") },
  { scene: "hero", sql: whole("busiest-sites.sql") },
  { scene: "completion", sql: whole("sightings-by-site.sql") },
  { scene: "notebook", sql: whole("field-notes.sql") },
  ...cells("field-notes.sql").map((sql) => ({ scene: "notebook", sql })),
  // The first thing a visitor types once the scene hands over.
  ...["species", "families", "sites", "observers", "checklists", "sightings"].map((table) => ({
    scene: "explore",
    sql: `select * from ${table}`,
  })),
];

function whole(file: string): string {
  return FILES[file]!.trim();
}

/** The notebook's cells, split the way packages/ui/src/workspace/cells.ts does: on `-- %%` lines. */
function cells(file: string): string[] {
  return FILES[file]!.split(/^--\s*%%.*$/m)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = process.env.RECORD_TMP ?? tmpdir();
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, "perch-record-"));
const home = join(dir, "home");
const workspace = join(dir, "birdwatch");
mkdirSync(home);
mkdirSync(workspace);
for (const [name, content] of Object.entries(FILES)) writeFileSync(join(workspace, name), content);

// Longest first, so a path inside the workspace is not caught by a shorter prefix.
const replacements: [string, string][] = [
  [realpathSync(workspace), "~/birdwatch"],
  [workspace, "~/birdwatch"],
  [realpathSync(home), "~/.perch"],
  [home, "~/.perch"],
].sort((a, b) => b[0]!.length - a[0]!.length) as [string, string][];

function scrubText(text: string): string {
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text
    .split(API)
    .join(SHOWN_URL)
    .replace(/\/(?:Users|home)\/[^/"'\s]+/g, "~")
    .replace(new RegExp(`\\b${escapeRegExp(userInfo().username)}\\b`, "g"), "birder")
    .replace(new RegExp(`\\b${escapeRegExp(hostname().replace(/\.local$/, ""))}\\b`, "gi"), "localhost");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scrub<T>(value: T): T {
  return JSON.parse(scrubText(JSON.stringify(value))) as T;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

const perch = Bun.spawn([PERCH, "serve", "--port", String(PORT), "--no-open", "--dir", workspace], {
  env: { ...process.env, PERCH_HOME: home },
  stdout: "ignore",
  stderr: "inherit",
});

try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${API}/api/health`)).ok) break;
    } catch {
      /* not listening yet */
    }
    if (i > 100) throw new Error("perch did not start");
    await sleep(100);
  }

  // The id the server gives the connection, used for every call after, as the app does.
  const { id } = await call<{ id: string }>("POST", "/api/connections", {
    name: CONNECTION,
    dialect: "postgres",
    ...PG,
  });
  await call("PUT", "/api/settings", { onboarded: true, theme: "dark", workspaces: [workspace] });
  await call("POST", `/api/connections/${id}/connect`);
  // The pool's first connection is not part of any scene's timing.
  await call("POST", "/api/query/sync", {
    connectionId: id,
    sql: "select 1",
    runId: crypto.randomUUID(),
    record: false,
  });

  const health = await call<ReplayFixtures["server"]>("GET", "/api/health");
  const settings = await call<ReplayFixtures["settings"]>("GET", "/api/settings");
  const connections = await call<ReplayFixtures["connections"]>("GET", "/api/connections");
  const test = await call<ReplayFixtures["connectionTests"][string]>(
    "POST",
    `/api/connections/${id}/test`,
  );
  const allDatabases = await call<string[]>("GET", `/api/connections/${id}/databases`);
  const schema = await call<ReplayFixtures["schemas"][string]>(
    "GET",
    `/api/connections/${id}/schema?database=${encodeURIComponent(PG.database)}`,
  );
  const discovery = await call<ReplayFixtures["discovery"]>("GET", "/api/discover");

  // The listing as the app walks it: the roots, then each root's entries.
  const roots = await call<ReplayFixtures["workspace"]>("GET", "/api/files");
  const listing: ReplayFixtures["workspace"] = [];
  for (const root of roots) {
    listing.push(
      ...(await call<ReplayFixtures["workspace"]>(
        "GET",
        `/api/files?dir=${encodeURIComponent(root.path)}`,
      )),
    );
  }
  const files: ReplayFixtures["files"] = [];
  for (const entry of listing.filter((e) => e.kind === "file")) {
    files.push(
      await call<ReplayFixtures["files"][number]>(
        "GET",
        `/api/files/content?path=${encodeURIComponent(entry.path)}`,
      ),
    );
  }

  const recordings: Recording[] = [];
  for (const { scene, sql } of SCENES) {
    // The body the app's `run` sends for a file in the workspace (use-runs.ts).
    const request = {
      connectionId: id,
      sql,
      runId: crypto.randomUUID(),
      source: "ui",
      database: PG.database,
      workspace,
      maxRows: settings.maxRows,
      timeoutMs: settings.statementTimeoutMs,
    };
    const record = await call<Recording["record"]>("POST", "/api/query/sync", request);
    if (record.status !== "done") throw new Error(`${scene}: ${sql}\n${JSON.stringify(record.error)}`);
    recordings.push({
      key: normaliseSql(sql),
      kind: "run",
      scene,
      request: { sql, maxRows: settings.maxRows },
      record,
    });
  }

  // Only the database the scenes use, and the server's own: a machine's other databases are its
  // owner's business, not the page's.
  const shownDatabases = allDatabases.filter((name) => name === PG.database || name === "postgres");
  const fixtures: ReplayFixtures = {
    version: 1,
    recordedAt: new Date().toISOString(),
    perchVersion: health.version,
    server: { ...health, pid: 0, url: SHOWN_URL },
    connections: connections.map((c) => ({
      ...c,
      ...(c.databases ? { databases: c.databases.filter((d) => shownDatabases.includes(d)) } : {}),
    })),
    databases: { [id]: shownDatabases },
    schemas: { [`${id}/${PG.database}`]: schema },
    connectionTests: { [id]: test },
    settings: { ...settings, recentWorkspaces: settings.recentWorkspaces.slice(0, 1) },
    roots: roots.map((r) => r.path),
    workspace: listing,
    files,
    // Servers found on this machine, minus anything a container or service name could identify.
    discovery: {
      ...discovery,
      servers: discovery.servers
        .filter((s) => s.dialect === "postgres" && s.port === PG.port)
        .map(({ label: _label, ...server }) => server),
    },
    recordings,
  };

  mkdirSync(resolve(OUT, ".."), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(scrub(fixtures), null, 1)}\n`);
  const kb = (Bun.file(OUT).size / 1024).toFixed(1);
  console.log(`recorded ${recordings.length} runs, ${files.length} files into ${OUT} (${kb} KB)`);
} finally {
  perch.kill();
  await perch.exited;
  rmSync(dir, { recursive: true, force: true });
}

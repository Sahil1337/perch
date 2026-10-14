# replay

The real Perch workspace from `@perch/ui`, fed by recordings of a real Perch talking to a real
Postgres. Nothing here draws an imitation of the app: every pane is the component the shipped
binary renders, and every row on screen is a row the server returned while recording.

```
replay/
  index.ts              the public surface (below)
  types.ts              fixture types: ReplayFixtures, Recording, FixtureFile, ReplayInput
  normalise.ts          normaliseSql — how a run finds its recording
  store.ts              createReplayWorkspace — the WorkspaceApi over fixtures, in memory
  use-replay.ts         useReplayWorkspace — the store as a React hook
  export-csv.ts         exportUrl: a data: URL of the recorded rows
  fixtures/
    index.ts            birdwatch typed, fixtureText, recordedResult — light, for the page's bundle
    birdwatch.json      written by apps/site/scripts/record.ts — do not edit by hand
    walk*.json          R2's walk recordings (merged through `extraRecordings`)
scenes/stage/           the scene kit shared by every real scene (R1 and R2)
    window-frame.tsx    window chrome, native-size render, scale-to-width, aspect reserved (light)
    window-frame.css    traffic-light colours, the nested-.dark --color-* aliases, hidden scrollbars
    lazy-scene.tsx      lazyScene(load, size): the light export; frame now, heavy module near view
    real-scene.tsx      RealScene + SceneScript: workspace + replay + script loop, or one play + hand-over
    workspace-shell.tsx the workspace layout apps/web renders (global listeners only when active)
    active-scene.ts     the usable scene once it is the visitor's; keeps shortcuts/dialogs/popups to it
    autoplay.ts         Clock (pausable scene time)
    editor-driver.ts    drives the real CodeMirror view: type, keys via its keymap, completion
    camera.ts           the calm zoom/pan of the inner app
```

## API

```ts
import {
  createReplayWorkspace,
  useReplayWorkspace,
  normaliseSql,
  REPLAY_NOTICE,
  birdwatch,                      // the recorded fixtures (ReplayFixtures)
  type ReplayFixtures,
  type Recording,
  type ReplayInput,
  type ReplayWorkspace,
  fixtureText,
} from "../../replay";           // relative; there is no path alias

// A store, not a React value: the WorkspaceApi it serves changes identity on every change, the
// way the live provider's does, so components re-render. Use the hook in components.
const store: ReplayWorkspace = createReplayWorkspace({
  fixtures: birdwatch,
  extraRecordings: walkRecordings,           // optional, merged after fixtures.recordings
  open: ["~/birdwatch/spring-migration.sql"],// optional: tabs open at start, last one focused
  active: "~/birdwatch/spring-migration.sql",// optional: which of `open` has focus
  files: { "~/birdwatch/x.sql": "select 1" },// optional: on-disk content overrides
  panels: { sidebarTab: "files" },           // optional: PanelState overrides
  latency: (recordedMs) => recordedMs + 80,  // optional: how long a replayed run takes
});
store.getSnapshot();   // WorkspaceApi — the contract, exactly
store.subscribe(fn);   // () => unsubscribe
store.reset();         // back to the state it was created in (buffers, runs, panels, settings)

// In a component: creates the store once and subscribes.
const { api, store } = useReplayWorkspace(input);
<WorkspaceProvider value={api}>…</WorkspaceProvider>

fixtureText("~/birdwatch/spring-migration.sql"); // a recorded file's content
```

Input fields beyond the spec's `{ fixtures, extraRecordings }` are optional: `open`, `active`,
`notebook` (paths opened in notebook view), `files`, `panels`, `latency`.

## Writing a real scene (the kit in `scenes/stage/`)

```tsx
// scenes/real/workspace.ts — light; this is what scenes/index.ts exports
export const RealXScene = lazyScene(() => import("./workspace/x.scene"), { width: 1280, height: 760 });

// scenes/real/workspace/x.scene.tsx — heavy (CodeMirror, @perch/ui); default export
const script: SceneScript = {
  camera: "always" | "narrow",          // narrow: only below 700px frame width
  input: { fixtures: birdwatch, open: [...], panels: { layout: splitLayout(42) } },
  async play(ctx) { … await ctx.clock.sleep(ms) … },  // one pass, ending on its main beat
  hold: 8500,                           // a looping scene rests this long on that last frame
  async final(ctx) { … },               // the last frame at once (reduced motion, autoplay=false)
  anchors: (stage) => ({ … }),          // extra anchors for onReady
};
export default (props: RealSceneProps) => <RealScene {...props} script={script} />;
```

`RealScene` owns everything else: the frame's app area, `WorkspaceProvider` + `WorkspaceShell`,
the replay store, `onReady({ window, titlebar, topbar, sidebar, statusBar, runButton, editor, … })`
once fonts are in, the loop (`play`, `onDone`, `hold`, then a fade of `main` and `store.reset()`),
and scene time that runs only while ≥40% visible. Under reduced motion or `autoplay={false}` it
runs `final` instead.

A scene is animation only: the frame keeps its app `inert` (no tab stop, nothing for a press or a
key) and the whole window `pointer-events: none`, so wheel, hover and presses go to the page. A
scene given `usable` (the hero) plays once instead: `play` (or `final`), a camera still zoomed in
eases back out, and then `handOver` makes the window live — the app takes pointer and keyboard,
keeps the state the demo left, and becomes the active scene — and `onDone` fires. The drawn caret
stays until the visitor's focus first lands in the app.

`SceneContext`: `api()` (current WorkspaceApi), `store`, `clock`, `stage` (the element the camera
moves, app at native size), `camera` (null when off), `frameWidth()`. Helpers:
`waitForRun(ctx, sinceId)`, `splitLayout(editorPercent)`; in `editor-driver.ts`: `waitForEditor`,
`showCaret` (caret drawn without taking page focus — never call `view.focus()` in a script),
`placeCaret`, `typeText`, `pressKey("Enter" | "ArrowDown" | "Mod-Enter" | "Ctrl-Space" …)` through
the editor's own keymap, `waitForCompletion`, `completionLabels`, `pickCompletion`.

Several workspaces on one page: the app's global listeners (`useHotkey` on window, the palette,
the save/diagram/walk dialogs, SettingsButton's ⌘, and event) are mounted only in the live usable
scene (`WorkspaceShell active`), a capture guard drops ⌘K/⌘B/⌘J/⌘S/⌘\/⌘, that start outside it,
and Base UI popups it portals to `<body>` get `.dark`. A scene that renders its own layout instead
of `WorkspaceShell` should mount nothing that listens on `window`, or only once it is live. Editor popups are parented inside the stage (`houseTooltips`),
so they overflow their pane as in the app and scale with the frame.

What the replayed `WorkspaceApi` does:

- **run / probe**: the SQL is normalised (`normaliseSql`: comments stripped, whitespace collapsed,
  trailing `;` dropped, lower-cased outside quotes). A match resolves with the recorded
  `RunRecord` — a fresh id and timestamps, otherwise the server's own columns, rows, counts and
  durations — after `latency(recordedMs)` (default: the recorded duration plus a small transport
  cost, 90 ms floor). A `maxRows` smaller than the recorded rows cuts them and sets `truncated`, as
  the server would. Anything else resolves, never rejects, with a `done` run whose single
  statement has no columns and one notice, `REPLAY_NOTICE`:
  "This preview replays recorded queries — install Perch to run your own." The results pane opens
  Messages for it. No row is ever invented.
- **files, tabs, settings, panels, history**: in memory. Edits mark a buffer dirty and autosave
  writes it (to memory) after `settings.autosaveDelayMs`, so the save indicator moves as it does
  in the app. `runs` is this session's runs only.
- **schema, databases, connections, server, discovery, connection test**: the recordings.
  `connect` to the recorded connection resolves; anything that needs the visitor's own machine
  (`addConnection` + `connect`, `browse`) rejects with a plain sentence saying so.
- **exportUrl**: a `data:text/csv` URL built from the recorded rows.

## Fixture format (`types.ts`)

```ts
type ReplayFixtures = {
  version: 1;
  recordedAt: string;           // ISO
  perchVersion: string;         // from GET /api/health
  server: ServerInfo;           // GET /api/health, scrubbed (configDir ~/.perch, url :4600)
  connections: ConnectionSummary[];             // GET /api/connections after connect
  databases: Record<string, string[]>;          // by connection id
  schemas: Record<string, DatabaseSchema>;      // by `${connectionId}/${database}`
  connectionTests: Record<string, ConnectionTest>;
  settings: Settings;           // GET /api/settings
  roots: string[];              // ["~/birdwatch"]
  workspace: FileEntry[];       // the walked listing GET /api/files gives
  files: FixtureFile[];         // GET /api/files/content for every .sql file
  discovery: DiscoveryResult;   // GET /api/discover, scrubbed
  recordings: Recording[];
};

type FixtureFile = { path: string; content: string; modifiedAt: string };

type Recording = {
  key: string;                  // normaliseSql(request.sql); recomputed on load if empty
  kind: "run" | "probe";
  scene?: string;               // "hero" | "completion" | "notebook" | "explore" | "walk" …
  request: {                    // the POST /api/query/sync body that was sent, minus ids
    sql: string;
    maxRows?: number;
    readOnly?: boolean;
    record?: boolean;
  };
  record: RunRecord;            // the response, verbatim apart from the privacy scrub
};
```

Paths in fixtures are what the visitor sees: the workspace is `~/birdwatch`, perch's home is
`~/.perch`, the OS user is `birder`. The recorder scrubs every response before writing; grep
before committing (see the recorder's header).

Adding recordings (R2): write them in this shape to `fixtures/walk*.json` (an array of
`Recording`) and pass them as `extraRecordings`. Probes are matched by key exactly like runs.

## Re-recording

```sh
bun apps/site/scripts/record.ts
```

Needs `apps/server/dist/perch` (built from main), Postgres with the `perch_site_demo` database
loaded, and bun. It starts its own `perch serve` on 4696 with a throwaway `PERCH_HOME` and
workspace, never `~/.perch`. Environment, all optional: `PGHOST`, `PGPORT`, `PGUSER`,
`RECORD_DB`, `RECORD_PORT`, `RECORD_TMP` (where the throwaway folders go).

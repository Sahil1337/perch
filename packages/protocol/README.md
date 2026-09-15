# @perch/protocol

The contract between the perch server and every client (the CLI, the web UI, anything else
that speaks to the HTTP API). If a shape crosses the wire, it is defined here.

**Types only.** No runtime values — no consts, enums, functions or classes.
`bun run --filter @perch/protocol check` enforces that.

**No build step.** The package is consumed as raw `.ts` source by both a NodeNext build
(apps/server) and a bundler (apps/web); every export is erased at compile time, so nothing
here ever reaches a runtime bundle. Relative imports inside `src/` therefore need explicit
`.js` extensions.

**Evolving the contract:** add optional fields rather than changing existing shapes. A
server and a client are often on different versions; an added optional field is invisible
to an older peer, a changed shape breaks it.

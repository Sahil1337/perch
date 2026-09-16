# Conventions

**Read [AGENTS.md](AGENTS.md).** It is the canonical conventions file for this repo and applies
in full to Claude Code: workspace and install rules, the `@perch/protocol` types-only constraint,
the `apps/server` layering ESLint enforces, how to verify a change, and the project facts that
trip agents up.

Rules live in `AGENTS.md`, not here, so the two files cannot drift. Add anything new there. This
file is only for guidance specific to Claude Code.

## Claude Code specifics

- `AGENTS.md` is the single source of truth for conventions; `CONTRIBUTING.md` is written for
  humans and covers the same ground in more detail. When they disagree, `AGENTS.md` wins for
  agent-facing rules and the code wins over both — verify before trusting either.
# diffdeck Test Coverage 100% + Playwright E2E — Design

**Date:** 2026-07-13
**Status:** Approved (design), pending plan

## Goal

Bring diffdeck's **owned, unit-testable runtime code** to a measured 100% coverage
gate (`bun test --coverage`), and add a **Playwright real-browser e2e suite** that
covers the browser entry (`main.ts`) and the vendored render paths diffdeck actually
uses at runtime.

## Background — current state

`bun test --coverage` today: 210 tests pass, aggregate **31.79% funcs / 36.68% lines**
across the whole monorepo. That number is dominated by the vendored Pierre packages
(`packages/*`, ~27k lines of recovered third-party code), most of which is
functionality diffdeck never calls (`dragAndDrop`, `virtualization`, `renameHelpers`,
`themeController`, …).

Restricting attention to the code diffdeck **owns and ships** (`apps/viewer/{browser,
cli,server}`), almost everything is already at 100% funcs. The gaps are:

**Zero unit coverage (never imported by a test):**
- `browser/main.ts` (631 lines) — browser entry; all logic runs at module load,
  side-effecting against `document`/`fetch`/`localStorage`/Pierre `CodeView`.
- `browser/copyButton.ts` (48) — DOM button factory + clipboard.
- `browser/imageCard.ts` (121) — Old/New card injection into a `<diffs-container>`
  shadow DOM.
- `browser/search/findBar.ts` (152) — find-bar controller (fully DI already).
- `browser/search/highlightDom.ts` (85) — `<mark>` wrapping over `[data-line]` rows.
- `cli.ts` (117) — CLI entry; auto-invokes `main()` at module bottom, so importing it
  in a test would start a server. A `cli-smoke.test.ts` spawns it as a subprocess, but
  bun's in-process instrumentation never sees subprocess coverage.
- `build.ts` (48) — build tooling (produces `dist/`).

**Small line gaps in otherwise-covered files:**
- `server/diff.ts`: lines 35, 47-49, 220-224.
- `server/ensure.ts`: 40-47.
- `server/server.ts`: 149-155 (also 88.89% funcs).

## Scope decisions (confirmed)

1. **Coverage target = owned code + real-usage paths.** Owned runtime code
   (`apps/viewer/{browser,cli,server}`) reaches a measured 100% gate. The vendored
   `packages/*` are **not** forced to any number; the paths diffdeck uses at runtime
   are exercised transitively by the e2e suite.
2. **`main.ts` is e2e-covered and excluded from the in-process gate.** It is a
   631-line integration entry where a real browser is the correct test; forcing
   in-process 100% via happy-dom would mean a large, risky refactor and brittle
   Pierre-under-happy-dom rendering for no real quality gain.
3. **`build.ts` is excluded from the gate** as build tooling (exercised by the build
   step the e2e suite and `prepack` run).
4. **Dead code carried from cc-statusline is removed (YAGNI).** `server/ensure.ts`
   (the spawn-if-not-running daemon) and `server.ts`'s `idleTimeoutMs` idle-shutdown
   are vestiges of cc-statusline's statusline-managed-daemon model; diffdeck's CLI runs
   the server in the foreground and never calls either — only their own tests reference
   them. Removing them is how those paths reach the gate; the remaining owned code then
   hits 100% naturally, with no dead branches to contort tests around.

## Architecture — two workstreams

### Workstream A — coverage to 100% (in-process, `bun test --coverage`)

The measured gate covers exactly: `apps/viewer/browser/**` (except `main.ts`),
`apps/viewer/cli/**`, `apps/viewer/cli.ts`, `apps/viewer/server/**`.

**A1. happy-dom unit tests for the four 0%-coverage DOM helpers.**
Follow the established per-file pattern (`packages/trees/src/__tests__/happydom.ts`):
each new test file does `import "<happydom>";` at the top so happy-dom registers
globals for that file only (global preload is intentionally avoided — it breaks the
real-HTTP server tests, per `bunfig.toml`). A shared local helper
`apps/viewer/__tests__/happydom.ts` mirrors the trees one.

- `copyButton.test.ts` — `createCopyButton(path)` returns a `<button>` with
  `data-copy-name`, aria/title, copy SVG; clicking (with a stubbed
  `navigator.clipboard.writeText`) copies `path` and swaps to the check icon, then
  reverts after `RESET_MS`; `pointerdown`/`click` call `stopPropagation`; missing
  clipboard API is handled (warns, no throw).
- `highlightDom.test.ts` — over a hand-built `[data-line]` subtree: empty query
  unwraps only; matches wrap in `mark.cc-find-hit`; the active occurrence
  (`fileId`+`side`+`lineNumber`+`column`) alone gets `--active`; idempotent
  re-highlight; non-numeric `data-line` rows skipped; deletion side detection.
- `imageCard.test.ts` — over a container with an attached shadow root + a
  `[data-diffs-header]`: injects an Old/New card after the header; idempotent when
  `version` unchanged; replaces when `version` changes; removes when `collapsed` or
  `entry` is undefined; hides `-0 +0` stat counts; `showOld`/`showNew` gating.
- `findBar.test.ts` — construct with injected `elements` (happy-dom nodes) + spy
  deps: `open()` shows the bar, focuses input, sets count; typing (input event,
  advance past the 120ms debounce with fake timers) rebuilds matches and calls
  `revealMatch`/`reapplyHighlights`; Enter / Shift+Enter cycle via `goTo`; Escape
  and close button close; `Cmd/Ctrl+F` opens/focuses; `getQuery`/`getActiveMatch`
  gate on open state; `setData` no-ops when closed.

**A2. `cli.ts` refactor for testability.**
Extract the current `main()` body into an exported `run(argv: string[], deps: CliDeps)`
where `CliDeps` injects the side-effecting collaborators (server start, url builder,
port resolver, opener spawn, `log`/`error`, `exit`, signal registration, and the
skill source/viewer dirs). The module bottom becomes
`if (import.meta.main) run(process.argv.slice(2), realDeps)`. A new `cli-run.test.ts`
drives `run()` with fakes to cover every branch: `install-skill` (with/without
`--codex`/`--project`), `--help`, `--version`, normal start + open, `--no-open`,
and the server-start-failure path (`exit(1)`). The existing subprocess
`cli-smoke.test.ts` stays as an integration check.

**A3. server: remove dead code + close remaining gaps.**
- Remove `server/ensure.ts` and its `__tests__/diff-ensure.test.ts` (dead in diffdeck).
- Remove the `idleTimeoutMs` option and the idle-timer block from `server.ts`; drop
  `idleTimeoutMs: 0` from `diff-server.test.ts` and `built-serving.test.ts`.
- Close `server/diff.ts`'s residual lines with real code paths (no mocks):
  `prBaseName` spawn-error catch (line 35) via a non-existent `cwd`; `defaultBranchName`
  origin/HEAD-set branch (47-49) via a fixture repo with `refs/remotes/origin/HEAD` set;
  renamed/added/deleted name-status parsing (220-231) via a fixture with an R/A/D file.
  Export the internal git helpers (`prBaseName`, `defaultBranchName`) as needed to test
  the edge branches directly.
- Re-run coverage and close any residual `server.ts` line left after the idle removal.

**A4. coverage gate config.** In `bunfig.toml` `[test]`:
```toml
coverageThreshold = { lines = 1, functions = 1, statements = 1 }
coveragePathIgnorePatterns = [
  "packages/**",
  "scripts/**",
  "apps/viewer/browser/main.ts",
  "apps/viewer/build.ts",
  "**/*.test.ts",
]
```
`coverage` stays **off by default** (so plain `bun test` remains fast); the threshold
only fires when `--coverage` is passed. A root `test:coverage` script runs
`bun test --coverage`. Thresholds are aggregate over the non-ignored (owned) files, so
100% aggregate ⇔ every owned runtime line covered.

### Workstream B — Playwright e2e (real browser)

**B1. Tooling.** Add `@playwright/test` as a **devDependency** (runtime stays
zero-dependency — it never enters `dist/`). Playwright config uses
`channel: "chrome"` to drive the **system Google Chrome already installed** on the
machine, avoiding a Chromium binary download (and the corp-TLS download risk); fall
back to bundled chromium only if the channel is unavailable.

**B2. Fixture repo.** A helper builds a throwaway git repo in a temp dir with a
deterministic set of changes: two edited text files (syntax highlight, fold, find,
copy, tree-nav needs ≥2 files), a changed binary PNG (image Old/New card), a
large/lockfile change (default-collapsed behaviour), and an untracked file (for
`--untracked`). Committed base + working-tree edits so the default "working" mode has
content.

**B3. App-under-test fixture.** A Playwright fixture spawns the built CLI
(`bun dist/cli.js --no-open --port 0 [flags]`) with the fixture repo as cwd, reads
stdout for the printed `http://127.0.0.1:<port>/?…token…` URL, and exposes it to the
test; teardown kills the process. A worker-scoped default (no flags) serves most
specs; the flag-sync spec spawns its own instance with all view flags.

**B4. Global setup** runs `bun run build` once (produces `dist/cli.js` +
`dist/viewer/`) before the suite.

**B5. Specs** (`apps/viewer/e2e/*.spec.ts`):
- `render.spec.ts` — app loads; status shows "N file(s)"; diff containers render;
  syntax-highlighted tokens present; file tree lists the changed files.
- `tree-nav.spec.ts` — **single-click** a file-tree row scrolls the diff to that file
  (regression guard for the `FileTreeVanillaView` `#pointerInteracting` fix — one
  click, not two).
- `fold.spec.ts` — clicking a file header collapses it (chevron rotates / body
  hidden); clicking again expands.
- `copy-path.spec.ts` — hover a header, click the copy button; clipboard
  (`navigator.clipboard.readText`, permission granted) holds the file's path.
- `find.spec.ts` — `Cmd/Ctrl+F` opens the find bar; a query shows `x/y` count and
  `mark.cc-find-hit` highlights; `n`/`N` (Enter/Shift+Enter) move the active match.
- `flags-sync.spec.ts` — launch with `--untracked --watch --no-flatten --tree-right
  --split`; assert each in-app toggle reflects the launched state (ports the
  `cdp-flags.ts` assertions to Playwright).
- `image-diff.spec.ts` — the changed PNG renders inline Old/New `[data-image-card]`
  panels in the diff flow.

`test:e2e` (root script) = build + `playwright test`. The e2e suite is **separate**
from `bun test` and from the coverage gate.

### Workstream C — scripts & docs

- Root `package.json`: add `test:coverage` and `test:e2e` scripts.
- `README.md` (repo) Development section: document `bun test`, `bun run test:coverage`
  (100% owned-code gate), and `bun run test:e2e` (Playwright, uses system Chrome);
  note the vendored packages are intentionally out of the gate.
- `CLAUDE.md`: record the coverage-gate scope, the `main.ts`/`build.ts` exclusions,
  and the e2e layout.

## Global constraints

- **Controller-only installs.** `bun install` (adding `@playwright/test`) and any
  Playwright browser provisioning are done by the controller, never a subagent (avoids
  parallel-install races). Subagents that need the dep assume it is already installed.
- **`browser/**` is outside the typecheck loop** (only `server`/`cli`/`cli.ts`/
  `build.ts` are in `apps/viewer/tsconfig.json`). Tests + build are the safety net for
  `browser/**`; new browser unit tests must run green under `bun test`.
- **No `git stash`** (shared across worktrees) — use a WIP commit to set work aside.
- **Real behaviour, not mocks-of-mocks.** happy-dom gives real DOM; only the true
  external seams (clipboard, `fetch`, timers, `Bun.spawn`, `process.exit`) are stubbed.
- Existing 210 tests stay green; no changes to shipped runtime behaviour.

## Out of scope

- Raising `packages/*` (vendored) coverage numbers.
- CI wiring (GitHub Actions) — scripts are provided; hooking them into CI is a
  follow-up.
- `watch` auto-refresh and `working`/`base` mode e2e specs — stretch; only added if
  they prove non-flaky within the plan.

## Risks

- **Playwright + system Chrome.** If `channel: "chrome"` fails in this environment,
  fall back to `bunx playwright install chromium` (controller handles the download;
  corp-TLS cafile already configured per project memory).
- **imageCard/shadow-DOM under happy-dom.** happy-dom supports `attachShadow`; if a
  specific query proves unsupported, the test builds the minimal DOM shape the code
  queries rather than a full Pierre render.
- **cli.ts refactor.** The `run()` extraction must preserve exact current behaviour
  (argv parsing order: `install-skill` before flags; exit codes). The subprocess
  `cli-smoke.test.ts` guards against regressions.

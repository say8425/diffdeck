# diffdeck Coverage 100% + Playwright E2E — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring diffdeck's owned runtime code (`apps/viewer/{browser,cli,server}`) to a measured 100% `bun test --coverage` gate, and add a Playwright real-browser e2e suite covering `main.ts` and the vendored render paths diffdeck uses.

**Architecture:** Two workstreams. (A) In-process unit coverage: happy-dom tests for the four 0%-coverage DOM helpers, a DI refactor of `cli.ts`, removal of dead code (`ensure.ts` daemon, `server.ts` idle-timeout), server gap tests, and a bunfig coverage gate. (B) Playwright e2e driving the built CLI against a temp fixture git repo in the system Google Chrome.

**Tech Stack:** Bun 1.3.12, TypeScript 6, `@happy-dom/global-registrator` (already a dep, used by trees tests), `@playwright/test` (new devDependency), oxlint/oxfmt.

## Global Constraints

- **Controller-only installs.** Adding `@playwright/test` (`bun install`) and any Playwright browser provisioning are done by the CONTROLLER before the relevant task is dispatched — never inside a subagent (parallel-install races corrupt `bun.lock`). Subagents assume the dep is present.
- **`browser/**` is outside the typecheck loop.** `apps/viewer/tsconfig.json` includes only `server/**`, `cli.ts`, `cli/**`, `build.ts`. Browser files are covered by `bun test` + the build, not `tsc`. Do not add `browser/**` to tsconfig.
- **Never use `git stash`** (shared across worktrees). Set work aside with a WIP commit if needed.
- **Real behaviour, not mocks-of-mocks.** happy-dom provides a real DOM; stub only true external seams (`navigator.clipboard`, `fetch`, timers via `bun:test` fake timers, `Bun.spawn`, `process.exit`).
- **happy-dom is per-file, never global.** Each browser test starts with `import "./happydom.ts";` (a new `apps/viewer/__tests__/happydom.ts`). Global registration breaks the real-HTTP server tests — do not add it to `bunfig.toml` preload.
- **All 210 existing tests stay green.** No shipped-runtime behaviour changes (dead-code removal only deletes code diffdeck never calls).
- **e2e specs are named `*.e2e.ts`** so `bun test` (which also collects `*.spec.ts`) never runs them; Playwright's `testMatch` targets `**/*.e2e.ts`.
- Run `oxfmt apps/ packages/` and `bun test` before every commit; the auto-format hook may reformat written files.

---

## Task 1: happy-dom infra + copyButton + highlightDom coverage

**Files:**
- Create: `apps/viewer/__tests__/happydom.ts`
- Create: `apps/viewer/__tests__/copy-button.test.ts`
- Create: `apps/viewer/__tests__/highlight-dom.test.ts`
- Read: `apps/viewer/browser/copyButton.ts`, `apps/viewer/browser/search/highlightDom.ts`, `packages/trees/src/__tests__/happydom.ts` (pattern)

**Interfaces:**
- Consumes: `createCopyButton(path: string): HTMLButtonElement`; `highlightDom(root: HTMLElement | ShadowRoot, query: string, active: SearchMatch | null, fileId: string): void`.
- Produces: `apps/viewer/__tests__/happydom.ts` re-exporting the happy-dom registration (imported by all later browser tests).

- [ ] **Step 1: Create the happy-dom helper**

```typescript
// apps/viewer/__tests__/happydom.ts
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Per-file DOM registration. NOT preloaded globally (that replaces Node's
// fetch/http and breaks the real-HTTP server tests). Import this at the top of
// any browser unit test that needs a DOM.
if (!GlobalRegistrator.isRegistered) {
	GlobalRegistrator.register();
}
```

- [ ] **Step 2: Write `copy-button.test.ts`**

Cover every branch of `createCopyButton`. Use `bun:test` fake timers for the `RESET_MS` revert. Cases:
- returns a `<button>` with `type=button`, `data-copy-name`, `aria-label="Copy file path"`, `title="Copy path"`, and the copy SVG markup.
- click with a stubbed `navigator.clipboard.writeText` (resolves) → awaits the microtask, then asserts the button swaps to the check SVG and `aria-label="Copied"`; after advancing timers past `RESET_MS` it reverts to the copy SVG and original labels.
- a second click while the first timer is pending clears and restarts the timer (no double-revert).
- `pointerdown` and `click` both call `stopPropagation` (spy via a listener on a parent that must NOT fire, or dispatch and assert `event.stopPropagation` called using a wrapped event).
- missing clipboard API: set `navigator.clipboard` to `undefined` (or an object without `writeText`) → click warns (`console.warn` spy) and does not throw.

```typescript
import "./happydom.ts";
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createCopyButton } from "../browser/copyButton.ts";

// Stub navigator.clipboard per test; restore afterEach.
// Use spyOn(console, "warn") for the unavailable-API path.
// Use the fake-timers API (setSystemTime / bun:test timer controls) for RESET_MS.
```

Read `copyButton.ts` for the exact SVG constants and `RESET_MS` (1200). Assert against `btn.innerHTML` containing a distinguishing substring of each SVG (e.g. the check `polyline points="20 6 9 17 4 12"`), not the whole string.

- [ ] **Step 3: Write `highlight-dom.test.ts`**

Build a minimal `[data-line]` DOM by hand (no Pierre render). A helper makes a line element:

```typescript
const makeLine = (n: number, text: string, type = "addition"): HTMLElement => {
	const el = document.createElement("div");
	el.setAttribute("data-line", String(n));
	el.setAttribute("data-line-type", type);
	el.textContent = text;
	return el;
};
```

Cases:
- empty query → any existing `mark.cc-find-hit` is unwrapped and text restored (`normalize` merges nodes); no marks remain.
- a query matching twice in one line → two `mark.cc-find-hit`; surrounding text preserved.
- active match (`fileId`+`side="additions"`+`lineNumber`+`column`) → exactly the occurrence at that column gets `cc-find-hit--active`; others do not.
- a deletion line (`data-line-type` containing "deletion") maps to side `deletions`; an active match with `side="deletions"` marks it.
- a row with non-numeric `data-line` is skipped.
- idempotency: calling `highlightDom` twice with the same args yields the same single set of marks (unwrap-first).

Assert via `root.querySelectorAll("mark.cc-find-hit")` counts and `classList.contains("cc-find-hit--active")`.

- [ ] **Step 4: Run the tests**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/copy-button.test.ts apps/viewer/__tests__/highlight-dom.test.ts`
Expected: all pass.

- [ ] **Step 5: Confirm coverage of the two files**

Run: `bun test --coverage 2>&1 | grep -E 'copyButton|highlightDom'`
Expected: both at 100% funcs and 100% lines.

- [ ] **Step 6: Format + full suite + commit**

Run: `oxfmt apps/ && bun test`
Expected: full suite green (was 210; now +N).
```bash
git add apps/viewer/__tests__/happydom.ts apps/viewer/__tests__/copy-button.test.ts apps/viewer/__tests__/highlight-dom.test.ts
git commit -m "test(viewer): cover copyButton and highlightDom via happy-dom"
```

---

## Task 2: imageCard + findBar coverage

**Files:**
- Create: `apps/viewer/__tests__/image-card.test.ts`
- Create: `apps/viewer/__tests__/find-bar.test.ts`
- Read: `apps/viewer/browser/imageCard.ts`, `apps/viewer/browser/search/findBar.ts`, `apps/viewer/browser/search/searchIndex.ts` (for `SearchFile`/`SearchMatch`/`findMatches`)

**Interfaces:**
- Consumes: `ensureImageCard(container, entry, collapsed, urlFor)`; `createFindBar(deps): FindBar`.
- Produces: none (tests only).

- [ ] **Step 1: Write `image-card.test.ts`**

`ensureImageCard` queries `container.shadowRoot ?? container` for `[data-diffs-header]` (value of `DIFFS_HEADER_ATTR`), `[data-image-card]`, and `[data-deletions-count]`/`[data-additions-count]`. Build a container with an attached shadow root containing those nodes:

```typescript
import "./happydom.ts";
import { describe, expect, test } from "bun:test";
import { DIFFS_HEADER_ATTR } from "@diffdeck/diffs";
import { ensureImageCard } from "../browser/imageCard.ts";
import type { ImageEntry } from "../browser/imageDiff.ts";

const makeContainer = (): { host: HTMLElement; root: ShadowRoot } => {
	const host = document.createElement("div");
	const root = host.attachShadow({ mode: "open" });
	const header = document.createElement("div");
	header.setAttribute(DIFFS_HEADER_ATTR, "");
	const add = document.createElement("span");
	add.setAttribute("data-additions-count", "");
	const del = document.createElement("span");
	del.setAttribute("data-deletions-count", "");
	header.append(add, del);
	root.append(header);
	return { host, root };
};

const entry = (over: Partial<ImageEntry> = {}): ImageEntry => ({
	name: "logo.png",
	oldPath: "logo.png",
	status: "modified",
	showOld: true,
	showNew: true,
	version: "v1",
	...over,
});
```

Cases:
- `entry` + not collapsed → a `[data-image-card]` is inserted after the header, containing an `img-pane--old` and `img-pane--new` with `<img>` `src` from `urlFor`; `data-additions-count`/`data-deletions-count` get `display:none`.
- idempotent: calling again with the same `version` leaves the same card (query the node identity or that only one card exists and `urlFor` isn't rebuilt — assert a single `[data-image-card]`).
- version change (`v1`→`v2`) → old card removed, new card present with `data-image-card="v2"`.
- `collapsed=true` → existing card removed.
- `entry=undefined` → existing card removed; no throw when none exists.
- `showOld:false` → only `img-pane--new`; `showNew:false` → only `img-pane--old`.
- status `added`/`deleted`/`renamed`/`untracked` with a matching `#diffs-icon-symbol-*` present in the root → `swapStatusIcon` sets the `use` href; without the symbol, no-op (assert no throw and href unchanged). Read `imageCard.ts` for the exact selectors (`[data-change-icon]`, `use`, symbol ids).

Read `imageDiff.ts` for the exact `ImageEntry` shape (fields `name`, `oldPath`, `status`, `showOld`, `showNew`, `version`).

- [ ] **Step 2: Write `find-bar.test.ts`**

`createFindBar` is fully dependency-injected. Build happy-dom elements and spy deps:

```typescript
import "./happydom.ts";
import { describe, expect, mock, test } from "bun:test";
import { createFindBar, type FindBarDeps } from "../browser/search/findBar.ts";
import type { SearchFile } from "../browser/search/searchIndex.ts";

const makeElements = () => {
	const bar = document.createElement("div");
	const input = document.createElement("input");
	const count = document.createElement("div");
	const prev = document.createElement("button");
	const next = document.createElement("button");
	const close = document.createElement("button");
	document.body.append(bar, input, count, prev, next, close);
	return { bar, input, count, prev, next, close };
};

// A SearchFile with a known fileDiff so findMatches returns deterministic hits.
// Read searchIndex.ts / an existing search test for how to build a fileDiff
// whose lines contain the query (reuse the fixture style from
// viewer-search-index.test.ts).
```

Cover the controller branches:
- `open()` sets `bar.hidden=false`, focuses/selects input, calls `setExpandAll`, `rebuild`, and (with matches) `goTo(0)` → `revealMatch`/`reapplyHighlights` fire; count shows `1/total`.
- typing: dispatch an `input` event, advance past the 120ms debounce (fake timers), assert `applyQuery` ran — matches rebuilt, `revealMatch` called, count updated. Empty query → `clearSelection`, count "".
- `Enter` → `goTo(current+1)`; `Shift+Enter` → `goTo(current-1)`; wraps modulo match count.
- `Escape` and the close button → `close()`: `bar.hidden=true`, `setExpandAll(false)`, `clearSelection`, `reapplyHighlights`.
- prev/next buttons → `goTo(-1)/(+1)`.
- window `Cmd/Ctrl+F`: when closed → `open()`; when open → refocus/select (not re-open).
- `getQuery()`/`getActiveMatch()` return "" / null when closed; real values when open.
- `setData()` no-ops when closed; when open rebuilds and calls `selectMatch`/`reapplyHighlights`.
- no-match query → count "0/0", prev/next disabled, `clearSelection` called.

Use `mock()` for each dep function and assert call counts/args.

- [ ] **Step 3: Run + coverage + format + commit**

Run: `bun test apps/viewer/__tests__/image-card.test.ts apps/viewer/__tests__/find-bar.test.ts`
Then: `bun test --coverage 2>&1 | grep -E 'imageCard|findBar'` → both 100%.
Then: `oxfmt apps/ && bun test` (full green).
```bash
git add apps/viewer/__tests__/image-card.test.ts apps/viewer/__tests__/find-bar.test.ts
git commit -m "test(viewer): cover imageCard and findBar via happy-dom + DI"
```

---

## Task 3: cli.ts DI refactor + run() coverage

**Files:**
- Modify: `apps/viewer/cli.ts`
- Create: `apps/viewer/__tests__/cli-run.test.ts`
- Read: `apps/viewer/cli.ts`, `apps/viewer/cli/args.ts`, `apps/viewer/cli/installSkill.ts`, `apps/viewer/cli/opener.ts`, `apps/viewer/__tests__/cli-smoke.test.ts`

**Interfaces:**
- Produces: `export interface CliDeps { startServer; buildUrl; resolvePort; parse; spawnOpener; installSkill; log; error; exit; onSignal; skillSource; viewerDir }` and `export const run = (argv: string[], deps: CliDeps): void`.
- The module keeps auto-invoking on real run via `if (import.meta.main) run(process.argv.slice(2), realDeps)`.

- [ ] **Step 1: Refactor `cli.ts` to `run(argv, deps)` + guarded entry**

Extract the current `main()` body into `run`, threading all side-effecting collaborators through `CliDeps` so a test can drive every branch without a real server/browser/exit. Preserve exact behaviour: `install-skill` is handled BEFORE flag parsing; `--help`/`--version` short-circuit; `exit(0)` after install/help/version; server-start failure prints and `exit(1)`; SIGINT/SIGTERM registered via `onSignal`.

```typescript
import { parseArgs, type ParsedArgs } from "./cli/args.ts";
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "./cli/installSkill.ts";
import { openerCommand } from "./cli/opener.ts";
import packageJson from "./package.json";
import { resolveDiffPort } from "./server/config.ts";
import { buildDiffViewerUrl } from "./server/link.ts";
import { startDiffServer } from "./server/server.ts";

const HELP = `diffdeck — local git diff viewer
… (unchanged text) …`;

export interface CliDeps {
	startServer: typeof startDiffServer;
	buildUrl: typeof buildDiffViewerUrl;
	resolvePort: typeof resolveDiffPort;
	parse: (argv: string[]) => ParsedArgs;
	spawnOpener: (url: string) => void; // wraps Bun.spawn(openerCommand(...))
	installSkill: (argv: string[]) => string[]; // does the install, returns target dirs
	log: (msg: string) => void;
	error: (msg: string) => void;
	exit: (code: number) => never;
	onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
	cwd: () => string;
	viewerDir: string;
}

export const run = (argv: string[], deps: CliDeps): void => {
	if (argv[0] === "install-skill") {
		const dirs = deps.installSkill(argv.slice(1));
		for (const dir of dirs) deps.log(`installed diffdeck skill → ${dir}/SKILL.md`);
		deps.exit(0);
	}
	const args = deps.parse(argv);
	if (args.help) { deps.log(HELP); deps.exit(0); }
	if (args.version) { deps.log(packageJson.version); deps.exit(0); }

	const port = args.port ?? deps.resolvePort();
	const repo = deps.cwd();
	let handle: ReturnType<typeof startDiffServer>;
	try {
		handle = deps.startServer({ port, viewerDir: deps.viewerDir });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		deps.error(`diffdeck: failed to start server on port ${port}: ${message}`);
		return deps.exit(1);
	}
	const url = deps.buildUrl({
		port: handle.server.port ?? port,
		repo, token: handle.token,
		untracked: args.untracked, watch: args.watch, flatten: args.flatten,
		treeSide: args.treeSide, diffStyle: args.diffStyle,
	});
	deps.log("diffdeck viewer running at:");
	deps.log(url);
	deps.log("Press Ctrl+C to stop.");
	if (args.open) deps.spawnOpener(url);
	const shutdown = (): void => { handle.stop(); deps.exit(0); };
	deps.onSignal("SIGINT", shutdown);
	deps.onSignal("SIGTERM", shutdown);
};

const realDeps: CliDeps = {
	startServer: startDiffServer,
	buildUrl: buildDiffViewerUrl,
	resolvePort: resolveDiffPort,
	parse: parseArgs,
	spawnOpener: (url) => {
		try {
			Bun.spawn(openerCommand(process.platform, url), {
				stdout: "ignore", stderr: "ignore",
			}).unref();
		} catch {
			// best-effort — URL already printed, server keeps running headless.
		}
	},
	installSkill: (argv) => {
		const opts = parseInstallArgs(argv);
		const source = `${import.meta.dir}/skills/diffdeck/SKILL.md`;
		const targets = resolveSkillTargets(opts);
		installSkillTo(source, targets);
		return targets;
	},
	log: (m) => console.log(m),
	error: (m) => console.error(m),
	exit: (code) => process.exit(code),
	onSignal: (sig, h) => { process.on(sig, h); },
	cwd: () => process.cwd(),
	viewerDir: `${import.meta.dir}/viewer`,
};

if (import.meta.main) run(process.argv.slice(2), realDeps);
```

Confirm `ParsedArgs` is exported from `cli/args.ts` (export it if not). Keep the `HELP` text byte-identical to the current file.

- [ ] **Step 2: Verify the smoke test still passes (behaviour preserved)**

Run: `bun run apps/viewer/build.ts && bun test apps/viewer/__tests__/cli-smoke.test.ts`
Expected: green — the packaged `dist/cli.js` still starts, prints the tokened URL, serves, and honours flags. If the smoke test fails, the refactor changed behaviour — fix before continuing.

- [ ] **Step 3: Write `cli-run.test.ts`**

Drive `run()` with fake deps (all `mock()`), asserting behaviour per branch. `exit` is a mock that throws a sentinel so control-flow stops (mirror how the real `process.exit` never returns); wrap each `run()` call to catch the sentinel.

```typescript
import { describe, expect, mock, test } from "bun:test";
import { run, type CliDeps } from "../cli.ts";

class ExitSignal extends Error { constructor(public code: number) { super("exit"); } }

const makeDeps = (over: Partial<CliDeps> = {}): CliDeps => ({
	startServer: mock(() => ({ server: { port: 5000 }, token: "tk", stop: mock() })),
	buildUrl: mock(() => "http://127.0.0.1:5000/?token=tk"),
	resolvePort: mock(() => 49573),
	parse: mock((argv: string[]) => ({ /* default ParsedArgs; override per test */ })) as CliDeps["parse"],
	spawnOpener: mock(),
	installSkill: mock(() => ["/home/u/.claude/skills/diffdeck"]),
	log: mock(), error: mock(),
	exit: mock((code: number) => { throw new ExitSignal(code); }) as CliDeps["exit"],
	onSignal: mock(), cwd: mock(() => "/repo"), viewerDir: "/v",
	...over,
});
```

Cases (each asserts on the mock calls; catch `ExitSignal` where the branch exits):
- `install-skill` (+ pass-through args) → `installSkill` called with `argv.slice(1)`; a log per target dir; `exit(0)`.
- `--help` (parse returns `{help:true}`) → HELP logged; `exit(0)`; server never started.
- `--version` → version logged; `exit(0)`.
- normal run (parse returns full args, `open:true`) → `startServer` called with `{port, viewerDir}`; `buildUrl` receives the port/token/flags; three log lines; `spawnOpener(url)` called; `onSignal` registered twice; the registered shutdown handler calls `handle.stop()` + `exit(0)`.
- `--no-open` (`open:false`) → `spawnOpener` NOT called.
- `args.port` set → `resolvePort` NOT called and that port used; unset → `resolvePort` used.
- server start throws → `error` logged with the message; `exit(1)`; `buildUrl` not called.
- `handle.server.port` undefined → falls back to the requested `port` in `buildUrl`.

- [ ] **Step 4: Run + coverage**

Run: `bun test apps/viewer/__tests__/cli-run.test.ts` → green.
Run: `bun test --coverage 2>&1 | grep -E 'cli\.ts'` → 100% funcs + lines.

- [ ] **Step 5: Format + full suite + commit**

Run: `oxfmt apps/ && bun run typecheck && bun test`
Expected: typecheck EXIT 0 (cli.ts is in the typecheck loop), full suite green.
```bash
git add apps/viewer/cli.ts apps/viewer/cli/args.ts apps/viewer/__tests__/cli-run.test.ts
git commit -m "refactor(cli): extract run(argv, deps) for testability; cover all branches"
```

---

## Task 4: Remove dead code + close server/diff.ts gaps

**Files:**
- Delete: `apps/viewer/server/ensure.ts`, `apps/viewer/__tests__/diff-ensure.test.ts`
- Modify: `apps/viewer/server/server.ts` (remove `idleTimeoutMs`), `apps/viewer/__tests__/diff-server.test.ts`, `apps/viewer/__tests__/built-serving.test.ts` (drop `idleTimeoutMs: 0`)
- Modify: `apps/viewer/server/diff.ts` (export `prBaseName`, `defaultBranchName`)
- Create: `apps/viewer/__tests__/diff-gaps.test.ts`
- Read: `apps/viewer/server/diff.ts`, `apps/viewer/server/server.ts`

**Interfaces:**
- Produces: `export const prBaseName`, `export const defaultBranchName` in `diff.ts` (currently module-private).

- [ ] **Step 1: Confirm `ensure.ts` is unused, then delete it + its test**

Run: `grep -rn "ensure.ts\|ensureDiffServer\|resetEnsureCache" apps/viewer --include='*.ts' | grep -v "__tests__/diff-ensure\|server/ensure.ts"`
Expected: no matches (only its own file + test reference it). Then:
```bash
git rm apps/viewer/server/ensure.ts apps/viewer/__tests__/diff-ensure.test.ts
```

- [ ] **Step 2: Remove `idleTimeoutMs` from `server.ts`**

In `startDiffServer`: drop the `idleTimeoutMs?: number` option, the `let lastActivity` declaration, and the entire `let idleTimer … if (idleTimeoutMs && idleTimeoutMs > 0) { … }` block. Simplify the `Bun.serve` call to `fetch: handler` (no `lastActivity` wrapper) and `stop()` to just `void server.stop(true)` (no `clearInterval`). Result:

```typescript
export const startDiffServer = (opts: {
	port: number;
	viewerDir: string;
	env?: Env;
}): DiffServerHandle => {
	const env = opts.env ?? process.env;
	const token = ensureToken(env);
	const handler = createHandler({ viewerDir: opts.viewerDir, token });
	const server = Bun.serve({ hostname: "127.0.0.1", port: opts.port, fetch: handler });
	const stop = (): void => { void server.stop(true); };
	return { server, token, stop };
};
```

- [ ] **Step 3: Drop `idleTimeoutMs: 0` from the two server tests**

Remove the `idleTimeoutMs: 0,` line from `diff-server.test.ts` (~line 32) and `built-serving.test.ts` (~line 29). No other change.

- [ ] **Step 4: Run the server suite (behaviour preserved)**

Run: `bun test apps/viewer/__tests__/diff-server.test.ts apps/viewer/__tests__/built-serving.test.ts`
Expected: green.

- [ ] **Step 5: Export the diff.ts git helpers**

Add `export` to `prBaseName` and `defaultBranchName` in `diff.ts`. No logic change.

- [ ] **Step 6: Write `diff-gaps.test.ts`**

Build small temp git repos with `bun`'s `$` and assert the previously-uncovered branches. Use `mkdtempSync`/`rmSync` like `cli-smoke.test.ts`.

Cases:
- **`prBaseName` spawn-error catch (line 35):** call `prBaseName("/no/such/dir/xyz")` (a non-existent `cwd`) → resolves to `null` without throwing (the `.cwd(nonexistent)` spawn rejects → caught).
- **`defaultBranchName` origin/HEAD-set branch (47-49):** in a fixture repo, create a bare "remote", add it as `origin`, and set `refs/remotes/origin/HEAD` → `main`:
  ```bash
  git -C repo remote add origin <bareRemote>
  git -C repo update-ref refs/remotes/origin/HEAD refs/remotes/origin/main   # or: git symbolic-ref
  ```
  Then `defaultBranchName(repo)` returns `"main"`. Also assert the no-origin case returns `null` (covers line 46).
- **renamed / added / deleted name-status parsing (219-231):** in a fixture repo with a committed base, produce a working tree that `git diff --name-status HEAD` reports as `R…`, `A…`, `D…`, and a plain modification, then `getDiffFiles(repo, { untracked: true })` returns entries whose `status` includes `renamed` (with `oldName`), `added`, `deleted`, `modified`, and an `untracked`. Assert the `renamed` entry's `oldName`/`name`.

Prefer driving through the exported `getDiffFiles`/`resolveBaseRef`/`defaultBranchName`/`prBaseName` — real git, no mocks.

- [ ] **Step 7: Run + coverage of server + diff**

Run: `bun test apps/viewer/__tests__/diff-gaps.test.ts` → green.
Run: `bun test --coverage 2>&1 | grep -E 'server/diff|server/server'`
Expected: `server/diff.ts` and `server/server.ts` both 100% funcs + lines. If a stray line remains, add a focused case.

- [ ] **Step 8: Format + full suite + commit**

Run: `oxfmt apps/ && bun run typecheck && bun test`
Expected: typecheck EXIT 0, full suite green (diff-ensure's tests are gone; new diff-gaps tests present).
```bash
git add -A apps/viewer/server apps/viewer/__tests__
git commit -m "refactor(server): drop dead ensure.ts + idle-timeout; cover diff.ts git-helper edges"
```

---

## Task 5: Coverage gate (bunfig + script)

**Files:**
- Modify: `bunfig.toml`
- Modify: `package.json` (root — add `test:coverage`)
- Read: current `bunfig.toml`

**Interfaces:** none.

- [ ] **Step 1: Add the coverage gate to `bunfig.toml`**

Append to the existing `[test]` table (keep `root` and `preload`):

```toml
# Coverage gate scoped to diffdeck's owned runtime code. Only fires when
# `--coverage` is passed (plain `bun test` stays fast). Vendored packages/*,
# build/e2e tooling, and the browser entry (main.ts, e2e-covered) are excluded.
coverageThreshold = { lines = 1, functions = 1, statements = 1 }
coveragePathIgnorePatterns = [
	"packages/**",
	"scripts/**",
	"apps/viewer/browser/main.ts",
	"apps/viewer/build.ts",
	"apps/viewer/e2e/**",
	"**/*.test.ts",
]
```

- [ ] **Step 2: Add the root `test:coverage` script**

In root `package.json` `scripts`: `"test:coverage": "bun test --coverage"`.

- [ ] **Step 3: Verify the gate passes at 100%**

Run: `bun run test:coverage`
Expected: exits 0. The printed table shows every non-ignored `apps/viewer/**` file at 100% funcs + lines, and no threshold-failure message.

- [ ] **Step 4: Verify the gate actually fails when coverage drops (sanity)**

Temporarily append an uncovered exported function to any owned file (e.g. `server/link.ts`), run `bun run test:coverage`, confirm it now FAILS with a threshold error, then revert the temporary change. (Do not commit the temporary change.) This proves the gate is live.

- [ ] **Step 5: Commit**

Run: `oxfmt apps/ packages/ && bun test`
```bash
git add bunfig.toml package.json
git commit -m "test: enforce 100% coverage gate on owned runtime code"
```

---

## Task 6: Playwright scaffolding + fixture + render smoke

> **CONTROLLER PRE-STEP (not for the subagent):** before dispatching this task, run
> `cd /Users/penguin/dev/diffdeck && bun add -D @playwright/test` and verify
> `channel: "chrome"` works (system Google Chrome present at
> `/Applications/Google Chrome.app`). Only then dispatch.

**Files:**
- Create: `apps/viewer/playwright.config.ts`
- Create: `apps/viewer/e2e/fixtures/repo.ts` (temp git-repo builder)
- Create: `apps/viewer/e2e/fixtures/app.ts` (Playwright fixture: spawn built CLI, capture URL)
- Create: `apps/viewer/e2e/global-setup.ts` (run `build.ts` once)
- Create: `apps/viewer/e2e/render.e2e.ts`
- Read: `apps/viewer/__tests__/cli-smoke.test.ts` (URL-capture + repo-seed patterns), `apps/viewer/build.ts`

**Interfaces:**
- Produces: `makeFixtureRepo(): { dir: string; cleanup(): void }`; a Playwright `test` extended with a worker-scoped `viewerUrl` fixture (spawns `dist/cli.js --no-open --port 0`, reads the tokened URL, kills on teardown).

- [ ] **Step 1: `playwright.config.ts`**

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: { channel: "chrome", headless: true },
	timeout: 30_000,
});
```

- [ ] **Step 2: `e2e/global-setup.ts`** — build once so `dist/cli.js` + `dist/viewer/` exist:

```typescript
export default async function globalSetup(): Promise<void> {
	const build = Bun.spawn(["bun", "run", `${import.meta.dir}/../build.ts`], {
		stdout: "pipe", stderr: "pipe",
	});
	if ((await build.exited) !== 0) throw new Error("diffdeck build failed for e2e");
}
```

- [ ] **Step 3: `e2e/fixtures/repo.ts`** — a deterministic fixture repo. Seed a committed base then working-tree changes:
  - `src/hello.ts` and `README.md`: committed, then edited (two text-diff files → tree nav needs ≥2).
  - `assets/logo.png`: commit a 1×1 PNG, then overwrite with a different PNG (binary image Old/New).
  - `data.txt`: an untracked file (for `--untracked`).
  - Optionally a large file (>1500 changed lines) for the collapsed-by-default check (used later).

  Use `mkdtempSync` + `bun`'s `$` (`git init/config/add/commit`). Embed the two tiny PNGs as base64 constants (a 1×1 red and 1×1 blue PNG). Return `{ dir, cleanup }`.

- [ ] **Step 4: `e2e/fixtures/app.ts`** — extend Playwright `test` with a `viewerUrl` fixture that spawns the built CLI in a fresh fixture repo, reads the tokened URL from stdout (reuse the `readUrlFromStdout` regex `http:\/\/127\.0\.0\.1:\d+\/\?\S+`), yields the URL, then `kill("SIGINT")`s the process and cleans the repo/cache. Provide a factory so a spec can launch with extra flags:

```typescript
import { test as base } from "@playwright/test";
// export const test = base.extend<{ viewerUrl: string }>({ viewerUrl: [async ({}, use) => { … }, { scope: "worker" }] });
// export const launchViewer = async (flags: string[]): Promise<{ url: string; stop(): void }> => { … };
```
Use a per-launch temp `XDG_CACHE_HOME` (like the smoke test) so tokens don't collide.

- [ ] **Step 5: `e2e/render.e2e.ts`** — the smoke spec:
  - navigate to `viewerUrl`; wait for the diff to load.
  - assert `#status` text matches `/\d+ file\(s\)/`.
  - assert at least one `diffs-container` (or `DIFFS_TAG_NAME`) is present.
  - assert the file tree lists `README.md` and `src/hello.ts` (query the tree container; it renders in a `<file-tree-container>` shadow DOM — pierce with `page.locator(...).locator(...)` or evaluate).
  - assert a syntax-highlight token (a `<span>` with a color style) exists inside a rendered diff.

- [ ] **Step 6: Run the smoke spec**

Run: `cd /Users/penguin/dev/diffdeck && bunx playwright test e2e/render.e2e.ts`
Expected: 1 passed. If `channel: "chrome"` is unavailable, the CONTROLLER falls back to `bunx playwright install chromium` + `channel` removed (report this back rather than guessing).

- [ ] **Step 7: Confirm `bun test` ignores e2e**

Run: `bun test 2>&1 | tail -3` → the e2e `*.e2e.ts` files are NOT collected (count unchanged from Task 5). If any e2e file is picked up, the naming/config is wrong — fix before commit.

- [ ] **Step 8: gitignore + commit**

Add `apps/viewer/test-results/` and `apps/viewer/playwright-report/` to `.gitignore`.
```bash
git add apps/viewer/playwright.config.ts apps/viewer/e2e .gitignore
git commit -m "test(e2e): Playwright scaffolding, fixture repo, and render smoke"
```

---

## Task 7: E2E interaction specs — tree-nav, fold, copy, find

**Files:**
- Create: `apps/viewer/e2e/tree-nav.e2e.ts`, `fold.e2e.ts`, `copy-path.e2e.ts`, `find.e2e.ts`
- Read: `apps/viewer/browser/main.ts` (behaviours), `packages/trees/src/render/FileTreeVanillaView.ts` (row markup / shadow DOM), the scratchpad `cdp-verify.ts` if referenced by the controller

**Interfaces:** consumes the `test`/`launchViewer` fixture from Task 6.

- [ ] **Step 1: `tree-nav.e2e.ts` — single-click navigation (regression guard)**

The fixed behaviour: **one** click on a file-tree row scrolls the diff to that file (the `FileTreeVanillaView` `#pointerInteracting` fix). Tree rows live in a `<file-tree-container>` shadow DOM.
- locate the row for `src/hello.ts`; perform a single `click()`.
- assert the diff scrolled so `src/hello.ts`'s container is in view (e.g. its header is visible / `scrollIntoViewIfNeeded` state, or compare `#diff` scrollTop before/after, or assert the file's container `isVisible()` within the viewport). Do NOT double-click.
- (optional) assert that before the click the target was out of view, to prove the click caused the scroll.

- [ ] **Step 2: `fold.e2e.ts` — header fold/unfold**
- click a file header (`[data-diffs-header]`); assert the file body collapses (code rows hidden / container height shrinks / chevron rotates to -90deg).
- click again; assert it expands.

- [ ] **Step 3: `copy-path.e2e.ts` — copy file path**
- grant clipboard permission (`context.grantPermissions(["clipboard-read", "clipboard-write"])`).
- hover the header, click the `[data-copy-name]` button, then read `navigator.clipboard.readText()` via `page.evaluate` → equals the file's path.

- [ ] **Step 4: `find.e2e.ts` — in-app find**
- press `Meta+F`/`Control+F`; assert `#find-bar` becomes visible.
- type a query known to appear in a fixture file; assert `#find-count` matches `/\d+\/\d+/` and `mark.cc-find-hit` exists (pierce shadow DOM as needed).
- press `Enter`; assert the active match (`mark.cc-find-hit--active`) advances.

- [ ] **Step 5: Run the four specs**

Run: `bunx playwright test e2e/tree-nav.e2e.ts e2e/fold.e2e.ts e2e/copy-path.e2e.ts e2e/find.e2e.ts`
Expected: all pass. Flaky waits → use Playwright web-first assertions (`expect(locator).toBeVisible()`), not fixed sleeps.

- [ ] **Step 6: Commit**
```bash
git add apps/viewer/e2e/tree-nav.e2e.ts apps/viewer/e2e/fold.e2e.ts apps/viewer/e2e/copy-path.e2e.ts apps/viewer/e2e/find.e2e.ts
git commit -m "test(e2e): tree single-click nav, fold, copy-path, in-app find"
```

---

## Task 8: E2E specs — flags-sync, image-diff

**Files:**
- Create: `apps/viewer/e2e/flags-sync.e2e.ts`, `image-diff.e2e.ts`
- Read: scratchpad `cdp-flags.ts` (assertion set — provided by the controller in the dispatch), `apps/viewer/browser/imageCard.ts`

**Interfaces:** consumes `launchViewer(flags)` from Task 6.

- [ ] **Step 1: `flags-sync.e2e.ts` — launch flags → toggle DOM**

Launch with `["--untracked","--watch","--no-flatten","--tree-right","--split"]`; after load assert (porting `cdp-flags.ts`):
- `#toggle-untracked`.checked === true
- `#toggle-watch`.checked === true
- `#toggle-flatten`.checked === false
- `#toggle-tree-side`.checked === true
- `#diff-style-group button[data-style="split"]` `aria-pressed` === "true"
- `[data-tree-side]` `data-tree-side` === "right"

(The overflow menu may need opening to reach the toggles — click `#overflow-btn` first if the inputs are inside it.)

- [ ] **Step 2: `image-diff.e2e.ts` — inline image Old/New cards**
- the fixture's changed `assets/logo.png` renders a `[data-image-card]` in the diff flow, containing `img-pane--old` and `img-pane--new` `<img>` elements (pierce the container shadow DOM). Assert both `<img>` have a non-empty `src` pointing at `/api/blob`.

- [ ] **Step 3: Run**

Run: `bunx playwright test e2e/flags-sync.e2e.ts e2e/image-diff.e2e.ts`
Expected: both pass.

- [ ] **Step 4: Full e2e run**

Run: `bunx playwright test`
Expected: all specs green.

- [ ] **Step 5: Commit**
```bash
git add apps/viewer/e2e/flags-sync.e2e.ts apps/viewer/e2e/image-diff.e2e.ts
git commit -m "test(e2e): launch-flag toggle sync and inline image diffs"
```

---

## Task 9: Scripts + docs

**Files:**
- Modify: `package.json` (root — add `test:e2e`)
- Modify: `README.md` (repo — Development section)
- Modify: `CLAUDE.md`
- Read: current `README.md`, `CLAUDE.md`

**Interfaces:** none.

- [ ] **Step 1: Add `test:e2e` script**

Root `package.json` `scripts`: `"test:e2e": "cd apps/viewer && bunx playwright test"` (build runs via Playwright `globalSetup`).

- [ ] **Step 2: README Development section**

Document the three test lanes:
- `bun test` — unit/integration (fast).
- `bun run test:coverage` — **100% gate on diffdeck's owned runtime code** (`apps/viewer/{browser,cli,server}`); vendored `packages/*`, `main.ts` (e2e-covered), and `build.ts` are intentionally out of the gate.
- `bun run test:e2e` — Playwright real-browser suite (uses the system Google Chrome via `channel: "chrome"`; covers `main.ts` and the vendored render paths end-to-end).

- [ ] **Step 3: CLAUDE.md**

Add to the project doc: the coverage-gate scope + exclusions (`main.ts`/`build.ts`/`packages`), the dead-code removal (`ensure.ts`, idle-timeout — diffdeck runs the server in the foreground), the e2e layout (`apps/viewer/e2e/*.e2e.ts`, fixture repo, system-Chrome), and the `*.e2e.ts` naming rule (keeps `bun test` from collecting Playwright specs).

- [ ] **Step 4: Verify + commit**

Run: `oxfmt apps/ packages/ && bun test && bun run test:coverage`
Expected: suite green, coverage gate passes.
```bash
git add package.json README.md CLAUDE.md
git commit -m "docs: document coverage gate and e2e suite; add test:e2e script"
```

---

## Self-Review (author)

- **Spec coverage:** A1 (Tasks 1-2) covers the four 0% DOM helpers; A2 (Task 3) `cli.ts`; A3 (Task 4) dead-code removal + `diff.ts`/`server.ts` gaps; A4 (Task 5) the gate; B (Tasks 6-8) Playwright + fixtures + specs (render, tree-nav, fold, copy, find, flags-sync, image-diff); C (Task 9) scripts + docs. All spec sections map to a task.
- **Placeholder scan:** production code (cli.ts, server.ts edit, bunfig, playwright.config, global-setup) is shown in full; tests are specified case-by-case with concrete seams (fake timers, shadow-DOM builders, ExitSignal). No TBD/TODO.
- **Type consistency:** `CliDeps`/`run` signatures match between Task 3's refactor and its test; `ParsedArgs` exported from `cli/args.ts`; `viewerUrl`/`launchViewer` fixture names consistent across Tasks 6-8.
- **Ordering:** Task 5's gate depends on Tasks 1-4 hitting 100%; Tasks 7-8 depend on Task 6's fixtures; the controller installs `@playwright/test` before Task 6.

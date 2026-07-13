# diffdeck Launch View Flags — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CLI flags (`--untracked`, `--watch`, `--no-flatten`, `--tree-right`, `--split`) that launch the diffdeck viewer with those toggles pre-set for this session, with the in-app toggle switches synced to the launched state.

**Architecture:** CLI flags → `parseArgs` → `buildDiffViewerUrl` appends URL query params (only when different from default) → the viewer resolves each toggle's initial state as `URL param ?? localStorage ?? default` via pure resolvers in `prefs.ts`, then sets both the functional variable AND the toggle UI from that one value. Session-only: the URL-driven init never writes localStorage, so saved prefs are untouched.

**Tech Stack:** Bun (runtime + bundler + test), TypeScript 6.

## Global Constraints

- **Session-only:** a flag sets the initial state for this launch only; the viewer's URL-driven init MUST NOT call `localStorage.setItem`. Saved prefs are untouched (next launch without flags reverts to saved).
- **Sync invariant:** at initial render, each toggle's UI state (input `checked` / segment `aria-pressed`) MUST equal its functional variable MUST equal the flag value. Achieve this structurally: set both from the same resolver return value.
- **Precedence:** each state resolves as `URL param (if present) → localStorage (if that toggle persists) → default`. Precedence logic lives in **pure functions** in `apps/viewer/browser/prefs.ts` (extending the existing `readFlatten`/`readTreeSide` pattern) and is unit-tested.
- **mode is out of scope** — the existing `mode` URL param persists to localStorage (a different UX for the `✏️ vs base` link); do not add a `--base` flag and do not change mode's behavior.
- Defaults (must match today's viewer): `untracked` off, `watch` off, `flatten` **on**, `treeSide` **left**, `diffStyle` **unified**. URL params are appended by `buildDiffViewerUrl` ONLY when the value differs from these defaults (keeps URLs clean): `untracked=1`, `watch=1`, `flatten=0`, `tree=right`, `style=split`.
- No engine (`packages/**`) changes. No new dependencies. No `bun install`.
- `apps/viewer/browser/**` is intentionally OUTSIDE the typecheck loop (`apps/viewer/tsconfig.json` includes `server/**`, `cli.ts`, `cli/**`, `build.ts` only). So `prefs.ts`/`main.ts` type errors are caught by the build + unit tests, not `tsc`. Keep the real logic in the unit-tested pure resolvers; `main.ts` is thin wiring.
- Docs are required deliverables (Task 4): update `README.md` (CLI options) and `CLAUDE.md`.
- Gate for each task: `bun run typecheck` EXIT 0 and the task's tests green.

## File Structure

Modified:
- `apps/viewer/cli/args.ts` — `ParsedArgs` view fields + flag parsing.
- `apps/viewer/browser/prefs.ts` — 5 pure resolvers + `WATCH_KEY`.
- `apps/viewer/server/link.ts` — `buildDiffViewerUrl` appends view params.
- `apps/viewer/cli.ts` — pass parsed view opts to `buildDiffViewerUrl`.
- `apps/viewer/browser/main.ts` — init via resolvers + sync toggle UI (no localStorage write).
- `README.md`, `CLAUDE.md` — docs.
- Tests: `apps/viewer/__tests__/cli-args.test.ts`, `diff-link.test.ts`, `viewer-prefs.test.ts` (extend existing), `cli-smoke.test.ts` (extend).

---

### Task 1: Pure resolvers + parseArgs flags

**Files:**
- Modify: `apps/viewer/browser/prefs.ts`
- Modify: `apps/viewer/cli/args.ts`
- Test: `apps/viewer/__tests__/viewer-prefs.test.ts`, `apps/viewer/__tests__/cli-args.test.ts`

**Interfaces:**
- Produces (prefs.ts):
  - `WATCH_KEY = "cc-statusline:diff-watch"`
  - `resolveUntracked(urlParam: string | null): boolean`
  - `resolveDiffStyle(urlParam: string | null): "unified" | "split"`
  - `resolveFlatten(urlParam: string | null, get: Getter): boolean`
  - `resolveTreeSide(urlParam: string | null, get: Getter): TreeSide`
  - `resolveWatch(urlParam: string | null, get: Getter): boolean`
- Produces (args.ts): `ParsedArgs` gains `untracked: boolean; watch: boolean; flatten: boolean; treeSide: "left"|"right"; diffStyle: "unified"|"split"`.

- [ ] **Step 1: Write the failing resolver test**

Append to `apps/viewer/__tests__/viewer-prefs.test.ts`:
```typescript
import {
	resolveDiffStyle,
	resolveFlatten,
	resolveTreeSide,
	resolveUntracked,
	resolveWatch,
} from "../browser/prefs.ts";

describe("launch-flag resolvers (URL param → localStorage → default)", () => {
	const empty = (_k: string) => null;
	const get =
		(store: Record<string, string>) =>
		(k: string): string | null =>
			store[k] ?? null;

	test("resolveUntracked: URL only, default false", () => {
		expect(resolveUntracked(null)).toBe(false);
		expect(resolveUntracked("1")).toBe(true);
		expect(resolveUntracked("0")).toBe(false);
	});
	test("resolveDiffStyle: URL only, default unified", () => {
		expect(resolveDiffStyle(null)).toBe("unified");
		expect(resolveDiffStyle("split")).toBe("split");
		expect(resolveDiffStyle("unified")).toBe("unified");
	});
	test("resolveFlatten: URL wins, else localStorage, else default on", () => {
		expect(resolveFlatten("0", empty)).toBe(false);
		expect(resolveFlatten("1", get({ "cc-statusline:flatten": "0" }))).toBe(true);
		expect(resolveFlatten(null, get({ "cc-statusline:flatten": "0" }))).toBe(false);
		expect(resolveFlatten(null, empty)).toBe(true);
	});
	test("resolveTreeSide: URL wins, else localStorage, else default left", () => {
		expect(resolveTreeSide("right", empty)).toBe("right");
		expect(resolveTreeSide("left", get({ "cc-statusline:tree-side": "right" }))).toBe("left");
		expect(resolveTreeSide(null, get({ "cc-statusline:tree-side": "right" }))).toBe("right");
		expect(resolveTreeSide(null, empty)).toBe("left");
	});
	test("resolveWatch: URL wins, else localStorage, else default off", () => {
		expect(resolveWatch("1", empty)).toBe(true);
		expect(resolveWatch("0", get({ "cc-statusline:diff-watch": "1" }))).toBe(false);
		expect(resolveWatch(null, get({ "cc-statusline:diff-watch": "1" }))).toBe(true);
		expect(resolveWatch(null, empty)).toBe(false);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/viewer-prefs.test.ts`
Expected: FAIL — the resolvers are not exported from `prefs.ts` yet.

- [ ] **Step 3: Add resolvers to `prefs.ts`**

Append to `apps/viewer/browser/prefs.ts`:
```typescript
export const WATCH_KEY = "cc-statusline:diff-watch";

export const resolveUntracked = (urlParam: string | null): boolean =>
	urlParam === "1";

export const resolveDiffStyle = (
	urlParam: string | null,
): "unified" | "split" => (urlParam === "split" ? "split" : "unified");

export const resolveFlatten = (
	urlParam: string | null,
	get: Getter,
): boolean =>
	urlParam === "0" ? false : urlParam === "1" ? true : readFlatten(get);

export const resolveTreeSide = (
	urlParam: string | null,
	get: Getter,
): TreeSide =>
	urlParam === "right"
		? "right"
		: urlParam === "left"
			? "left"
			: readTreeSide(get);

export const resolveWatch = (urlParam: string | null, get: Getter): boolean =>
	urlParam === "1" ? true : urlParam === "0" ? false : get(WATCH_KEY) === "1";
```

- [ ] **Step 4: Run to verify resolver test passes**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/viewer-prefs.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing parseArgs test**

Append to `apps/viewer/__tests__/cli-args.test.ts`:
```typescript
describe("launch view flags", () => {
	test("defaults: untracked/watch off, flatten on, tree left, style unified", () => {
		expect(parseArgs([])).toMatchObject({
			untracked: false,
			watch: false,
			flatten: true,
			treeSide: "left",
			diffStyle: "unified",
		});
	});
	test("each flag flips its field", () => {
		expect(
			parseArgs(["--untracked", "--watch", "--no-flatten", "--tree-right", "--split"]),
		).toMatchObject({
			untracked: true,
			watch: true,
			flatten: false,
			treeSide: "right",
			diffStyle: "split",
		});
	});
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-args.test.ts`
Expected: FAIL — the fields don't exist on `ParsedArgs` yet.

- [ ] **Step 7: Extend `parseArgs`**

In `apps/viewer/cli/args.ts`, replace the `ParsedArgs` interface and the `result` initializer + loop:
```typescript
export interface ParsedArgs {
	port?: number;
	open: boolean;
	help: boolean;
	version: boolean;
	untracked: boolean;
	watch: boolean;
	flatten: boolean;
	treeSide: "left" | "right";
	diffStyle: "unified" | "split";
}
```
In `parseArgs`, initialize the new fields:
```typescript
	const result: ParsedArgs = {
		open: true,
		help: false,
		version: false,
		untracked: false,
		watch: false,
		flatten: true,
		treeSide: "left",
		diffStyle: "unified",
	};
```
Add these branches in the arg loop (after the `--version`/`-v` branch, before the closing `}`):
```typescript
		} else if (arg === "--untracked") {
			result.untracked = true;
		} else if (arg === "--watch") {
			result.watch = true;
		} else if (arg === "--no-flatten") {
			result.flatten = false;
		} else if (arg === "--tree-right") {
			result.treeSide = "right";
		} else if (arg === "--split") {
			result.diffStyle = "split";
```

- [ ] **Step 8: Run both tests + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/viewer-prefs.test.ts apps/viewer/__tests__/cli-args.test.ts && bun run typecheck`
Expected: both files PASS; typecheck EXIT 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/browser/prefs.ts apps/viewer/cli/args.ts apps/viewer/__tests__/viewer-prefs.test.ts apps/viewer/__tests__/cli-args.test.ts
git commit -m "feat(cli): parse launch view flags + pure toggle-state resolvers"
```

---

### Task 2: URL params in buildDiffViewerUrl + CLI wiring + smoke

**Files:**
- Modify: `apps/viewer/server/link.ts`
- Modify: `apps/viewer/cli.ts`
- Test: `apps/viewer/__tests__/diff-link.test.ts`, `apps/viewer/__tests__/cli-smoke.test.ts`

**Interfaces:**
- Consumes: `ParsedArgs` view fields (Task 1).
- Produces: `buildDiffViewerUrl` accepts `untracked?`, `watch?`, `flatten?`, `treeSide?`, `diffStyle?` and appends the corresponding query params only when different from default.

- [ ] **Step 1: Write the failing link test**

Append to `apps/viewer/__tests__/diff-link.test.ts`:
```typescript
describe("buildDiffViewerUrl view flags", () => {
	const base = { port: 49573, repo: "/r", token: "t" };
	test("no view flags → no view params", () => {
		const url = buildDiffViewerUrl(base);
		expect(url).not.toContain("untracked");
		expect(url).not.toContain("style");
		expect(url).not.toContain("tree");
		expect(url).not.toContain("flatten");
		expect(url).not.toContain("watch");
	});
	test("non-default values are appended", () => {
		const url = buildDiffViewerUrl({
			...base,
			untracked: true,
			watch: true,
			flatten: false,
			treeSide: "right",
			diffStyle: "split",
		});
		const q = new URL(url).searchParams;
		expect(q.get("untracked")).toBe("1");
		expect(q.get("watch")).toBe("1");
		expect(q.get("flatten")).toBe("0");
		expect(q.get("tree")).toBe("right");
		expect(q.get("style")).toBe("split");
	});
	test("default values are NOT appended (flatten:true, treeSide:left, diffStyle:unified)", () => {
		const url = buildDiffViewerUrl({
			...base,
			untracked: false,
			watch: false,
			flatten: true,
			treeSide: "left",
			diffStyle: "unified",
		});
		expect(new URL(url).search).toBe(`?repo=%2Fr&token=t`);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/diff-link.test.ts`
Expected: FAIL — the params are not appended yet.

- [ ] **Step 3: Extend `buildDiffViewerUrl`**

Replace the body of `apps/viewer/server/link.ts`:
```typescript
export const buildDiffViewerUrl = (params: {
	port: number;
	repo: string;
	token: string;
	mode?: "working" | "base";
	untracked?: boolean;
	watch?: boolean;
	flatten?: boolean;
	treeSide?: "left" | "right";
	diffStyle?: "unified" | "split";
}): string => {
	const query = new URLSearchParams({
		repo: params.repo,
		token: params.token,
	});
	if (params.mode) query.set("mode", params.mode);
	// Append view flags only when they differ from the viewer's own defaults
	// (untracked off, watch off, flatten on, tree left, style unified).
	if (params.untracked) query.set("untracked", "1");
	if (params.watch) query.set("watch", "1");
	if (params.flatten === false) query.set("flatten", "0");
	if (params.treeSide === "right") query.set("tree", "right");
	if (params.diffStyle === "split") query.set("style", "split");
	return `http://127.0.0.1:${params.port}/?${query.toString()}`;
};
```

- [ ] **Step 4: Run link test to verify it passes**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/diff-link.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the flags through `cli.ts`**

In `apps/viewer/cli.ts`, extend the `buildDiffViewerUrl` call (currently `{ port, repo, token }`) to pass the parsed view flags:
```typescript
	const url = buildDiffViewerUrl({
		port: handle.server.port ?? port,
		repo,
		token: handle.token,
		untracked: args.untracked,
		watch: args.watch,
		flatten: args.flatten,
		treeSide: args.treeSide,
		diffStyle: args.diffStyle,
	});
```

- [ ] **Step 6: Extend the smoke test to assert the URL carries the flags**

Append to `apps/viewer/__tests__/cli-smoke.test.ts` a test that spawns the built CLI with view flags and checks the printed URL. Reuse the file's existing build + `readUrlFromStdout` helpers (they already exist in this file). Add inside the existing `describe("packaged cli.js", ...)` or a new describe:
```typescript
test("view flags appear in the printed URL", async () => {
	const cliPath = join(import.meta.dir, "..", "dist", "cli.js");
	const repo = mkdtempSync(join(tmpdir(), "dd-flags-repo-"));
	await $`git -C ${repo} init -q`;
	const cache = mkdtempSync(join(tmpdir(), "dd-flags-cache-"));
	const p = Bun.spawn(
		["bun", cliPath, "--no-open", "--port", "0", "--untracked", "--split", "--tree-right", "--watch", "--no-flatten"],
		{ cwd: repo, env: { ...process.env, XDG_CACHE_HOME: cache }, stdout: "pipe", stderr: "pipe" },
	);
	const url = await readUrlFromStdout(p.stdout);
	const q = new URL(url).searchParams;
	expect(q.get("untracked")).toBe("1");
	expect(q.get("style")).toBe("split");
	expect(q.get("tree")).toBe("right");
	expect(q.get("watch")).toBe("1");
	expect(q.get("flatten")).toBe("0");
	p.kill("SIGINT");
	await p.exited;
	rmSync(repo, { recursive: true, force: true });
	rmSync(cache, { recursive: true, force: true });
});
```
If the existing test file does not already import `mkdtempSync`, `rmSync`, `tmpdir`, `join`, `$`, add them (they are already used by the file's other tests — reuse the existing imports; only add what's missing).

- [ ] **Step 7: Run smoke + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-smoke.test.ts && bun run typecheck`
Expected: PASS; typecheck EXIT 0. (The smoke test builds `dist/cli.js` in its `beforeAll`.)

- [ ] **Step 8: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/server/link.ts apps/viewer/cli.ts apps/viewer/__tests__/diff-link.test.ts apps/viewer/__tests__/cli-smoke.test.ts
git commit -m "feat(cli): pass launch view flags into the viewer URL"
```

---

### Task 3: Viewer init wiring + toggle sync (session-only)

**Files:**
- Modify: `apps/viewer/browser/main.ts`

**Interfaces:**
- Consumes: the 5 resolvers + `WATCH_KEY` (Task 1); the URL params emitted by `buildDiffViewerUrl` (Task 2). `params` (a `URLSearchParams`) already exists at `main.ts:27`.

- [ ] **Step 1: Wire the initial-state variables through the resolvers**

`main.ts` already has `const params = new URLSearchParams(location.search)` at line 27. Update the imports from `./prefs.ts` to include the new resolvers + `WATCH_KEY`, then change the four init declarations (currently lines ~99-103):
```typescript
let diffStyle: "unified" | "split" = resolveDiffStyle(params.get("style"));
let includeUntracked = resolveUntracked(params.get("untracked"));
```
```typescript
let flattenDirs = resolveFlatten(params.get("flatten"), (k) => localStorage.getItem(k));
let treeSide: TreeSide = resolveTreeSide(params.get("tree"), (k) => localStorage.getItem(k));
```
(`diffMode` at line 101 is unchanged — mode is out of scope.)

- [ ] **Step 2: Sync the watch init through the resolver**

Replace the watch-init guard (currently `if (watchInput && localStorage.getItem(WATCH_STORAGE_KEY) === "1") {`) with the resolver, and use the imported `WATCH_KEY` (remove the local `WATCH_STORAGE_KEY` const if it becomes unused, or keep it pointing at `WATCH_KEY` — the change-handler `localStorage.setItem(WATCH_STORAGE_KEY, …)` must keep the same key string):
```typescript
if (
	watchInput &&
	resolveWatch(params.get("watch"), (k) => localStorage.getItem(k))
) {
	watchInput.checked = true;
	startWatch();
}
```
Note: this does NOT `localStorage.setItem` — session-only. The existing change-handler still persists on user toggle.

- [ ] **Step 2b: Sync the untracked toggle UI at init**

The untracked toggle input currently has no init sync (it relies on the HTML default unchecked + `includeUntracked=false`). Now that `includeUntracked` can start true from a flag, reflect it on the input. Where `untrackedInput` is defined (currently ~line 429), after obtaining the element add:
```typescript
if (untrackedInput) untrackedInput.checked = includeUntracked;
```

- [ ] **Step 2c: Sync the unified/split segment UI at init**

`diffStyle` can now start as `"split"`. Ensure the `#diff-style-group` segment reflects it at first paint. The file already has a function that sets each segment button's `aria-pressed`/active state from `diffStyle` (around lines 408-415); call that function once during init (after `diffStyle` is set) so a `--split` launch shows Split as active. If that update is currently inline inside the click handler, extract the "reflect diffStyle onto the segment buttons" lines into a small local function and call it once at init as well as from the handler (DRY). Do not change the diff-rendering behavior — only the segment's visual/aria state.

- [ ] **Step 3: Build to verify the viewer bundle compiles**

Run: `cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts 2>&1 | tail -2`
Expected: `viewer build: …` success line (Bun bundles `main.ts`; a syntax/reference error would fail the build).

- [ ] **Step 4: Verify toggle-sync end-to-end with the CDP harness (controller/manual)**

The `main.ts` wiring is thin (calls the unit-tested resolvers), but the **sync invariant** is the whole point of this feature, so verify it in a real headless browser. Start the built CLI on a repo with changes, in the background, launched with flags, then assert the DOM toggles match:
```bash
cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts >/dev/null
# launch with flags on a repo that has changes (use any repo with a working-tree diff):
# bun apps/viewer/dist/cli.js --no-open --port 0 --untracked --split --tree-right --watch --no-flatten
```
Then, via a headless-Chrome CDP check (adapt the earlier `scratchpad/cdp-verify.ts` harness), open the printed URL and assert:
- `#toggle-untracked`.checked === true, `#toggle-flatten`.checked === false, `#toggle-tree-side`.checked === true (right), the watch toggle checked === true, and the `#diff-style-group` Split button is active (`aria-pressed="true"`);
- and that `appEl.dataset.treeSide === "right"` (functional state matches).
Report the observed values. This is a controller-run verification gate, not a committed test (the committed regression coverage is the pure-resolver unit tests from Task 1). If any toggle UI does not match its flag, fix the corresponding sync line in `main.ts` and re-verify.

- [ ] **Step 5: Full suite + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun run typecheck && bun test 2>&1 | tail -4`
Expected: typecheck EXIT 0 (note: `main.ts` is outside the typecheck loop, but `prefs.ts`/`args.ts`/`link.ts` are exercised by unit tests and the build); full suite green.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/browser/main.ts
git commit -m "feat(viewer): init toggles from launch flags, synced UI, session-only"
```

---

### Task 4: Docs — README + CLAUDE.md

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: the flags from Tasks 1-3. Produces: user + contributor docs.

- [ ] **Step 1: Add the flags to the README CLI options table**

In `README.md`, in the `## CLI` section's Options table, add rows after the existing `--no-open` row:
```markdown
| `--untracked` | Start with untracked files included |
| `--watch` | Start with watch (auto-refresh) on |
| `--no-flatten` | Start with the file tree un-flattened (flatten is on by default) |
| `--tree-right` | Start with the file tree on the right |
| `--split` | Start in split view (unified is the default) |
```
And add one sentence after the table: `These view flags set the initial state for this launch only — they don't change your saved preferences, and the in-app toggles reflect the launched state.`

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`, update the relevant sections to record the new capability:
- In the WHY section's viewer-feature description (where Working tree/Include untracked/Watch/Flatten/tree side are described), add a note that these are also settable at launch via CLI flags (`--untracked`, `--watch`, `--no-flatten`, `--tree-right`, `--split`), session-only, with the in-app toggles synced to the launched state, resolved via `browser/prefs.ts` pure resolvers (URL param → localStorage → default).
- If `CLAUDE.md` documents the CLI usage/flags anywhere, add the five flags there too.
Keep the additions concise and consistent with the file's existing Korean style.

- [ ] **Step 3: oxfmt the docs + verify fences**

Run: `cd /Users/penguin/dev/diffdeck && bunx oxfmt README.md CLAUDE.md 2>&1 | tail -2 && grep -c '^```' README.md`
Expected: oxfmt runs clean; README fence count is even.

- [ ] **Step 4: Final full gate**

Run: `cd /Users/penguin/dev/diffdeck && bun run typecheck && bun test 2>&1 | tail -4`
Expected: typecheck EXIT 0; full suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add README.md CLAUDE.md
git commit -m "docs: document launch view flags in README + CLAUDE.md"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-13-diffdeck-launch-view-flags-design.md`):
- 5 flags (`--untracked`/`--watch`/`--no-flatten`/`--tree-right`/`--split`) → Task 1 parseArgs. ✅
- URL params only-when-non-default → Task 2 buildDiffViewerUrl. ✅
- Pure resolvers (URL → localStorage → default) in prefs.ts + units → Task 1. ✅
- Viewer init via resolvers + toggle sync + no localStorage write (session-only) → Task 3. ✅
- Sync invariant verified end-to-end (CDP) → Task 3 Step 4. ✅
- mode excluded / mode behavior untouched → Global Constraints; `diffMode` init left unchanged (Task 3 Step 1). ✅
- Docs README + CLAUDE.md → Task 4 (user-required deliverable). ✅
- Non-goals (no mode flag, no persist, no engine change) honored. ✅

**2. Placeholder scan:** No TBD/vague steps — resolver/parseArgs/link code is complete. Task 3's segment-sync (Step 2c) references the existing update logic by line region and instructs a DRY extraction rather than pasting code that may not match the current handler exactly; this is deliberate (the implementer reads the real handler), and the behavior is fully specified.

**3. Type consistency:** `ParsedArgs` fields (Task 1) match `buildDiffViewerUrl` params (Task 2) and the `cli.ts` call (Task 2 Step 5) and the resolver param types (Task 1) and `main.ts` usage (Task 3). Defaults (untracked false, watch false, flatten true, treeSide left, diffStyle unified) are consistent across parseArgs init, buildDiffViewerUrl "only-when-different" conditions, and the resolvers.

**Edge notes for the executor:**
- `main.ts` and `prefs.ts` are outside the typecheck loop; the safety nets are the unit tests (resolvers, parseArgs, link) + the build + the Task 3 CDP verification. Keep logic in the tested resolvers.
- The watch change-handler and the watch init must use the SAME localStorage key string (`cc-statusline:diff-watch`) — `WATCH_KEY` in prefs.ts is that string; don't introduce a second constant with a different value.

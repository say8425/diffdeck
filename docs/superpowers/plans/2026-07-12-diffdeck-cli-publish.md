# diffdeck CLI + Publish-Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `apps/viewer` into the publishable CLI product `@say8425/diffdeck` — `bunx @say8425/diffdeck` starts the diff server in the current git repo and opens the viewer in a browser — with all publish prerequisites in place (bundle, package.json, docs) but the actual `npm publish` left as a user-confirmed gate.

**Architecture:** `apps/viewer` becomes the distributable package. A new `cli.ts` entry composes the existing self-contained server (`server/*.ts`) + a browser-opener, bundled by `build.ts` into `dist/cli.js` (target bun) alongside the pre-bundled browser viewer in `dist/viewer/`. The forked `@diffdeck/*` packages stay build-time-only (bundled into `dist`), so the published tarball has zero runtime dependencies and uses only `git`/`gh` subprocesses. Server stays repo-agnostic — the repo is passed per-request via URL query, and the CLI supplies `process.cwd()`.

**Tech Stack:** Bun (runtime + bundler + test runner + `bun publish`), TypeScript 6, oxlint/oxfmt.

## Global Constraints

- Runtime is **Bun** — bin is a bun-target bundle run by `bunx`; mirror cc-statusline's publish pattern (`bin` + `files:["dist"]` + `publishConfig` npmjs + `target:"bun"` bundle), **no shebang** (cc-statusline ships none and `bunx` runs bins with bun).
- **Rebrand only the user-facing surface**, exact renames: env `CC_STATUSLINE_DIFF_PORT`→`DIFFDECK_PORT`, env `CC_STATUSLINE_DIFF_DISABLE`→`DIFFDECK_DISABLE`, cache dir segment `"cc-statusline"`→`"diffdeck"`, ping response header `x-cc-statusline`→`x-diffdeck`, browser tab `<title>` `cc-statusline diff`→`diffdeck`.
- **Do NOT rebrand internal persistence**: the `cc-statusline:` localStorage key prefixes in `browser/prefs.ts` and `browser/main.ts` are internal state, not exposed named surface — leave them (spec YAGNI clause). Do not touch engine logic, `packages/**`, or the viewer's features.
- **DRY**: reuse the existing `buildDiffViewerUrl` from `apps/viewer/server/link.ts` for the CLI URL — do not create a second URL builder.
- Package name `@say8425/diffdeck`, version `0.1.0`, `bin` `{"diffdeck":"dist/cli.js"}`, `files` `["dist"]`, `publishConfig` `{"registry":"https://registry.npmjs.org"}`.
- **HARD GATES (never auto-execute):** the actual `npm publish`/`bun publish` (Task 5 stops at `bun publish --dry-run`); any cc-statusline cutover PR (out of scope entirely — user does it after local testing).
- **`bun install` and `bun.lock` edits are controller-only**, run once and carefully (workspace races destroy `node_modules`). Implementer subagents MUST NOT run `bun install`. Moving `@diffdeck/*` deps→devDeps (Task 4) changes `bun.lock`; the controller syncs it separately after the task, mirroring Plan 4.
- Vendored `packages/**` is out of scope for Plan 5 — all edits are in `apps/viewer/**`, `docs/**`, `README.md`, and `tsconfig.base.json` (repo-formatted; the Edit/Write tools are fine here).
- Verification gate for every task: `bun run typecheck` (from repo root) EXIT 0 and the task's tests green.

---

## File Structure

Created:
- `apps/viewer/cli.ts` — bin entry: parse args → start server → print URL → open browser → SIGINT/SIGTERM graceful stop.
- `apps/viewer/cli/args.ts` — pure `parseArgs(argv)`.
- `apps/viewer/cli/opener.ts` — pure `openerCommand(platform, url)`.
- `apps/viewer/__tests__/cli-args.test.ts`, `apps/viewer/__tests__/cli-opener.test.ts`, `apps/viewer/__tests__/cli-smoke.test.ts`.
- `README.md` (repo root) — CLI usage + publish checklist (create if absent, else add sections).

Modified:
- `apps/viewer/server/config.ts` — env + cache-dir rename.
- `apps/viewer/server/server.ts` — ping header rename.
- `apps/viewer/server/ensure.ts` — probe header + spawn env rename.
- `apps/viewer/index.html` — `<title>` rename.
- `apps/viewer/__tests__/diff-config.test.ts`, `diff-ensure.test.ts`, `diff-server.test.ts` — assertions updated to new names.
- `apps/viewer/build.ts` — add cli bundle; move viewer bundle to `dist/viewer/`.
- `apps/viewer/__tests__/built-serving.test.ts` — repoint `distDir` to `dist/viewer`.
- `apps/viewer/tsconfig.json` — include `cli.ts` + `cli/**`, drop `serve.ts`.
- `tsconfig.base.json` — add `resolveJsonModule: true`.
- `apps/viewer/package.json` — rebrand to publishable `@say8425/diffdeck`.

Deleted:
- `apps/viewer/serve.ts` — superseded by `cli.ts`.

Final `dist/` layout produced by `build.ts`:
```
dist/
  cli.js              # bin entry (server + CLI bundled, target bun)
  viewer/
    main.js           # browser viewer (forked packages bundled in)
    index.html
```

---

### Task 1: Minimal rebrand (user-facing surface)

Pure rename of the four branding surfaces + browser title, with the tests updated first so each rename is proven by a failing→passing assertion.

**Files:**
- Modify: `apps/viewer/server/config.ts`
- Modify: `apps/viewer/server/server.ts:46`
- Modify: `apps/viewer/server/ensure.ts:28,65`
- Modify: `apps/viewer/index.html:6`
- Test: `apps/viewer/__tests__/diff-config.test.ts`, `apps/viewer/__tests__/diff-ensure.test.ts`, `apps/viewer/__tests__/diff-server.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: env `DIFFDECK_PORT` / `DIFFDECK_DISABLE` (read by `resolveDiffPort`/`isDiffViewerDisabled`), cache dir `~/.cache/diffdeck` (from `getCacheDir`), ping header `x-diffdeck: 1` (emitted by `/api/ping`, probed by `ensureDiffServer`). Later tasks (CLI, smoke test) rely on these exact names.

- [ ] **Step 1: Update the config tests to the new names (failing)**

In `apps/viewer/__tests__/diff-config.test.ts`, replace every `CC_STATUSLINE_DIFF_PORT` with `DIFFDECK_PORT`, every `CC_STATUSLINE_DIFF_DISABLE` with `DIFFDECK_DISABLE`, and every `cc-statusline` cache segment with `diffdeck`. The full updated file:

```typescript
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_DIFF_PORT,
	getCacheDir,
	isDiffViewerDisabled,
	resolveDiffPort,
} from "../server/config.ts";

describe("resolveDiffPort", () => {
	test("defaults when unset", () => {
		expect(resolveDiffPort({})).toBe(DEFAULT_DIFF_PORT);
	});
	test("uses valid override", () => {
		expect(resolveDiffPort({ DIFFDECK_PORT: "51000" })).toBe(51000);
	});
	test("falls back on invalid override", () => {
		expect(resolveDiffPort({ DIFFDECK_PORT: "abc" })).toBe(DEFAULT_DIFF_PORT);
		expect(resolveDiffPort({ DIFFDECK_PORT: "70000" })).toBe(DEFAULT_DIFF_PORT);
		expect(resolveDiffPort({ DIFFDECK_PORT: "0" })).toBe(DEFAULT_DIFF_PORT);
	});
});

describe("isDiffViewerDisabled", () => {
	test("true only when exactly '1'", () => {
		expect(isDiffViewerDisabled({ DIFFDECK_DISABLE: "1" })).toBe(true);
		expect(isDiffViewerDisabled({ DIFFDECK_DISABLE: "0" })).toBe(false);
		expect(isDiffViewerDisabled({})).toBe(false);
	});
});

describe("getCacheDir", () => {
	test("respects XDG_CACHE_HOME", () => {
		expect(getCacheDir({ XDG_CACHE_HOME: "/tmp/xdg" })).toBe("/tmp/xdg/diffdeck");
	});
	test("falls back to ~/.cache", () => {
		const dir = getCacheDir({ HOME: "/home/x" });
		expect(dir.endsWith("/diffdeck")).toBe(true);
	});
});
```

- [ ] **Step 2: Update the ensure + server-header tests to the new names (failing)**

In `apps/viewer/__tests__/diff-ensure.test.ts`: replace `CC_STATUSLINE_DIFF_DISABLE`→`DIFFDECK_DISABLE` (line ~21) and all three `CC_STATUSLINE_DIFF_PORT`→`DIFFDECK_PORT` (lines ~31, ~40, ~49).

In `apps/viewer/__tests__/diff-server.test.ts`, line ~47:
```typescript
		expect(res.headers.get("x-diffdeck")).toBe("1");
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/diff-config.test.ts apps/viewer/__tests__/diff-ensure.test.ts apps/viewer/__tests__/diff-server.test.ts`
Expected: FAIL — source still reads `CC_STATUSLINE_*` env and emits `x-cc-statusline`, so the new-name assertions fail.

- [ ] **Step 4: Rename in `config.ts`**

Replace lines 9, 16, 20 of `apps/viewer/server/config.ts`:
```typescript
	const raw = env.DIFFDECK_PORT;
```
```typescript
	env.DIFFDECK_DISABLE === "1";
```
```typescript
	return join(base, "diffdeck");
```

- [ ] **Step 5: Rename in `server.ts` and `ensure.ts`**

`apps/viewer/server/server.ts:46`:
```typescript
				headers: { "x-diffdeck": "1" },
```
`apps/viewer/server/ensure.ts:28`:
```typescript
		return res.headers.get("x-diffdeck") === "1";
```
`apps/viewer/server/ensure.ts:65` (spawn env):
```typescript
			env: { ...process.env, ...env, DIFFDECK_PORT: String(port) },
```

- [ ] **Step 6: Rename the browser title**

`apps/viewer/index.html:6`:
```html
		<title>diffdeck</title>
```

- [ ] **Step 7: Run tests + typecheck to verify they pass**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/diff-config.test.ts apps/viewer/__tests__/diff-ensure.test.ts apps/viewer/__tests__/diff-server.test.ts && bun run typecheck`
Expected: all listed tests PASS; typecheck prints no errors (EXIT 0).

- [ ] **Step 8: Full suite (no regressions)**

Run: `cd /Users/penguin/dev/diffdeck && bun test`
Expected: whole suite green (no other test references the old branding strings).

- [ ] **Step 9: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/server/config.ts apps/viewer/server/server.ts apps/viewer/server/ensure.ts apps/viewer/index.html apps/viewer/__tests__/diff-config.test.ts apps/viewer/__tests__/diff-ensure.test.ts apps/viewer/__tests__/diff-server.test.ts
git commit -m "refactor(viewer): rebrand user-facing surface to diffdeck"
```

---

### Task 2: CLI pure helpers (`parseArgs`, `openerCommand`)

Two pure, unit-tested functions the CLI entry will compose. The URL builder is **not** created here — `buildDiffViewerUrl` in `apps/viewer/server/link.ts` already produces exactly the URL the CLI needs, so the CLI reuses it (DRY).

**Files:**
- Create: `apps/viewer/cli/args.ts`
- Create: `apps/viewer/cli/opener.ts`
- Test: `apps/viewer/__tests__/cli-args.test.ts`, `apps/viewer/__tests__/cli-opener.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ParsedArgs { port?: number; open: boolean; help: boolean; version: boolean }`
  - `parseArgs(argv: string[]): ParsedArgs` — `argv` is the slice after the runtime+script (i.e. `process.argv.slice(2)`). `--port <n>` sets `port` only when `<n>` is an integer in `(0, 65536)`; otherwise `port` stays `undefined` (lenient — cli.ts falls back to `resolveDiffPort`). `--no-open` sets `open:false` (default `true`). `--help`/`-h` sets `help:true`. `--version`/`-v` sets `version:true`.
  - `openerCommand(platform: string, url: string): string[]` — `darwin`→`["open", url]`, `win32`→`["cmd","/c","start","",url]`, anything else→`["xdg-open", url]`.

- [ ] **Step 1: Write the failing test for `parseArgs`**

Create `apps/viewer/__tests__/cli-args.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { parseArgs } from "../cli/args.ts";

describe("parseArgs", () => {
	test("defaults: open true, no port, no help/version", () => {
		expect(parseArgs([])).toEqual({ open: true, help: false, version: false });
	});
	test("--port <n> sets a valid integer port", () => {
		expect(parseArgs(["--port", "51000"])).toEqual({
			port: 51000,
			open: true,
			help: false,
			version: false,
		});
	});
	test("invalid --port value is ignored (port stays undefined)", () => {
		expect(parseArgs(["--port", "abc"])).toEqual({
			open: true,
			help: false,
			version: false,
		});
		expect(parseArgs(["--port", "70000"])).toEqual({
			open: true,
			help: false,
			version: false,
		});
		expect(parseArgs(["--port"])).toEqual({
			open: true,
			help: false,
			version: false,
		});
	});
	test("--no-open disables opening", () => {
		expect(parseArgs(["--no-open"]).open).toBe(false);
	});
	test("--help / -h set help", () => {
		expect(parseArgs(["--help"]).help).toBe(true);
		expect(parseArgs(["-h"]).help).toBe(true);
	});
	test("--version / -v set version", () => {
		expect(parseArgs(["--version"]).version).toBe(true);
		expect(parseArgs(["-v"]).version).toBe(true);
	});
	test("flags combine", () => {
		expect(parseArgs(["--port", "8080", "--no-open"])).toEqual({
			port: 8080,
			open: false,
			help: false,
			version: false,
		});
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-args.test.ts`
Expected: FAIL — `../cli/args.ts` does not exist yet ("Cannot find module").

- [ ] **Step 3: Implement `parseArgs`**

Create `apps/viewer/cli/args.ts`:
```typescript
export interface ParsedArgs {
	port?: number;
	open: boolean;
	help: boolean;
	version: boolean;
}

const parsePort = (raw: string | undefined): number | undefined => {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
	const result: ParsedArgs = { open: true, help: false, version: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") {
			const port = parsePort(argv[i + 1]);
			if (port !== undefined) result.port = port;
			i++; // consume the value token (even when invalid)
		} else if (arg === "--no-open") {
			result.open = false;
		} else if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		}
	}
	return result;
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-args.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Write the failing test for `openerCommand`**

Create `apps/viewer/__tests__/cli-opener.test.ts`:
```typescript
import { describe, expect, test } from "bun:test";
import { openerCommand } from "../cli/opener.ts";

const URL = "http://127.0.0.1:49573/?repo=%2Ftmp&token=abc";

describe("openerCommand", () => {
	test("macOS uses `open`", () => {
		expect(openerCommand("darwin", URL)).toEqual(["open", URL]);
	});
	test("Windows uses `cmd /c start` with an empty title arg", () => {
		expect(openerCommand("win32", URL)).toEqual([
			"cmd",
			"/c",
			"start",
			"",
			URL,
		]);
	});
	test("Linux/other uses `xdg-open`", () => {
		expect(openerCommand("linux", URL)).toEqual(["xdg-open", URL]);
		expect(openerCommand("freebsd", URL)).toEqual(["xdg-open", URL]);
	});
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-opener.test.ts`
Expected: FAIL — `../cli/opener.ts` does not exist yet.

- [ ] **Step 7: Implement `openerCommand`**

Create `apps/viewer/cli/opener.ts`:
```typescript
// Cross-platform "open this URL in the default browser" argv.
// win32: `start` treats its first quoted argument as the window title, so an
// empty title placeholder must precede the URL.
export const openerCommand = (platform: string, url: string): string[] => {
	if (platform === "darwin") return ["open", url];
	if (platform === "win32") return ["cmd", "/c", "start", "", url];
	return ["xdg-open", url];
};
```

- [ ] **Step 8: Run both helper tests + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-args.test.ts apps/viewer/__tests__/cli-opener.test.ts && bun run typecheck`
Expected: both test files PASS; typecheck EXIT 0.

- [ ] **Step 9: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/cli/args.ts apps/viewer/cli/opener.ts apps/viewer/__tests__/cli-args.test.ts apps/viewer/__tests__/cli-opener.test.ts
git commit -m "feat(viewer): add CLI arg + opener pure helpers"
```

---

### Task 3: CLI entry + build layout

Add the `cli.ts` bin entry and extend `build.ts` to emit `dist/cli.js` plus the viewer under `dist/viewer/`. Delete the now-redundant `serve.ts`, repoint the built-serving test, and add `resolveJsonModule` so `cli.ts` can inline the package version at build time.

**Files:**
- Create: `apps/viewer/cli.ts`
- Modify: `apps/viewer/build.ts`
- Modify: `tsconfig.base.json` (add `resolveJsonModule: true`)
- Modify: `apps/viewer/tsconfig.json` (include `cli.ts` + `cli/**`, drop `serve.ts`)
- Delete: `apps/viewer/serve.ts`
- Modify: `apps/viewer/__tests__/built-serving.test.ts` (distDir → `dist/viewer`)

**Interfaces:**
- Consumes: `parseArgs` (Task 2), `openerCommand` (Task 2), `resolveDiffPort` (`server/config.ts`), `startDiffServer` (`server/server.ts`, returns `{ server: { port }, token, stop() }`), `buildDiffViewerUrl` (`server/link.ts`, `({port, repo, token, mode?}) => string`).
- Produces: `dist/cli.js` (bin entry) resolving `viewerDir = ${import.meta.dir}/viewer`; `build.ts` producing the `dist/{cli.js, viewer/{main.js,index.html}}` layout that Task 4's package.json `bin`/`files` and Task 4's smoke test depend on.

- [ ] **Step 1: Add `resolveJsonModule` to the shared tsconfig**

In `tsconfig.base.json`, add one line inside `compilerOptions` (e.g. after `"skipLibCheck": true,`):
```json
		"resolveJsonModule": true,
```
This is additive — no existing module imports JSON, so it changes no current behavior; it only enables `cli.ts`'s `import` of `package.json`.

- [ ] **Step 2: Update `apps/viewer/tsconfig.json` include list**

Replace the `include` array so it picks up the CLI sources and drops the deleted `serve.ts`:
```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["server/**/*.ts", "cli.ts", "cli/**/*.ts", "build.ts"]
}
```

- [ ] **Step 3: Write `cli.ts`**

Create `apps/viewer/cli.ts`. It inlines the version from the sibling `package.json` (bundled at build time by Bun). `viewerDir` resolves to `dist/viewer` because, after build, `cli.js` sits in `dist/` next to the `viewer/` folder.
```typescript
import { parseArgs } from "./cli/args.ts";
import { openerCommand } from "./cli/opener.ts";
import packageJson from "./package.json";
import { resolveDiffPort } from "./server/config.ts";
import { buildDiffViewerUrl } from "./server/link.ts";
import { startDiffServer } from "./server/server.ts";

const HELP = `diffdeck — local git diff viewer

Usage:
  bunx @say8425/diffdeck [options]

Options:
  --port <n>    Port to serve on (default: $DIFFDECK_PORT or 49573)
  --no-open     Do not open a browser automatically
  -h, --help    Show this help
  -v, --version Show version

Runs a local diff viewer for the git repository in the current directory.
Press Ctrl+C to stop.`;

const main = (): void => {
	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		console.log(HELP);
		process.exit(0);
	}
	if (args.version) {
		console.log(packageJson.version);
		process.exit(0);
	}

	const port = args.port ?? resolveDiffPort();
	const repo = process.cwd();

	let handle: ReturnType<typeof startDiffServer>;
	try {
		handle = startDiffServer({
			port,
			viewerDir: `${import.meta.dir}/viewer`,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(`diffdeck: failed to start server on port ${port}: ${message}`);
		process.exit(1);
	}

	const url = buildDiffViewerUrl({
		port: handle.server.port,
		repo,
		token: handle.token,
	});

	console.log("diffdeck viewer running at:");
	console.log(url);
	console.log("Press Ctrl+C to stop.");

	if (args.open) {
		try {
			Bun.spawn(openerCommand(process.platform, url), {
				stdout: "ignore",
				stderr: "ignore",
			}).unref();
		} catch {
			// Opening the browser is best-effort — the URL is already printed and
			// the server keeps running even if no opener is available (headless/CI).
		}
	}

	const shutdown = (): void => {
		handle.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
};

main();
```

- [ ] **Step 4: Extend `build.ts` to emit `dist/cli.js` and move the viewer to `dist/viewer/`**

Replace the whole body of `apps/viewer/build.ts` with:
```typescript
// Two bundles:
//  1) dist/cli.js       — bin entry (server + CLI), target bun.
//  2) dist/viewer/*     — browser viewer bundle. The forked @diffdeck/* packages
//                         import `../style.css?inline`, so the css-inline plugin
//                         must stay attached (parity with the harness build.ts).
// Layout mirrors cc-statusline: dist/cli.js + dist/viewer/{main.js,index.html}.
import { cssInlineBundlerPlugin } from "../../scripts/css-inline-plugin.ts";

const dist = `${import.meta.dir}/dist`;

const cli = await Bun.build({
	entrypoints: [`${import.meta.dir}/cli.ts`],
	target: "bun",
	outdir: dist,
});
for (const log of cli.logs) console.log(log);
if (!cli.success) {
	console.error("cli build failed");
	process.exit(1);
}

const viewer = await Bun.build({
	entrypoints: [`${import.meta.dir}/browser/main.ts`],
	target: "browser",
	outdir: `${dist}/viewer`,
	minify: true,
	plugins: [cssInlineBundlerPlugin],
});
for (const log of viewer.logs) console.log(log);
if (!viewer.success) {
	console.error("viewer build failed");
	process.exit(1);
}

await Bun.write(
	`${dist}/viewer/index.html`,
	Bun.file(`${import.meta.dir}/index.html`),
);

const [entry] = viewer.outputs;
console.log(
	`viewer build: ${entry?.path} (${((entry?.size ?? 0) / 1_000_000).toFixed(2)} MB)`,
);
```

- [ ] **Step 5: Delete `serve.ts`**

```bash
cd /Users/penguin/dev/diffdeck && git rm apps/viewer/serve.ts
```

- [ ] **Step 6: Repoint the built-serving test to `dist/viewer`**

In `apps/viewer/__tests__/built-serving.test.ts`, line ~11, change `distDir` to point at the viewer subfolder (the bundle no longer sits at `dist/` root):
```typescript
const distDir = join(import.meta.dir, "..", "dist", "viewer");
```
Leave the rest of the file unchanged — it builds via `build.ts`, serves `distDir` as `viewerDir`, and asserts `GET /`, `GET /main.js`, `GET /missing.js`, which all still hold under the new layout.

- [ ] **Step 7: Build and verify the dist layout**

Run: `cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts && ls -la apps/viewer/dist apps/viewer/dist/viewer`
Expected: `apps/viewer/dist/cli.js` exists; `apps/viewer/dist/viewer/main.js` and `apps/viewer/dist/viewer/index.html` exist.

- [ ] **Step 8: Smoke the built CLI by hand (no browser)**

Run: `cd /Users/penguin/dev/diffdeck && bun apps/viewer/dist/cli.js --version && bun apps/viewer/dist/cli.js --help | head -1`
Expected: first command prints `0.0.0` (current package version — Task 4 bumps it to `0.1.0`); second prints `diffdeck — local git diff viewer`.

- [ ] **Step 9: Run the built-serving test + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/built-serving.test.ts && bun run typecheck`
Expected: built-serving PASS; typecheck EXIT 0 (note: typecheck rebuilds nothing; it validates `cli.ts` + the `package.json` JSON import compile).

- [ ] **Step 10: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add tsconfig.base.json apps/viewer/tsconfig.json apps/viewer/cli.ts apps/viewer/build.ts apps/viewer/__tests__/built-serving.test.ts
git rm apps/viewer/serve.ts
git commit -m "feat(viewer): add diffdeck CLI entry + dist/cli.js bundle"
```

---

### Task 4: Publishable package.json + CLI smoke test

Rebrand `apps/viewer/package.json` into the distributable `@say8425/diffdeck` and prove the packaged bin works end-to-end with a subprocess smoke test.

**Files:**
- Modify: `apps/viewer/package.json`
- Test: `apps/viewer/__tests__/cli-smoke.test.ts`

**Interfaces:**
- Consumes: the built `dist/cli.js` + `dist/viewer/` (Task 3); ping header `x-diffdeck` (Task 1).
- Produces: the final published-package manifest (name/version/bin/files/publishConfig) that Task 5's `bun publish --dry-run` inspects.

- [ ] **Step 1: Write the failing smoke test**

Create `apps/viewer/__tests__/cli-smoke.test.ts`. It builds once, spawns `dist/cli.js --no-open --port 0` with `cwd` = a temp git repo and an isolated `XDG_CACHE_HOME`, reads the printed URL from stdout, then exercises the three endpoints and a graceful SIGINT stop.
```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const cliPath = join(import.meta.dir, "..", "dist", "cli.js");

let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
let repo: string;
let cacheHome: string;
let baseUrl: string;
let port: number;
let token: string;

const readUrlFromStdout = async (
	stream: ReadableStream<Uint8Array>,
): Promise<string> => {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });
		const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?\S+/);
		if (match) return match[0];
	}
	throw new Error(`CLI did not print a viewer URL. stdout so far:\n${buffer}`);
};

beforeAll(async () => {
	const build = Bun.spawn(
		["bun", "run", join(import.meta.dir, "..", "build.ts")],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await build.exited) !== 0) throw new Error("build.ts failed");

	repo = mkdtempSync(join(tmpdir(), "dd-cli-repo-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
	writeFileSync(join(repo, "a.txt"), "two\n");

	cacheHome = mkdtempSync(join(tmpdir(), "dd-cli-cache-"));
	proc = Bun.spawn(["bun", cliPath, "--no-open", "--port", "0"], {
		cwd: repo,
		env: { ...process.env, XDG_CACHE_HOME: cacheHome },
		stdout: "pipe",
		stderr: "pipe",
	});

	const url = await readUrlFromStdout(proc.stdout);
	const parsed = new URL(url);
	port = Number(parsed.port);
	token = parsed.searchParams.get("token") ?? "";
	baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
	proc?.kill("SIGINT");
	for (const d of [repo, cacheHome])
		if (d) rmSync(d, { recursive: true, force: true });
});

describe("packaged cli.js", () => {
	test("printed URL carries a token", () => {
		expect(token.length).toBeGreaterThan(0);
	});

	test("GET /api/ping returns 204 with the x-diffdeck marker", async () => {
		const res = await fetch(`${baseUrl}/api/ping`);
		expect(res.status).toBe(204);
		expect(res.headers.get("x-diffdeck")).toBe("1");
	});

	test("GET / serves the viewer shell", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("/main.js");
	});

	test("GET /api/diff with the token returns the repo diff JSON", async () => {
		const res = await fetch(
			`${baseUrl}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(res.status).toBe(200);
		const files = (await res.json()) as Array<{ path: string }>;
		expect(files.some((f) => f.path === "a.txt")).toBe(true);
	});

	test("SIGINT stops the server gracefully (exit 0)", async () => {
		proc.kill("SIGINT");
		expect(await proc.exited).toBe(0);
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-smoke.test.ts`
Expected: PASS is possible here even before the package.json rebrand, because `dist/cli.js` already exists from Task 3 and emits `x-diffdeck`. If it PASSES, that is acceptable — this task's package.json change (Step 3) does not alter runtime behavior the smoke test observes; the test's role is to lock the packaged bin's contract. If it FAILS, read the failure: a URL-parse timeout means `readUrlFromStdout` never matched — check that `cli.ts` prints the URL line. Do not proceed until it passes.

> Note for the implementer: this is a rare case where the new test may pass immediately against Task 3's artifact. That is by design — the deliverable of Task 4 is the manifest rebrand plus a durable end-to-end gate on the shipped bin. Keep the test.

- [ ] **Step 3: Rebrand `apps/viewer/package.json`**

Replace the entire file with the publishable manifest. `@diffdeck/*` move from `dependencies` to `devDependencies` (bundled into `dist`, zero runtime deps for consumers):
```json
{
	"name": "@say8425/diffdeck",
	"version": "0.1.0",
	"type": "module",
	"description": "Local git diff viewer — browse working-tree and branch diffs in your browser",
	"bin": {
		"diffdeck": "dist/cli.js"
	},
	"files": [
		"dist"
	],
	"repository": {
		"type": "git",
		"url": "git+https://github.com/say8425/diffdeck.git"
	},
	"publishConfig": {
		"registry": "https://registry.npmjs.org"
	},
	"scripts": {
		"build": "bun run build.ts",
		"start": "bun dist/cli.js"
	},
	"devDependencies": {
		"@diffdeck/diffs": "workspace:*",
		"@diffdeck/path-store": "workspace:*",
		"@diffdeck/trees": "workspace:*"
	}
}
```

- [ ] **Step 4: Rebuild and re-run the smoke test + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts && bun test apps/viewer/__tests__/cli-smoke.test.ts && bun run typecheck`
Expected: build succeeds; smoke test PASS (`--version` now reflects `0.1.0` via the bundled JSON); typecheck EXIT 0.

> The implementer must NOT run `bun install`. The `@diffdeck/*` workspace symlinks under `node_modules` already exist and work for both `bun test` and `bun run build.ts` regardless of deps/devDeps placement. The `bun.lock` sync is the controller's job after this task.

- [ ] **Step 5: Full suite (no regressions)**

Run: `cd /Users/penguin/dev/diffdeck && bun test`
Expected: whole suite green.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/package.json apps/viewer/__tests__/cli-smoke.test.ts
git commit -m "feat(viewer): package apps/viewer as publishable @say8425/diffdeck"
```

---

### Task 5: Docs + `bun publish --dry-run`

Document CLI usage and the (user-run) publish process, then verify the tarball with a dry run. **No actual publish.**

**Files:**
- Create or modify: `README.md` (repo root)

**Interfaces:**
- Consumes: the final manifest (Task 4), the built `dist/` (Task 3/4).
- Produces: documentation + a verified `bun publish --dry-run` tarball listing.

- [ ] **Step 1: Check for an existing README and a LICENSE in the package dir**

Run: `cd /Users/penguin/dev/diffdeck && ls README.md LICENSE apps/viewer/LICENSE 2>&1; echo "---"; head -20 README.md 2>/dev/null`
Note what exists. If a root `README.md` exists, you will append sections to it; if not, create it. Record whether `apps/viewer/LICENSE` exists (npm publishes a LICENSE from the package dir; the fork's license must ship with the package — see Step 4).

- [ ] **Step 2: Add the CLI usage + publish sections to `README.md`**

If `README.md` exists, append the two sections below; if it does not, create `README.md` starting with a top-level `# diffdeck` heading followed by these sections. Use this exact content for the new sections:
```markdown
## CLI

Run the diff viewer for the git repository in the current directory:

```bash
bunx @say8425/diffdeck
```

This starts a local server on `127.0.0.1:49573` (override with `--port`) and opens
the viewer in your browser.

Options:

| Flag | Description |
|------|-------------|
| `--port <n>` | Port to serve on (default: `$DIFFDECK_PORT` or `49573`) |
| `--no-open` | Do not open a browser automatically (prints the URL) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

Environment: `DIFFDECK_PORT` sets the default port; `DIFFDECK_DISABLE=1` disables the
viewer. The token is cached under `~/.cache/diffdeck/`.

## Publishing

The package is `@say8425/diffdeck`; `apps/viewer` is the publish root. `@diffdeck/*`
packages are bundled into `dist` at build time, so the published tarball has no
runtime dependencies.

```bash
cd apps/viewer
bun run build           # produces dist/cli.js + dist/viewer/
bun publish --dry-run   # inspect the tarball contents
bun publish             # publish (requires npm auth; run manually)
```

Only `dist/` ships (`files: ["dist"]`).
```

- [ ] **Step 3: Rebuild dist so the dry run packs current output**

Run: `cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts`
Expected: `apps/viewer/dist/cli.js` + `apps/viewer/dist/viewer/{main.js,index.html}` present.

- [ ] **Step 4: Ensure the fork LICENSE ships with the package**

If Step 1 found no `apps/viewer/LICENSE` but a root `LICENSE` exists, copy it into the package dir so `bun publish` includes it (npm only ships a LICENSE located in the package root):
```bash
cd /Users/penguin/dev/diffdeck && [ -f LICENSE ] && [ ! -f apps/viewer/LICENSE ] && cp LICENSE apps/viewer/LICENSE || echo "no copy needed"
```
If a root `LICENSE` exists and you copied it, add `"LICENSE"` to the `files` array in `apps/viewer/package.json` (npm auto-includes LICENSE by filename, but listing it is explicit and safe):
```json
	"files": [
		"dist",
		"LICENSE"
	],
```
If neither exists, note this in the task report as a follow-up (do not fabricate a license).

- [ ] **Step 5: Run the dry run and inspect the tarball**

Run: `cd /Users/penguin/dev/diffdeck/apps/viewer && bun publish --dry-run`
Expected: a tarball listing that includes `dist/cli.js`, `dist/viewer/main.js`, `dist/viewer/index.html`, `package.json`, `README.md` (bun includes the nearest README), and `LICENSE` if present. It must NOT include `browser/`, `server/`, `cli/`, `__tests__/`, or `node_modules`. Capture the full output in the task report.

  - If the dry run **errors on `workspace:*`** in devDependencies: this is the documented risk. Because `@diffdeck/*` are dev-only and bundled, the consumer never installs them. Resolve by pinning the devDeps to the current workspace versions (they are `0.0.0`) so the published manifest carries a concrete version:
    ```json
    	"devDependencies": {
    		"@diffdeck/diffs": "0.0.0",
    		"@diffdeck/path-store": "0.0.0",
    		"@diffdeck/trees": "0.0.0"
    	}
    ```
    Then re-run the dry run. **Do this only if the dry run actually errors** — if `workspace:*` packs cleanly (bun rewrites it), leave the manifest as Task 4 wrote it and note the observed behavior in the report.

- [ ] **Step 6: Verify no regressions and typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun run typecheck && bun test`
Expected: typecheck EXIT 0; full suite green.

- [ ] **Step 7: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add README.md apps/viewer/package.json apps/viewer/LICENSE 2>/dev/null; git add README.md apps/viewer/package.json
git commit -m "docs: diffdeck CLI usage + publish checklist"
```

> **STOP here.** The actual `bun publish` and any cc-statusline cutover are user-gated. Do not run them.

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-12-diffdeck-cli-publish-design.md`):
- §1 CLI entry (`parseArgs`/URL/`openerCommand`/browser open/SIGINT) → Task 2 (helpers) + Task 3 (`cli.ts`). URL builder reuses existing `buildDiffViewerUrl` (DRY, spec's `buildViewerUrl` intent satisfied). ✅
- §2 bundle build (`dist/cli.js` target bun + `dist/viewer/`) → Task 3 `build.ts`. ✅
- §3 minimal rebrand (env/cache/ping header + tests) → Task 1; browser `<title>` added (most user-facing surface, spec §3 "user-facing surface만"). localStorage keys explicitly scoped out per spec YAGNI. ✅
- §4 publish package.json (name/version/bin/files/publishConfig/deps→devDeps) → Task 4. ✅
- §5 smoke test (spawn built cli, ping/diff/index endpoints, graceful stop) + helper unit tests → Task 4 smoke + Task 2 units. ✅
- §6 docs (README CLI section + publish checklist) → Task 5. ✅
- Non-goals honored: no real publish (Task 5 stops at dry-run), no cc-statusline cutover PR (absent from plan), no engine changes, no full provenance rebrand. ✅

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/uncoded steps — every code step carries complete code. ✅

**3. Type consistency:** `ParsedArgs`/`parseArgs`/`openerCommand` signatures match between Task 2 definition and Task 3 usage. `buildDiffViewerUrl({port,repo,token})` matches `server/link.ts`. `startDiffServer(...).server.port`/`.token`/`.stop()` match `server/server.ts`. Env names `DIFFDECK_PORT`/`DIFFDECK_DISABLE` and header `x-diffdeck` consistent across Tasks 1/3/4. ✅

**Edge notes for the executor:**
- Task 4 Step 2 may pass immediately (test runs against Task 3's artifact) — that is intended; the test is a durable contract gate, not a red-green driver for the manifest edit.
- `bun install`/`bun.lock` is controller-only. After Task 4, the controller syncs `bun.lock` and commits it separately (Plan 4 pattern).

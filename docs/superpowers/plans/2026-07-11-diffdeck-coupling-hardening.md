# diffdeck Plan 4 — Coupling Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the viewer's implicit coupling to the vendored diff engine's internal markup and sort rules into explicit, tested contracts, and delete the dead React/SSR adapter code so React can be dropped from the forked packages.

**Architecture:** Three independent threads. (A) The viewer hard-codes `@diffdeck/diffs` markup strings (`diffs-container`, `data-diffs-header`, `data-title`, `data-change-icon`); promote these to engine-owned exported constants that the engine's own render code references (single source), and add a canary test so an engine markup change fails loudly. (B) The viewer hand-duplicates path-store's tree-order sort in `fileOrder.ts`; expose a public path-string comparator from path-store and delete the duplicate. (C) The `react/` adapters in diffs+trees, the `ssr/` React cluster in diffs, and theming's unused `react.ts` binding are dead (not exported, zero importers); delete them and drop the `react`/`react-dom` deps.

**Tech Stack:** Bun workspace monorepo, TypeScript 6 (per-package tsconfig loop), oxlint/oxfmt, bun:test, happy-dom (only where DOM is needed).

## Global Constraints

- **Do NOT rewrite engine (CodeView/renderer) logic.** Thread A edits are literal→named-constant substitutions with byte-identical runtime values only. Render output must not change.
- **Edit vendored `packages/**` source via Bash patch scripts (python/sed heredoc), NOT the Edit/Write tools.** An auto-format-on-save hook reformats any file touched with Edit/Write, which would convert 2-space-indented vendored files to the repo's tab style and destroy their verbatim-from-upstream property (`packages/**` is intentionally excluded from repo formatting). New files you author (test files) may use Write.
- **Pin exact dependency versions (no carets)** for any dep change. React removal only removes; it adds nothing.
- **Preserve all `LICENSE` / `NOTICE` files.** No deletion of license headers.
- **Per-package tsconfig loop stays intact:** `path-store → theming → diffs → trees → apps/viewer`. The verify gate runs the full `bun run typecheck` (5 configs).
- **Do NOT run `bun install` inside any task.** Racing installs have destroyed `node_modules` before. Dependency edits are declarative `package.json` text changes; the existing `node_modules` still satisfies typecheck/test/build. Lockfile regeneration is a single controller-run step after Task 5, not a subagent task.
- **happy-dom** (if any test needs a real DOM): import the registrator per-file (`import "@happy-dom/global-registrator"` bootstrap as used by existing trees tests) — never via global bunfig preload (it breaks apps/viewer's HTTP-server tests). Task 1's canary asserts on plain HAST objects and needs NO DOM.

## Spec Refinements (deviations found during investigation — carry into review)

The committed spec (`docs/superpowers/specs/2026-07-11-diffdeck-coupling-hardening-design.md`) was written before source-level investigation. Three corrections, all evidence-backed:

1. **`data-fold` is NOT an engine coupling** — it is the viewer's OWN attribute (`main.ts:121` writes `btn.dataset.fold = id`, `:72`/`:149` read it back). It carries no cross-package contract, so it gets no engine constant and no canary. It stays a viewer-local literal.
2. **`data-change-icon` IS a real engine coupling** the spec missed (`imageCard.ts:82` queries it; emitted by `createFileHeaderElement.ts:77`). It takes the constant slot vacated by `data-fold`. Net count unchanged.
3. **`DIFFS_TAG_NAME` already exists** (`constants.ts:10`) and the engine already uses it (`CodeView.ts:983` `document.createElement(DIFFS_TAG_NAME)`) and it is already exported. No new tag constant — the viewer just imports the existing one. Only 3 NEW constants are added (`DIFFS_HEADER_ATTR`, `DIFFS_TITLE_ATTR`, `DIFFS_CHANGE_ICON_ATTR`).
4. **diffs has a dead `ssr/` React cluster** (`packages/diffs/src/ssr/`, 6 files incl. `FileDiffReact.tsx` which imports `react-dom`). It is not exported from the package index and has zero outside importers. Deleting only `react/` would leave `FileDiffReact.tsx` importing `react-dom`, so `bun run typecheck` would fail the moment `react-dom` is removed from `diffs/package.json`. Achieving the spec's stated goal ("remove react dep from diffs") therefore REQUIRES also deleting `ssr/`. This mirrors Plan 3, which already deleted trees' SSR. Thread C deletes it.

---

## Task 1: diffs markup constants (single source) + canary test

**Files:**
- Modify (Bash patch): `packages/diffs/src/constants.ts` — add 3 constants after `DIFFS_TAG_NAME` (line 10)
- Modify (Bash patch): `packages/diffs/src/utils/createFileHeaderElement.ts` — reference the constants at lines 34, 77, 113
- Modify (Bash patch): `packages/diffs/src/index.ts:122` — export the 3 new constants
- Create (Write): `packages/diffs/src/__tests__/markup-contract.test.ts`

**Interfaces:**
- Produces (consumed by Task 2): `export const DIFFS_HEADER_ATTR = 'data-diffs-header'`, `export const DIFFS_TITLE_ATTR = 'data-title'`, `export const DIFFS_CHANGE_ICON_ATTR = 'data-change-icon'` — all from `@diffdeck/diffs`. `DIFFS_TAG_NAME` already exported.

- [ ] **Step 1: Write the failing canary test**

Create `packages/diffs/src/__tests__/markup-contract.test.ts`. It asserts (a) the constants hold the exact literal strings the viewer depends on, and (b) `createFileHeaderElement` actually emits those attributes in its HAST tree (so an engine markup change fails here). No DOM needed — HAST is plain objects.

```ts
import { describe, expect, test } from "bun:test";
import {
	DIFFS_CHANGE_ICON_ATTR,
	DIFFS_HEADER_ATTR,
	DIFFS_TAG_NAME,
	DIFFS_TITLE_ATTR,
} from "../index";
import { createFileHeaderElement } from "../utils/createFileHeaderElement";
import type { Element as HASTElement } from "hast";

// Contract values the viewer (apps/viewer/browser) hard-depends on. If the
// engine renames any of these, the viewer breaks silently — this pins them.
describe("diffs markup contract constants", () => {
	test("constants hold the exact attribute/tag strings", () => {
		expect(DIFFS_TAG_NAME).toBe("diffs-container");
		expect(DIFFS_HEADER_ATTR).toBe("data-diffs-header");
		expect(DIFFS_TITLE_ATTR).toBe("data-title");
		expect(DIFFS_CHANGE_ICON_ATTR).toBe("data-change-icon");
	});
});

// Walk a HAST subtree collecting every node whose properties carry `attr`.
const nodesWithAttr = (root: HASTElement, attr: string): HASTElement[] => {
	const found: HASTElement[] = [];
	const visit = (node: HASTElement): void => {
		if (node.properties && attr in node.properties) found.push(node);
		for (const child of node.children ?? []) {
			if ((child as HASTElement).type === "element") {
				visit(child as HASTElement);
			}
		}
	};
	visit(root);
	return found;
};

describe("createFileHeaderElement emits the contracted attributes", () => {
	const header = createFileHeaderElement({
		fileOrDiff: {
			name: "src/example.ts",
			type: "modified",
			hunks: [],
		} as never,
		mode: "default",
		stickyHeader: false,
	});

	test("root header node carries DIFFS_HEADER_ATTR", () => {
		expect(header.properties?.[DIFFS_HEADER_ATTR]).toBe("default");
	});

	test("a title node carries DIFFS_TITLE_ATTR", () => {
		expect(nodesWithAttr(header, DIFFS_TITLE_ATTR).length).toBeGreaterThan(0);
	});

	test("a change-icon node carries DIFFS_CHANGE_ICON_ATTR", () => {
		expect(
			nodesWithAttr(header, DIFFS_CHANGE_ICON_ATTR).length,
		).toBeGreaterThan(0);
	});
});
```

Note: the `fileOrDiff` fixture is cast (`as never`) to sidestep the full `FileDiffMetadata` shape. If you prefer a typed fixture, read `packages/diffs/src/types.ts` for `FileDiffMetadata` and supply the required fields; the assertions above are the contract and must not change.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/diffs/src/__tests__/markup-contract.test.ts`
Expected: FAIL — the three new constants are not yet exported (`DIFFS_HEADER_ATTR` etc. undefined → import error / `undefined` assertions).

- [ ] **Step 3: Add the constants (Bash patch, preserves vendored formatting)**

```bash
cd /Users/penguin/dev/diffdeck
python3 - <<'PY'
p = "packages/diffs/src/constants.ts"
s = open(p, encoding="utf-8").read()
anchor = "export const DIFFS_TAG_NAME = 'diffs-container' as const;\n"
addition = (
    anchor
    + "export const DIFFS_HEADER_ATTR = 'data-diffs-header' as const;\n"
    + "export const DIFFS_TITLE_ATTR = 'data-title' as const;\n"
    + "export const DIFFS_CHANGE_ICON_ATTR = 'data-change-icon' as const;\n"
)
assert s.count(anchor) == 1, "anchor not unique/found"
s = s.replace(anchor, addition, 1)
open(p, "w", encoding="utf-8").write(s)
print("constants.ts patched")
PY
```

- [ ] **Step 4: Point the engine's own render code at the constants (single source, Bash patch)**

```bash
cd /Users/penguin/dev/diffdeck
python3 - <<'PY'
p = "packages/diffs/src/utils/createFileHeaderElement.ts"
s = open(p, encoding="utf-8").read()

# Add the 3 constants to the existing constants import (keeps 2-space style).
old_import = (
    "import {\n"
    "  CUSTOM_HEADER_SLOT_ID,\n"
    "  HEADER_METADATA_SLOT_ID,\n"
    "  HEADER_PREFIX_SLOT_ID,\n"
    "} from '../constants';\n"
)
new_import = (
    "import {\n"
    "  CUSTOM_HEADER_SLOT_ID,\n"
    "  DIFFS_CHANGE_ICON_ATTR,\n"
    "  DIFFS_HEADER_ATTR,\n"
    "  DIFFS_TITLE_ATTR,\n"
    "  HEADER_METADATA_SLOT_ID,\n"
    "  HEADER_PREFIX_SLOT_ID,\n"
    "} from '../constants';\n"
)
assert s.count(old_import) == 1, "import block not found"
s = s.replace(old_import, new_import, 1)

# Replace the three literal keys with computed-key references (identical values).
repls = [
    ("    'data-diffs-header': mode,\n", "    [DIFFS_HEADER_ATTR]: mode,\n"),
    ("      properties: { 'data-change-icon': iconType },\n",
     "      properties: { [DIFFS_CHANGE_ICON_ATTR]: iconType },\n"),
    ("      properties: { 'data-title': '' },\n",
     "      properties: { [DIFFS_TITLE_ATTR]: '' },\n"),
]
for old, new in repls:
    assert s.count(old) == 1, f"literal not unique/found: {old!r}"
    s = s.replace(old, new, 1)

open(p, "w", encoding="utf-8").write(s)
print("createFileHeaderElement.ts patched")
PY
```

- [ ] **Step 5: Export the constants from the package index (Bash patch)**

```bash
cd /Users/penguin/dev/diffdeck
python3 - <<'PY'
p = "packages/diffs/src/index.ts"
s = open(p, encoding="utf-8").read()
# The value-export list is one big line; insert the 3 names around DIFFS_TAG_NAME.
old = "DIFFS_TAG_NAME,"
new = "DIFFS_CHANGE_ICON_ATTR, DIFFS_HEADER_ATTR, DIFFS_TAG_NAME, DIFFS_TITLE_ATTR,"
assert s.count(old) == 1, "DIFFS_TAG_NAME export anchor not unique/found"
s = s.replace(old, new, 1)
open(p, "w", encoding="utf-8").write(s)
print("index.ts patched")
PY
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test packages/diffs/src/__tests__/markup-contract.test.ts`
Expected: PASS (all assertions green).

- [ ] **Step 7: Verify typecheck stays green**

Run: `bun run typecheck`
Expected: EXIT 0 (5 configs). The computed keys type-check against hast `Properties`.

- [ ] **Step 8: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add packages/diffs/src/constants.ts packages/diffs/src/utils/createFileHeaderElement.ts packages/diffs/src/index.ts packages/diffs/src/__tests__/markup-contract.test.ts
git commit -m "feat(diffs): export header markup contract constants + canary

Promote data-diffs-header/data-title/data-change-icon literals to
exported constants the engine's own render code references (single
source). Canary pins the values and asserts createFileHeaderElement
emits them, so an engine markup change fails loudly."
```

---

## Task 2: wire the viewer to the diffs markup constants

**Files:**
- Modify (Edit tool OK — apps/viewer is repo-formatted): `apps/viewer/browser/main.ts`
- Modify (Edit tool OK): `apps/viewer/browser/imageCard.ts`

**Interfaces:**
- Consumes (from Task 1): `DIFFS_TAG_NAME`, `DIFFS_HEADER_ATTR`, `DIFFS_TITLE_ATTR`, `DIFFS_CHANGE_ICON_ATTR` from `@diffdeck/diffs`.

This is a refactor: every literal becomes the imported constant, runtime values identical. `data-fold`, `data-copy-name`, `data-image-card`, `data-deletions-count`, `data-additions-count` are viewer-OWNED attributes — leave them as literals.

- [ ] **Step 1: Confirm the existing viewer suite is green (baseline)**

Run: `bun test apps/viewer`
Expected: PASS (current suite). Record the pass count.

- [ ] **Step 2: Wire `main.ts`**

Add to the `@diffdeck/diffs` import on line 1:
```ts
import {
	CodeView,
	DIFFS_HEADER_ATTR,
	DIFFS_TAG_NAME,
	DIFFS_TITLE_ATTR,
	parseDiffFromFile,
} from "@diffdeck/diffs";
```

Then replace these engine-coupled sites (values unchanged):

| Line | Old | New |
|------|-----|-----|
| 65 | `node.hasAttribute("data-diffs-header")` | `node.hasAttribute(DIFFS_HEADER_ATTR)` |
| 70 | `node.tagName === "DIFFS-CONTAINER"` | `node.tagName === DIFFS_TAG_NAME.toUpperCase()` |
| 159 | `diffMount.querySelectorAll<HTMLElement>("diffs-container")` | `diffMount.querySelectorAll<HTMLElement>(DIFFS_TAG_NAME)` |
| 171 | `root.querySelector("[data-title]")` | `` root.querySelector(`[${DIFFS_TITLE_ATTR}]`) `` |
| 205 | `node.closest?.("diffs-container")` | `node.closest?.(DIFFS_TAG_NAME)` |
| 211 | `"[data-diffs-header]{cursor:pointer;transition:background-color .15s}[data-diffs-header]:hover{background-color:rgba(255,255,255,.05)}"` | `` `[${DIFFS_HEADER_ATTR}]{cursor:pointer;transition:background-color .15s}[${DIFFS_HEADER_ATTR}]:hover{background-color:rgba(255,255,255,.05)}` `` |
| 215 | `` `[data-diffs-header]:hover [data-copy-name]{opacity:1}...` `` | replace the leading `[data-diffs-header]` with `[${DIFFS_HEADER_ATTR}]` (keep `[data-copy-name]` literal — viewer-owned) |

Leave `[data-fold]` on lines 72 and 149 as literals (viewer-owned attribute). Optionally add a clarifying comment at line 72: `// data-fold is the viewer's own id carrier (set in makeFoldButton), not an engine attribute`.

- [ ] **Step 3: Wire `imageCard.ts`**

Add an import at the top:
```ts
import { DIFFS_CHANGE_ICON_ATTR, DIFFS_HEADER_ATTR } from "@diffdeck/diffs";
```

Replace:

| Line | Old | New |
|------|-----|-----|
| 82 | `"[data-diffs-header] [data-change-icon] use"` | `` `[${DIFFS_HEADER_ATTR}] [${DIFFS_CHANGE_ICON_ATTR}] use` `` |
| 116 | `root.querySelector("[data-diffs-header]")` | `` root.querySelector(`[${DIFFS_HEADER_ATTR}]`) `` |

Leave `IMAGE_CARD_CSS`'s `[data-image-card]` literal (viewer-owned).

- [ ] **Step 4: Run the viewer suite + typecheck**

Run: `bun test apps/viewer`
Expected: PASS, same count as Step 1 (behavior identical).
Run: `bun run typecheck`
Expected: EXIT 0.

- [ ] **Step 5: Verify the viewer still builds**

Run: `cd /Users/penguin/dev/diffdeck && bun run --cwd apps/viewer build` (or the repo's viewer build script; check `apps/viewer/package.json` scripts).
Expected: build succeeds (~10.5MB bundle), no unresolved import errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/browser/main.ts apps/viewer/browser/imageCard.ts
git commit -m "refactor(viewer): consume diffs markup constants instead of literals

Bind the viewer's engine-DOM queries (diffs-container, data-diffs-header,
data-title, data-change-icon) to the exported @diffdeck/diffs constants.
data-fold stays a viewer-owned literal."
```

---

## Task 3: expose a public path-string tree-order comparator from path-store

**Files:**
- Modify (Bash patch — vendored): `packages/path-store/src/sort.ts` — add `comparePathsInTreeOrder` + private `toFileCompareEntry`
- Create (Write): `packages/path-store/src/__tests__/tree-order.test.ts` (if `packages/path-store/src/__tests__/` does not exist, create it; match the location of any existing path-store test — check `find packages/path-store -name '*.test.ts'` first)

**Interfaces:**
- Produces (consumed by Task 4): `export function comparePathsInTreeOrder(left: string, right: string): number` from `@diffdeck/path-store`. Semantics: treat both inputs as leaf file paths; directories-before-files at each depth, case-insensitive natural-sort segments, raw-string tiebreak on case-only differences. Sign-compatible with `Array.prototype.sort`.

**Design note:** `compareCompareEntries(a, b)` is already exported from `sort.ts` and reads only `.segments` + `.isDirectory` from a `PathStoreCompareEntry`. `getKindAtDepth` treats any non-terminal segment as a directory and the terminal segment by `entry.isDirectory` — for a leaf file path (`isDirectory: false`) this matches the viewer's `depth < length-1` inference exactly. `compareSegmentValues` implements the identical case-insensitive natural sort as the viewer's hand-rolled `compareSegments` (verified analytically). The new function builds a full `PathStoreCompareEntry` (all 5 fields computable from the path string; only `segments`/`isDirectory` are read) and delegates.

- [ ] **Step 1: Write the failing equivalence test**

Create the test. The 5 cases are the exact `apps/viewer/__tests__/viewer-file-order.test.ts` cases translated to bare path strings — passing them proves the new comparator reproduces the viewer's order (equivalence gate for Task 4).

```ts
import { describe, expect, test } from "bun:test";
import { comparePathsInTreeOrder } from "../index";

const sorted = (paths: string[]): string[] =>
	paths.toSorted(comparePathsInTreeOrder);

describe("comparePathsInTreeOrder", () => {
	test("directories sort before files at every level", () => {
		expect(
			sorted([
				"README.md",
				"src/index.ts",
				"biome.json",
				"docs/a.png",
				"src/viewer/main.ts",
			]),
		).toEqual([
			"docs/a.png",
			"src/viewer/main.ts",
			"src/index.ts",
			"biome.json",
			"README.md",
		]);
	});

	test("case-insensitive alphabetical within a level", () => {
		expect(
			sorted(["README.md", "biome.json", "bun.lock", "package.json"]),
		).toEqual(["biome.json", "bun.lock", "package.json", "README.md"]);
	});

	test("natural sort for numbered names", () => {
		expect(
			sorted(["shots/img10.png", "shots/img2.png", "shots/img1.png"]),
		).toEqual(["shots/img1.png", "shots/img2.png", "shots/img10.png"]);
	});

	test("case-only difference falls back to raw comparison", () => {
		expect(sorted(["a.txt", "A.txt"])).toEqual(["A.txt", "a.txt"]);
	});

	test("input order does not matter", () => {
		expect(
			sorted(["zz.txt", "docs/new.png", "aa.txt", "docs/old.png"]),
		).toEqual(["docs/new.png", "docs/old.png", "aa.txt", "zz.txt"]);
	});

	test("deeper hierarchy compared segment by segment", () => {
		expect(comparePathsInTreeOrder("src/a/b.ts", "src/a/b.ts")).toBe(0);
		expect(
			comparePathsInTreeOrder("src/__tests__/x.ts", "src/diff-server/y.ts"),
		).toBeLessThan(0);
		expect(
			comparePathsInTreeOrder("src/viewer/z.ts", "src/index.ts"),
		).toBeLessThan(0);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/path-store/src/__tests__/tree-order.test.ts`
Expected: FAIL — `comparePathsInTreeOrder` is not exported yet.

- [ ] **Step 3: Add the comparator (Bash patch, preserves vendored 2-space formatting)**

Append the two functions to the end of `sort.ts`. `PathStoreCompareEntry` is already imported at the top of the file; `compareCompareEntries` is already defined above.

```bash
cd /Users/penguin/dev/diffdeck
python3 - <<'PY'
p = "packages/path-store/src/sort.ts"
s = open(p, encoding="utf-8").read()
addition = '''
// Compare two paths as leaf files in file-tree order (directories before files
// at each depth, case-insensitive natural sort, raw-string tiebreak). This is
// the public comparator apps sort flat file-path lists with; it reuses the same
// segment/kind machinery as the store's projection so tree order and file-list
// order can never drift.
function toFileCompareEntry(path: string): PathStoreCompareEntry {
  const segments = path.split('/');
  return {
    path,
    segments,
    basename: segments[segments.length - 1],
    depth: segments.length - 1,
    isDirectory: false,
  };
}

export function comparePathsInTreeOrder(left: string, right: string): number {
  return compareCompareEntries(
    toFileCompareEntry(left),
    toFileCompareEntry(right)
  );
}
'''
if not s.endswith("\n"):
    s += "\n"
s = s + addition
open(p, "w", encoding="utf-8").write(s)
print("sort.ts patched")
PY
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test packages/path-store/src/__tests__/tree-order.test.ts`
Expected: PASS (all 6 cases). If any case differs, STOP — the comparators are not equivalent; do not proceed to Task 4. Report the divergence.

- [ ] **Step 5: Verify typecheck green**

Run: `bun run typecheck`
Expected: EXIT 0.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add packages/path-store/src/sort.ts packages/path-store/src/__tests__/tree-order.test.ts
git commit -m "feat(path-store): expose comparePathsInTreeOrder

Public path-string tree-order comparator that reuses the store's segment
comparison + directory-first kind logic, so a flat file-path list sorts
identically to the file tree. Replaces the viewer's hand-duplicated rules."
```

---

## Task 4: unify the viewer's sort on the path-store comparator (delete the duplicate)

**Files:**
- Modify (Edit tool OK): `apps/viewer/browser/main.ts` — import the comparator, drop `fileOrder.ts` usage
- Delete: `apps/viewer/browser/fileOrder.ts`
- Modify (Edit tool OK): `apps/viewer/__tests__/viewer-file-order.test.ts` — repoint to the unified comparator (same assertions = equivalence gate)
- Modify (Edit tool OK): `apps/viewer/package.json` — declare `@diffdeck/path-store` as a workspace dependency (no install needed; the symlink already exists via trees' dependency)

**Interfaces:**
- Consumes (from Task 3): `comparePathsInTreeOrder` from `@diffdeck/path-store`.

- [ ] **Step 1: Repoint the viewer test to the unified comparator**

Rewrite `apps/viewer/__tests__/viewer-file-order.test.ts` to exercise the same path the viewer now uses. Keep every assertion identical — this test staying green is the equivalence guarantee that lets us delete the duplicate.

```ts
import { describe, expect, test } from "bun:test";
import { comparePathsInTreeOrder } from "@diffdeck/path-store";

// Mirrors renderPatch's sort: DiffFile[] ordered by `.name` in tree order.
const names = (paths: string[]): string[] =>
	paths
		.map((name) => ({ name }))
		.toSorted((a, b) => comparePathsInTreeOrder(a.name, b.name))
		.map((f) => f.name);

describe("viewer file ordering (unified with path-store)", () => {
	test("directories sort before files at every level (like the file tree)", () => {
		expect(
			names([
				"README.md",
				"src/index.ts",
				"biome.json",
				"docs/a.png",
				"src/viewer/main.ts",
			]),
		).toEqual([
			"docs/a.png",
			"src/viewer/main.ts",
			"src/index.ts",
			"biome.json",
			"README.md",
		]);
	});

	test("case-insensitive alphabetical within a level", () => {
		expect(
			names(["README.md", "biome.json", "bun.lock", "package.json"]),
		).toEqual(["biome.json", "bun.lock", "package.json", "README.md"]);
	});

	test("natural sort for numbered names", () => {
		expect(
			names(["shots/img10.png", "shots/img2.png", "shots/img1.png"]),
		).toEqual(["shots/img1.png", "shots/img2.png", "shots/img10.png"]);
	});

	test("same lowercase falls back to raw comparison (stable, deterministic)", () => {
		expect(names(["a.txt", "A.txt"])).toEqual(["A.txt", "a.txt"]);
	});

	test("input order does not matter (untracked appended last still interleaves)", () => {
		expect(names(["zz.txt", "docs/new.png", "aa.txt", "docs/old.png"])).toEqual(
			["docs/new.png", "docs/old.png", "aa.txt", "zz.txt"],
		);
	});
});
```

- [ ] **Step 2: Run the repointed test — expect it to PASS immediately**

Run: `bun test apps/viewer/__tests__/viewer-file-order.test.ts`
Expected: PASS. (The comparator from Task 3 already reproduces the order; this is a green-refactor.) If it FAILS, STOP — equivalence is broken; do not delete `fileOrder.ts`.

- [ ] **Step 3: Rewire `main.ts` and delete the duplicate**

In `apps/viewer/browser/main.ts`:
- Remove line 6: `import { sortFilesLikeTree } from "./fileOrder.ts";`
- Add import: `import { comparePathsInTreeOrder } from "@diffdeck/path-store";`
- Line 233: replace
  ```ts
  const files = sortFilesLikeTree(unsorted);
  ```
  with
  ```ts
  const files = unsorted.toSorted((a, b) =>
  	comparePathsInTreeOrder(a.name, b.name),
  );
  ```

Delete the file:
```bash
cd /Users/penguin/dev/diffdeck && git rm apps/viewer/browser/fileOrder.ts
```

- [ ] **Step 4: Declare the workspace dependency**

Add `"@diffdeck/path-store": "workspace:*"` to the `dependencies` block of `apps/viewer/package.json` (match the version-spec style used for `@diffdeck/diffs`/`@diffdeck/trees` there — read the file first). Do NOT run `bun install`; the symlink already resolves via trees' dependency.

- [ ] **Step 5: Full verify gate**

Run: `bun test apps/viewer` → PASS (file-order test + all others).
Run: `bun run typecheck` → EXIT 0.
Run: `grep -rn "fileOrder\|sortFilesLikeTree" apps/viewer/` → no matches (duplicate fully removed).
Run the viewer build (as in Task 2 Step 5) → succeeds.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/browser/main.ts apps/viewer/__tests__/viewer-file-order.test.ts apps/viewer/package.json
git commit -m "refactor(viewer): sort via path-store comparePathsInTreeOrder

Delete the hand-duplicated sortFilesLikeTree/compareTreePaths; the viewer
now sorts diff items with @diffdeck/path-store's public comparator, so
tree order and diff-list order share one source and cannot drift."
```

---

## Task 5: delete dead React/SSR adapters and drop the React deps

**Files:**
- Delete: `packages/diffs/src/react/` (19 files), `packages/diffs/src/ssr/` (6 files, incl. `FileDiffReact.tsx`), `packages/trees/src/react/` (6 files), `packages/theming/src/react.ts`
- Modify (Edit tool OK — package.json/tsconfig are repo-formatted, not vendored source): `packages/diffs/package.json`, `packages/trees/package.json`, `packages/theming/package.json`, `packages/diffs/tsconfig.json`, `packages/trees/tsconfig.json`

**Interfaces:** none produced/consumed — pure deletion. All four directories/files are confirmed dead: none is exported from its package `index.ts`, and each has zero importers outside itself.

**Why one atomic task:** deleting the files without removing the deps leaves orphan deps; removing the deps without deleting `ssr/FileDiffReact.tsx` (which imports `react-dom`) breaks `bun run typecheck`. They must land together.

- [ ] **Step 1: Re-confirm the closed clusters (guard before deletion)**

```bash
cd /Users/penguin/dev/diffdeck
echo "diffs index references react/ or ssr/:" ; grep -n "from ['\"]\./react\|from ['\"]\./ssr\|/react/\|/ssr/" packages/diffs/src/index.ts || echo "  none"
echo "trees index references react/:" ; grep -n "/react/\|from ['\"]\./react" packages/trees/src/index.ts || echo "  none"
echo "outside importers of diffs react/ssr:" ; grep -rn "diffs/src/react\|diffs/src/ssr\|@diffdeck/diffs/react\|@diffdeck/diffs/ssr" packages/ apps/ scripts/ --include=*.ts --include=*.tsx | grep -v "packages/diffs/src/react/\|packages/diffs/src/ssr/" || echo "  none"
echo "outside importers of trees react/:" ; grep -rn "trees/src/react\|@diffdeck/trees/react" packages/ apps/ scripts/ --include=*.ts --include=*.tsx | grep -v "packages/trees/src/react/" || echo "  none"
echo "importers of theming/react:" ; grep -rn "theming/react\|@diffdeck/theming/react" packages/ apps/ scripts/ --include=*.ts --include=*.tsx | grep -v "packages/theming/src/react.ts" || echo "  none"
```
Expected: every line reports "none". If ANY importer appears, STOP and report — that cluster is not dead.

- [ ] **Step 2: Delete the dead directories/files**

```bash
cd /Users/penguin/dev/diffdeck
git rm -r packages/diffs/src/react packages/diffs/src/ssr packages/trees/src/react packages/theming/src/react.ts
```

- [ ] **Step 3: Remove the React deps and the theming `./react` export**

Edit `packages/diffs/package.json`: remove `@types/react`, `@types/react-dom`, `react`, `react-dom` from `devDependencies`; remove `react`, `react-dom` from `peerDependencies`; remove the `react`/`react-dom` entries from `peerDependenciesMeta` (drop the `peerDependenciesMeta` block if it becomes empty).

Edit `packages/trees/package.json`: remove `@types/react`, `react` from `devDependencies`; remove `react` from `peerDependencies` and `peerDependenciesMeta` (drop if empty).

Edit `packages/theming/package.json`: remove the `"./react": "./src/react.ts"` line from `exports`; remove `@types/react`, `react` from `devDependencies`; remove `react` from `peerDependencies` and `peerDependenciesMeta` (drop if empty).

- [ ] **Step 4: Clean the now-unused JSX tsconfig settings**

After deletion there are no `.tsx` files left in `packages/diffs/src` or `packages/trees/src`.

Edit `packages/diffs/tsconfig.json` — remove the `compilerOptions` override (its only purpose was `jsxImportSource: "react"` for the react adapters) and narrow the include:
```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["src/**/*.ts"]
}
```

Edit `packages/trees/tsconfig.json` — narrow the include (no tsx remain):
```json
{
	"extends": "../../tsconfig.base.json",
	"include": ["src/**/*.ts"]
}
```

(Leave `tsconfig.base.json`'s `jsx`/`jsxImportSource` keys untouched — they are inert with no tsx and are shared config; out of scope.)

- [ ] **Step 5: Full verify gate**

```bash
cd /Users/penguin/dev/diffdeck
bun run typecheck   # EXIT 0 across all 5 configs
bun test            # all green (same suite as before, minus nothing — adapters had no tests run)
grep -rln "from ['\"]react['\"]\|from ['\"]react-dom\|from ['\"]preact" packages/diffs/src packages/trees/src packages/theming/src || echo "no framework imports left"
grep -rn "\"react\"\|\"react-dom\"\|@types/react" packages/diffs/package.json packages/trees/package.json packages/theming/package.json || echo "no react deps left"
```
Expected: typecheck EXIT 0; tests green; both greps report "none/no ... left". Then run the viewer build + parity build (as in Task 2 Step 5) → both succeed.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add -A
git commit -m "chore!: delete dead react/ssr adapters, drop react deps

The react/ adapters (diffs, trees), diffs' ssr/ react cluster, and
theming's unused react.ts binding are all dead (unexported, zero
importers). Remove them plus react/react-dom from diffs/trees/theming
and the now-inert JSX tsconfig overrides. Vanilla viewer is unaffected."
```

---

## Post-Task: lockfile sync (controller-run, NOT a subagent task)

After Task 5, `bun.lock` may still list `react`/`react-dom`. This does not affect typecheck/test/build (they use the existing `node_modules`). The controller runs a single `bun install` (never a subagent, to avoid the node_modules-destroying races documented in the memory capsule) to sync the lock, verifies the diff only drops react entries, and commits it separately if it changes. If the environment's registry state is uncertain, defer this to the user rather than risk a hang.

## Self-Review Checklist (run after writing, before execution)

- **Spec coverage:** Thread A → Tasks 1-2; Thread B → Tasks 3-4; Thread C → Task 5. All three threads + the 5 spec tasks covered. ✅
- **Refinements documented:** data-fold (viewer-owned, dropped), data-change-icon (added), DIFFS_TAG_NAME (reused), ssr/ (added to Thread C) — all in the Spec Refinements section for the reviewer. ✅
- **Type consistency:** `comparePathsInTreeOrder(string, string): number` used identically in Tasks 3 & 4. Constants `DIFFS_HEADER_ATTR`/`DIFFS_TITLE_ATTR`/`DIFFS_CHANGE_ICON_ATTR`/`DIFFS_TAG_NAME` named identically across Tasks 1 & 2. ✅
- **No placeholders:** every code step shows exact code or exact Bash patch. Vendored edits use Bash (format-hook-safe); app/config edits use Edit. ✅

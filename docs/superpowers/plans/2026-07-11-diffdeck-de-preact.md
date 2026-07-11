# diffdeck Plan 3 — de-preact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `@diffdeck/trees`' preact view skin as vanilla DOM (read-only subset), then remove `preact` + `preact-render-to-string`, preserving the controller/model layer, the `style.css` DOM/CSS contract, and the viewer's `FileTree` public API.

**Architecture:** `FileTree` = vanilla controller (`model/`) + view skin. Today the skin is preact (`render/FileTreeView.tsx` + hooks + `runtime.ts` + SSR half of `render/FileTree.ts`). We replace it with an imperative `FileTreeVanillaView` that subscribes to the controller and builds DOM with a small `el()` helper, reusing the already-vanilla pure helpers (`rowAttributes`, `rowClickPlan`, `iconResolver`, `focusHelpers`, `gitStatusPresentation`). Excluded features (virtualization, DnD, rename, sticky headers, SSR/hydration, context menus) are dropped, not ported.

**Tech Stack:** Bun (runtime/test/bundler), TypeScript 6, happy-dom (test DOM for view rendering), oxlint/oxfmt.

## Global Constraints

*(Every task's requirements implicitly include this section. Values are exact.)*

- **Controller/model layer is off-limits.** Do NOT edit anything under `packages/trees/src/model/`, `preparedInput.ts`, `constants.ts`, `builtInIcons.ts`, `sprite.ts`, `iconConfig.ts`, `utils/*` (except adding tests). The rewrite consumes these unchanged.
- **Reuse these pure helpers verbatim** (import, do not reimplement): `render/rowAttributes.ts` (`computeFileTreeRowElementAttributes`), `render/rowClickPlan.ts` (`computeFileTreeRowClickPlan`), `render/iconResolver.ts` (`createFileTreeIconResolver`), `render/focusHelpers.ts`, `utils/gitStatusPresentation.ts` (`GIT_STATUS_LABEL`/`GIT_STATUS_TITLE`), and OverflowText's pure `split*` functions.
- **Preserve the internal DOM/CSS contract that `style.css` binds to** — emit identically: `role="treeitem"`, `aria-level/posinset/setsize/selected/expanded`, `data-item-section`, `data-item-path`, `data-item-type` (`folder`/`file`), `data-item-git-status`, `data-item-selected`, `data-item-focused`, `data-item-contains-git-change`, the `[data-truncate-*]` OverflowText structure, host CSS vars `--trees-item-height` + `--trees-density-override` + the `--trees-*` palette, and sprite symbols `file-tree-icon-{chevron,file,dot,lock}` + per-extension icons. `FILE_TREE_TAG_NAME='file-tree-container'`, `FLATTENED_PREFIX='f::'`.
- **Preserve the viewer's `FileTree` runtime contract** — `new FileTree(options)` + `render({containerWrapper})` + `resetPaths(paths)` + `setGitStatus(gitStatus)` + `cleanUp()`, with these semantics: `render` mounts into `containerWrapper`; `resetPaths`+`setGitStatus` update in place WITHOUT resetting scroll or selection; `onSelectionChange(selected: string[])` fires with real file paths; empty↔populated transitions work.
- **Drop, don't port:** virtualization, DnD, rename, sticky headers, context menus, SSR/hydration. Remove their now-dead public exports from `index.ts`.
- **Exact version pins** (no carets) for any new dep. Vendored packages stay `workspace:*`.
- **License/NOTICE preserved** — do not touch `NOTICE`, `packages/trees/NOTICE.md`, `packages/trees/LICENSE`.
- **No edits to `apps/viewer`, `packages/diffs`, `packages/path-store`, `packages/theming`.**
- **`bun test` and `tsc` must stay green** at every task's end.

---

## File Structure

**New files:**
- `packages/trees/src/render/el.ts` — tiny `el(tag, attrs?, children?)` DOM builder (~25 lines).
- `packages/trees/src/components/vanillaIcon.ts` — `buildIcon(props): SVGElement` (ports `Icon.tsx`).
- `packages/trees/src/components/vanillaOverflowText.ts` — `buildMiddleTruncate`/`buildTruncate` DOM builders (ports the JSX half of `OverflowText.tsx`; the pure `split*` stay in `OverflowText.ts` — see Task 2).
- `packages/trees/src/render/renderRowVanilla.ts` — `buildRowContent(...)` + `buildRow(...)` (ports read-only branches of `FileTreeView.tsx`'s `renderFileTreeRowContent`/`renderStyledRow`).
- `packages/trees/src/render/FileTreeVanillaView.ts` — the imperative view class (mount/subscribe/renderRows/handlers/unmount).
- Test files (see each task): `packages/trees/src/__tests__/*.test.ts`.
- `packages/trees/src/__tests__/happydom.ts` — happy-dom registrator preload for trees view tests.

**Modified files:**
- `packages/trees/src/components/OverflowText.tsx` → split: pure `split*` + types move to `OverflowText.ts` (no preact); the preact components are deleted once `vanillaOverflowText.ts` replaces them.
- `packages/trees/src/render/FileTree.ts` — swap client mount to `FileTreeVanillaView`; delete SSR half (`serializeFileTreeSsrPayload`, `preloadFileTree`, `hydrate`, `#getViewProps` preact bits).
- `packages/trees/src/index.ts` — remove SSR/hydration exports.
- `packages/trees/package.json` — remove `preact`, `preact-render-to-string`; add `happy-dom` devDep.
- `packages/trees/tsconfig.json` and/or `tsconfig.base.json` — JSX no longer needed for trees (verify diffs still compiles).
- `bunfig.toml` — add the trees happy-dom preload if needed (see Task 1).

**Deleted files (Task 7):**
- `packages/trees/src/render/FileTreeView.tsx`, `packages/trees/src/render/RenameInput.tsx`, `packages/trees/src/render/runtime.ts`, `packages/trees/src/components/Icon.tsx`, and `render/renameHandoff.ts`, `render/scrollTarget.ts` if fully unreferenced after the swap (verify).

---

## Task 1: Parity net — happy-dom + pure-helper characterization tests

**Rationale:** `packages/trees` has ZERO tests today. Before touching the view, lock the reused substrate's behavior and stand up a DOM test environment. These tests must stay green through every later task.

**Files:**
- Create: `packages/trees/src/__tests__/rowAttributes.test.ts`
- Create: `packages/trees/src/__tests__/rowClickPlan.test.ts`
- Create: `packages/trees/src/__tests__/iconResolver.test.ts`
- Create: `packages/trees/src/__tests__/happydom.ts` (registrator)
- Create: `packages/trees/src/__tests__/happydom-smoke.test.ts`
- Modify: `packages/trees/package.json` (add `happy-dom` devDep), `bunfig.toml` (add trees preload)

**Interfaces:**
- Consumes: `computeFileTreeRowElementAttributes(input)` returns `Record<string,unknown>` with keys incl. `role`, `aria-level`, `data-item-path`, `data-item-type`, `data-item-git-status`, `data-item-selected`, `style`, `tabIndex`. `computeFileTreeRowClickPlan(input)` returns `{selection, toggleDirectory, closeSearch, revealCanonical}`. `createFileTreeIconResolver(icons?)` returns `{resolveIcon(name, filePath?)}`.
- Produces: `packages/trees/src/__tests__/happydom.ts` exporting nothing (side-effect registrator) — later view tests reference it via bunfig preload.

- [ ] **Step 1: Add happy-dom devDep (exact pin) and verify install**

Edit `packages/trees/package.json` → add to `devDependencies`: `"happy-dom": "20.0.11"` (verify the version resolves against the corp registry; if `bun install` fails with a TLS error, confirm `~/.bunfig.toml` cafile is set, then retry. If the *specific version* 404s, pick the nearest available and record it). Run:

```bash
cd /Users/penguin/dev/diffdeck && bun install
```
Expected: install succeeds, `happy-dom` appears in `node_modules`.

- [ ] **Step 2: Write the happy-dom registrator + bunfig preload**

Create `packages/trees/src/__tests__/happydom.ts`:

```ts
import { GlobalRegistrator } from "happy-dom/lib/GlobalRegistrator.js";

if (!(globalThis as { happyDOM?: unknown }).happyDOM) {
	GlobalRegistrator.register();
}
```

Add this preload to `bunfig.toml`'s `[test].preload` array (keep the existing css-inline preload):

```toml
preload = ["./scripts/parity/preload.ts", "./packages/trees/src/__tests__/happydom.ts"]
```

- [ ] **Step 3: Write the happy-dom smoke test (verify DOM works)**

Create `packages/trees/src/__tests__/happydom-smoke.test.ts`:

```ts
import { expect, test } from "bun:test";

test("happy-dom provides a document with attachShadow", () => {
	const host = document.createElement("div");
	const shadow = host.attachShadow({ mode: "open" });
	const btn = document.createElement("button");
	btn.setAttribute("role", "treeitem");
	shadow.append(btn);
	expect(shadow.querySelector("[role=treeitem]")).toBe(btn);
});
```

- [ ] **Step 4: Run it — expect PASS (confirms env before proceeding)**

```bash
cd /Users/penguin/dev/diffdeck && bun test packages/trees/src/__tests__/happydom-smoke.test.ts
```
Expected: 1 pass. If happy-dom lacks `attachShadow`, STOP and escalate (the view tests depend on it).

- [ ] **Step 5: Write rowAttributes characterization test**

Create `packages/trees/src/__tests__/rowAttributes.test.ts`. Cover: a file row and a directory row with the read-only feature/state flags the viewer produces (contextMenu/actionLane/drag all false), asserting the exact contract attributes. Use this fixture shape (fill `row` from the `FileTreeVisibleRow` interface at `model/publicTypes.ts:87`):

```ts
import { expect, test } from "bun:test";
import { computeFileTreeRowElementAttributes } from "../render/rowAttributes";
import type { FileTreeVisibleRow } from "../model/publicTypes";

const baseRow = (over: Partial<FileTreeVisibleRow>): FileTreeVisibleRow => ({
	ancestorPaths: [],
	depth: 0,
	hasChildren: false,
	index: 0,
	isFocused: false,
	isSelected: false,
	isExpanded: false,
	isFlattened: false,
	kind: "file",
	level: 0,
	name: "a.ts",
	path: "a.ts",
	posInSet: 0,
	setSize: 1,
	...over,
});

const readOnlyFeatures = {
	contextMenuEnabled: false,
	actionLaneEnabled: false,
	contextMenuButtonVisibility: null,
	contextMenuTriggerMode: null,
	gitLaneActive: true,
};
const cleanState = {
	isFocusRinged: false,
	isContextHovered: false,
	isDragTarget: false,
	isDragging: false,
	effectiveGitStatus: null,
	containsGitChange: false,
};

test("file row: treeitem role, aria, data-item-type=file", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({}),
		mode: "flow",
		targetPath: "a.ts",
		ariaLabel: "a.ts",
		domId: "id-a",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: cleanState,
	});
	expect(a.role).toBe("treeitem");
	expect(a["data-item-type"]).toBe("file");
	expect(a["data-item-path"]).toBe("a.ts");
	expect(a["aria-level"]).toBe(1);
	expect(a["aria-selected"]).toBe("false");
	expect(a["aria-expanded"]).toBeUndefined();
	expect(a.tabIndex).toBe(-1);
});

test("directory row: aria-expanded reflects isExpanded, data-item-type=folder", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({ kind: "directory", isExpanded: true, name: "src", path: "src" }),
		mode: "flow",
		targetPath: "src",
		ariaLabel: "src",
		domId: "id-src",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: cleanState,
	});
	expect(a["data-item-type"]).toBe("folder");
	expect(a["aria-expanded"]).toBe(true);
});

test("selected + git status + focused emit their data attributes", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({ isSelected: true, isFocused: true }),
		mode: "flow",
		targetPath: "a.ts",
		ariaLabel: "a.ts",
		domId: "id-a",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: { ...cleanState, isFocusRinged: true, effectiveGitStatus: "modified" },
	});
	expect(a["data-item-selected"]).toBe(true);
	expect(a["data-item-focused"]).toBe(true);
	expect(a["data-item-git-status"]).toBe("modified");
	expect(a["aria-selected"]).toBe("true");
	expect(a.tabIndex).toBe(0);
});
```

- [ ] **Step 6: Write rowClickPlan characterization test**

Create `packages/trees/src/__tests__/rowClickPlan.test.ts`:

```ts
import { expect, test } from "bun:test";
import { computeFileTreeRowClickPlan } from "../render/rowClickPlan";

const ev = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) => ({
	shiftKey: false, ctrlKey: false, metaKey: false, ...o,
});

test("plain click on file: single selection, no toggleDirectory", () => {
	const p = computeFileTreeRowClickPlan({ event: ev(), mode: "flow", isSearchOpen: false, isDirectory: false });
	expect(p.selection).toEqual({ kind: "single" });
	expect(p.toggleDirectory).toBe(false);
	expect(p.revealCanonical).toBe(false);
});

test("plain click on directory: toggleDirectory true", () => {
	const p = computeFileTreeRowClickPlan({ event: ev(), mode: "flow", isSearchOpen: false, isDirectory: true });
	expect(p.toggleDirectory).toBe(true);
});

test("meta click: toggle selection, no directory toggle", () => {
	const p = computeFileTreeRowClickPlan({ event: ev({ metaKey: true }), mode: "flow", isSearchOpen: false, isDirectory: true });
	expect(p.selection).toEqual({ kind: "toggle" });
	expect(p.toggleDirectory).toBe(false);
});

test("shift click: range selection (additive false without ctrl/meta)", () => {
	const p = computeFileTreeRowClickPlan({ event: ev({ shiftKey: true }), mode: "flow", isSearchOpen: false, isDirectory: false });
	expect(p.selection).toEqual({ kind: "range", additive: false });
});

test("search open: closeSearch true", () => {
	const p = computeFileTreeRowClickPlan({ event: ev(), mode: "flow", isSearchOpen: true, isDirectory: false });
	expect(p.closeSearch).toBe(true);
});
```

- [ ] **Step 7: Write iconResolver characterization test**

Create `packages/trees/src/__tests__/iconResolver.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createFileTreeIconResolver } from "../render/iconResolver";

test("chevron resolves to itself (no filePath remap)", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	expect(resolveIcon("file-tree-icon-chevron").name).toBe("file-tree-icon-chevron");
});

test("file icon resolves a per-extension built-in for .ts", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	const icon = resolveIcon("file-tree-icon-file", "src/a.ts");
	expect(icon.name).toBeTruthy();
	expect(icon.remappedFrom).toBe("file-tree-icon-file");
});

test("file icon without a matching rule returns a stable name", () => {
	const { resolveIcon } = createFileTreeIconResolver();
	const icon = resolveIcon("file-tree-icon-file", "noext");
	expect(typeof icon.name).toBe("string");
});
```

- [ ] **Step 8: Run all Task 1 tests — expect PASS**

```bash
cd /Users/penguin/dev/diffdeck && bun test packages/trees/
```
Expected: all pass (these characterize existing correct behavior). If iconResolver assertions guess a wrong built-in name, adjust the assertion to the actual resolver output (the goal is to lock CURRENT behavior, not impose new).

- [ ] **Step 9: Run full suite (nothing regressed) + typecheck**

```bash
cd /Users/penguin/dev/diffdeck && bun test && bun run typecheck
```
Expected: full suite green (Plan 2's 100 + new trees tests), typecheck green.

- [ ] **Step 10: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "test(trees): parity net — happy-dom env + pure-helper characterization tests"
```

---

## Task 2: Vanilla substrate — `el()`, vanilla Icon, vanilla OverflowText

**Files:**
- Create: `packages/trees/src/render/el.ts`, `packages/trees/src/components/vanillaIcon.ts`, `packages/trees/src/components/vanillaOverflowText.ts`
- Create: `packages/trees/src/__tests__/el.test.ts`, `vanillaIcon.test.ts`, `vanillaOverflowText.test.ts`
- Refactor: extract pure `split*` + types from `components/OverflowText.tsx` into `components/OverflowText.ts` (no preact import), re-export from the tsx for now (delete tsx in Task 7).

**Interfaces:**
- Produces: `el(tag: string, attrs?: Record<string, unknown>, children?: (Node | string)[]): HTMLElement` — sets attributes (boolean `true`→present, `false`/`null`/`undefined`→omit; `style` object→per-prop `element.style`), appends children (strings via `textContent`/`createTextNode`, never `innerHTML`). SVG namespace handled by a sibling `svgEl(...)` for `<svg>`/`<use>`.
- Produces: `buildIcon(props: { name: string; remappedFrom?: string; token?: string; width?: number; height?: number; viewBox?: string; label?: string; alignCapitals?: boolean }): SVGSVGElement`.
- Produces: `buildMiddleTruncate(opts)` / `buildTruncate(opts)` returning `HTMLElement` with the `[data-truncate-*]` structure the CSS expects.
- Consumes (Task 3+): all three.

- [ ] **Step 1: Write `el.test.ts` (failing)**

```ts
import { expect, test } from "bun:test";
import { el, svgEl } from "../render/el";

test("el sets string + boolean attrs, omits false/undefined", () => {
	const n = el("button", { role: "treeitem", "data-item-selected": true, "data-x": false, "data-y": undefined });
	expect(n.getAttribute("role")).toBe("treeitem");
	expect(n.hasAttribute("data-item-selected")).toBe(true);
	expect(n.hasAttribute("data-x")).toBe(false);
	expect(n.hasAttribute("data-y")).toBe(false);
});

test("el applies style object per-property", () => {
	const n = el("div", { style: { minHeight: "30px" } });
	expect(n.style.minHeight).toBe("30px");
});

test("el appends string children as text (no HTML injection)", () => {
	const n = el("span", {}, ["<b>x</b>"]);
	expect(n.textContent).toBe("<b>x</b>");
	expect(n.querySelector("b")).toBeNull();
});

test("svgEl builds svg/use in the SVG namespace", () => {
	const svg = svgEl("svg", {}, [svgEl("use", { href: "#file-tree-icon-file" })]);
	expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
	expect((svg.firstChild as Element).getAttribute("href")).toBe("#file-tree-icon-file");
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

```bash
cd /Users/penguin/dev/diffdeck && bun test packages/trees/src/__tests__/el.test.ts
```

- [ ] **Step 3: Implement `el.ts`**

Write `el(tag, attrs, children)` and `svgEl(tag, attrs, children)`. Rules: iterate `attrs`; if value is `true` → `setAttribute(k, "")`; if `false`/`null`/`undefined` → skip; if `k === "style"` and object → assign each entry to `element.style[prop]` (skip undefined); if `k === "tabIndex"` → `element.tabIndex = value`; else `setAttribute(k, String(value))`. Children: `Node` → append; `string` → `append(document.createTextNode(str))`. `svgEl` uses `document.createElementNS("http://www.w3.org/2000/svg", tag)` and `setAttributeNS(null, ...)` for `href` (or plain `setAttribute` — happy-dom accepts both; match what the sprite `<use>` needs).

- [ ] **Step 4: Run — expect PASS.** `bun test packages/trees/src/__tests__/el.test.ts`

- [ ] **Step 5: Write `vanillaIcon.test.ts` (failing), then implement `vanillaIcon.ts`**

Test asserts parity with `Icon.tsx`'s output (`components/Icon.tsx:52-64`): `<svg data-icon-name data-icon-token? data-align-capitals viewBox width height><use href="#name"/></svg>`, `aria-hidden` when no label, `role="img"`+`aria-label` when label given, `href` strips a leading `#`.

```ts
import { expect, test } from "bun:test";
import { buildIcon } from "../components/vanillaIcon";

test("icon: svg with use href, aria-hidden, data-icon-name", () => {
	const svg = buildIcon({ name: "file-tree-icon-file" });
	expect(svg.tagName.toLowerCase()).toBe("svg");
	expect(svg.getAttribute("data-icon-name")).toBe("file-tree-icon-file");
	expect(svg.getAttribute("aria-hidden")).toBe("true");
	const use = svg.querySelector("use");
	expect(use?.getAttribute("href")).toBe("#file-tree-icon-file");
});

test("icon with label: role=img + aria-label, remappedFrom wins data-icon-name", () => {
	const svg = buildIcon({ name: "x", remappedFrom: "file-tree-icon-file", label: "File" });
	expect(svg.getAttribute("role")).toBe("img");
	expect(svg.getAttribute("aria-label")).toBe("File");
	expect(svg.getAttribute("data-icon-name")).toBe("file-tree-icon-file");
});
```

Implement `buildIcon` from `el`/`svgEl`, mirroring `Icon.tsx` defaults (DEFAULT_WIDTH/HEIGHT 16, viewBox `0 0 16 16`, `data-align-capitals` present as string).

- [ ] **Step 6: Extract pure `split*` from OverflowText into `OverflowText.ts`**

Move `splitCenter/splitExtension/splitLeafPath/splitByIndex/splitLast/splitFirst` + the shared types (`CustomSplitFn`, `SplitOffset`, `TruncateMode`, etc., `OverflowText.tsx:9-187`) into a new `components/OverflowText.ts` (NO preact import). Have `OverflowText.tsx` re-import/re-export them so nothing breaks yet. Run `bun run typecheck` — expect green.

- [ ] **Step 7: Write `vanillaOverflowText.test.ts` (failing), then implement `vanillaOverflowText.ts`**

The CSS contract for truncation lives on `[data-truncate-*]` attributes (grep `style.css` for `data-truncate` to get the exact attribute names + structure the preact `MiddleTruncate`/`Truncate` emit — read `OverflowText.tsx:229-320`). Test asserts the built DOM carries the same `data-truncate-*` wrapper/segment structure for a middle-truncated filename (e.g. `"components/LongFileName.tsx"` → visible head + ellipsis + tail extension). Implement `buildMiddleTruncate`/`buildTruncate` using `el` + the pure `split*`.

- [ ] **Step 8: Run substrate tests + full suite + typecheck**

```bash
cd /Users/penguin/dev/diffdeck && bun test packages/trees/ && bun run typecheck
```
Expected: all green.

- [ ] **Step 9: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees): vanilla substrate — el() helper, buildIcon, buildMiddleTruncate"
```

---

## Task 3: Vanilla row renderer

**Files:**
- Create: `packages/trees/src/render/renderRowVanilla.ts`
- Create: `packages/trees/src/__tests__/renderRowVanilla.test.ts`

**Interfaces:**
- Consumes: `el`/`svgEl`, `buildIcon`, `buildMiddleTruncate`, `computeFileTreeRowElementAttributes`, `createFileTreeIconResolver`, `GIT_STATUS_LABEL`/`GIT_STATUS_TITLE`, `FileTreeVisibleRow`.
- Produces: `buildRowContent(row, ctx): DocumentFragment` (depth spacer + icon lane + content lane + git lane), and `buildRow(row, ctx): HTMLButtonElement` (a `<button>` carrying the attribute bag, containing `buildRowContent`). `ctx` supplies `iconResolver`, `itemHeight`, `features`, per-row `state`, `ariaLabel`, `domId`.

- [ ] **Step 1: Write `renderRowVanilla.test.ts` (failing)**

Port the read-only DOM the current `renderFileTreeRowContent`/`renderStyledRow` produce (`FileTreeView.tsx:828-909` content, `:983-1189` row — read-only branches only). Assert, for a file row and a directory row rendered under happy-dom:
- outer node is a `<button>` with `role="treeitem"`, `data-item-path`, `data-item-type`, `aria-level`.
- contains a chevron `<use href="#file-tree-icon-chevron">` for directories, a file icon `<use href="#...">` for files.
- git-status lane renders the `GIT_STATUS_LABEL` letter and `data-item-git-status` when a status is present.
- depth spacing reflects `row.depth`/`level` (assert the indentation element/inline var the current code uses — read the source to get the exact mechanism, e.g. a `--depth`/padding style).

Write 3–5 concrete assertions matching the SOURCE output (read it first; do not invent structure).

- [ ] **Step 2: Run — expect FAIL.** `bun test packages/trees/src/__tests__/renderRowVanilla.test.ts`

- [ ] **Step 3: Implement `renderRowVanilla.ts`**

Port `renderFileTreeRowContent` + the read-only branch of `renderStyledRow` from `FileTreeView.tsx` into vanilla builders. Use `computeFileTreeRowElementAttributes` for the button's attribute bag (apply via `el`). Reuse `buildIcon`, `buildMiddleTruncate`, `iconResolver`, git label/title constants. DROP: DnD (`draggable`/drag handlers), context-menu action lane, rename input, sticky mirror branch. Keep the `data-item-section` lanes exactly as the source names them.

- [ ] **Step 4: Run — expect PASS.** `bun test packages/trees/src/__tests__/renderRowVanilla.test.ts`

- [ ] **Step 5: Full suite + typecheck.** `bun test && bun run typecheck` — expect green.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees): vanilla row renderer (buildRow/buildRowContent, read-only)"
```

---

## Task 4: FileTreeVanillaView — container + subscription + renderRows

**Files:**
- Create: `packages/trees/src/render/FileTreeVanillaView.ts`
- Create: `packages/trees/src/__tests__/fileTreeVanillaView.test.ts`

**Interfaces:**
- Consumes: `FileTreeController` (via a passed instance/props — read `render/FileTree.ts:540 #getViewProps` and `model/internalTypes.ts FileTreeViewProps` to see exactly what the view needs: controller, iconResolver, itemHeight, searchEnabled, feature flags, onSelectionChange plumbing). Reuses `buildRow`, `focusHelpers`.
- Produces: `class FileTreeVanillaView { constructor(props); mount(host: HTMLElement): void; renderRows(): void; unmount(): void; }` — mount builds the list container(s) + optional search input, subscribes to `controller.subscribe`, renders all rows once; `renderRows` rebuilds visible rows via `controller.getVisibleRows(0, controller.getVisibleCount()-1)` into the list (full `replaceChildren` for v1); `unmount` unsubscribes + clears.

- [ ] **Step 1: Write `fileTreeVanillaView.test.ts` (failing)**

Construct via the PUBLIC path where possible: `new FileTree({ paths, initialExpansion:"open", flattenEmptyDirectories:false })`, `render({ containerWrapper })` into a happy-dom element, and assert the mounted DOM. (If wiring the view directly is cleaner for unit scope, construct the controller through `FileTree`'s internals is NOT allowed — prefer the public `FileTree`. This test may overlap Task 6; keep it focused on "rows appear + update".) Assertions:
- after render, the mount contains one `[data-item-path]` per expanded visible row for a fixture tree `["src/a.ts","src/b.ts","README.md"]` (with `initialExpansion:"open"` → `src` expanded, 3 files + 1 dir).
- calling `resetPaths([...])` with a changed set updates the rendered `[data-item-path]` set.

> NOTE for implementer: if `FileTree.render` is not yet swapped to the vanilla view (that's Task 6), gate this test to drive `FileTreeVanillaView` directly with a controller built from `prepareFileTreeInput`/the same options `FileTree` uses (read `FileTree.ts:211-263` constructor to replicate controller construction). Prefer the smallest wiring that exercises mount→renderRows→update. Document the choice in the report.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `FileTreeVanillaView.ts`** per the interface. Subscribe on mount; on emit call `renderRows()`. `renderRows` reads visible rows and `replaceChildren(...rows.map(buildRow))`. Preserve scroll: operate on an inner list element, not the scroll container, so `replaceChildren` doesn't reset the scroll container's `scrollTop` (verify in the update test).

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Full suite + typecheck.** Expect green.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees): FileTreeVanillaView — controller subscription + row rebuild"
```

---

## Task 5: Interaction wiring — click, keyboard, selection, search

**Files:**
- Modify: `packages/trees/src/render/FileTreeVanillaView.ts`
- Create: `packages/trees/src/__tests__/fileTreeVanillaView.interaction.test.ts`

**Interfaces:**
- Consumes: `computeFileTreeRowClickPlan`, controller selection/focus/search methods (`selectPathRange`, `togglePathSelectionFromInput`, `selectOnlyMountedPathFromInput`, `toggleMountedDirectoryFromInput`, `focusMountedPathFromInput`, `focusNextItem`/`focusPreviousItem`/`focusFirstItem`/`focusLastItem`/`focusParentItem`, `setSearch`/`openSearch`/`closeSearch`), `focusHelpers`.
- Produces: delegated `click`/`keydown`/`focusin` handlers on the root; a wired search `<input>` when `searchEnabled`; `onSelectionChange` fires with real paths.

- [ ] **Step 1: Write interaction test (failing)**

Assert against controller state / the `onSelectionChange` callback:
- plain click on a file row → `onSelectionChange` called with `[thatPath]`.
- click on a directory row → toggles expansion (row set changes / `aria-expanded` flips).
- meta/ctrl click → toggles that path in the selection (multi-select).
- ArrowDown/ArrowUp moves focus (`data-item-focused`/`tabIndex=0` moves).
- typing in the search input → `controller.setSearch` filters the rendered rows.

Build the input fixture through `FileTree` public options `{ search:true, onSelectionChange }`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement handlers.** Delegate on root: `click` → `closest('[data-item-path]')` → `computeFileTreeRowClickPlan` → dispatch to controller selection/toggle methods (mirror `FileTreeView.tsx handleRowClick :3509-3587`), then `onSelectionChange(controller.getSelectedPaths())` when selection version changes. `keydown` → arrow/Home/End/Enter/Space → focus + toggle (port `handleTreeKeyDown`, read-only subset; NO F2/rename). `focusin` → `focusMountedPathFromInput`. Search input `input` event → `controller.setSearch(value)`; Escape → `closeSearch`. Use `focusHelpers` for moving DOM focus to the focused row.

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Full suite + typecheck.** Expect green.

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees): FileTreeVanillaView interaction — click/keyboard/selection/search"
```

---

## Task 6: Swap `FileTree.ts` client path + delete SSR half

**Files:**
- Modify: `packages/trees/src/render/FileTree.ts`
- Create: `packages/trees/src/__tests__/fileTree.contract.test.ts`

**Interfaces:**
- Consumes: `FileTreeVanillaView`.
- Produces: `FileTree.render/hydrate` mount via the vanilla view; SSR functions removed. The 5-member viewer contract is preserved.

- [ ] **Step 1: Write the viewer-contract test (failing/red against current preact-or-mixed state as needed)**

Reproduce the viewer's exact call sequence under happy-dom:

```ts
import { expect, test } from "bun:test";
import { FileTree } from "../index";

test("viewer contract: construct → render → resetPaths+setGitStatus → cleanUp", () => {
	const selections: string[][] = [];
	const tree = new FileTree({
		paths: ["src/a.ts", "src/b.ts", "README.md"],
		gitStatus: [{ path: "src/a.ts", status: "modified" }],
		initialExpansion: "open",
		flattenEmptyDirectories: false,
		search: true,
		onSelectionChange: (s) => selections.push(s),
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });
	expect(mount.querySelectorAll("[data-item-path]").length).toBeGreaterThan(0);
	expect(mount.querySelector('[data-item-path="src/a.ts"][data-item-git-status="modified"]')).not.toBeNull();

	// in-place update must not throw and must reflect new paths/status
	tree.resetPaths(["src/a.ts", "src/c.ts"]);
	tree.setGitStatus([{ path: "src/c.ts", status: "added" }]);
	expect(mount.querySelector('[data-item-path="src/c.ts"]')).not.toBeNull();

	tree.cleanUp();
	expect(mount.querySelectorAll("[data-item-path]").length).toBe(0);
});
```

- [ ] **Step 2: Run — expect FAIL** (or partial) — confirms the current path doesn't satisfy it yet under vanilla.

- [ ] **Step 3: Swap the client mount + delete SSR**

In `FileTree.ts`: replace `renderFileTreeRoot`/`hydrateFileTreeRoot`/`unmountFileTreeRoot` (runtime.ts) usage in `render`/`unmount`/`cleanUp` with `FileTreeVanillaView` mount/unmount. DELETE `serializeFileTreeSsrPayload` (`:151`), `preloadFileTree` (`:824`), `hydrate()` (`:503`), and remove `import { h } from 'preact'` + `import { renderToString } from 'preact-render-to-string'` (`:1-2`). Simplify `#prepareHost` declarative-shadow-DOM handling to plain `attachShadow` (CSR only). KEEP `#applyDensityHostStyle`, `#syncBuiltInSpriteSheet`, `#syncUnsafeCSS`, `#emitSelectionChange`, `#getOrCreateWrapper`.

- [ ] **Step 4: Run the contract test — expect PASS.**

- [ ] **Step 5: Full suite + typecheck.** Expect green. (`index.ts` still exports SSR names → typecheck may fail; if so, that's Task 7 — but if the deletions break `index.ts` imports now, remove those specific exports here to keep green, and note it.)

- [ ] **Step 6: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees): mount FileTree via vanilla view, delete SSR/hydration path"
```

---

## Task 7: Remove preact — delete files, deps, exports; final verification

**Files:**
- Delete: `render/FileTreeView.tsx`, `render/RenameInput.tsx`, `render/runtime.ts`, `components/Icon.tsx`, `components/OverflowText.tsx` (pure parts now in `OverflowText.ts`); and `render/renameHandoff.ts`, `render/scrollTarget.ts`, `render/controllerSnapshotSubscription.ts`, `render/slotHost.ts` IF `grep` shows zero remaining references.
- Modify: `packages/trees/package.json` (drop `preact`, `preact-render-to-string`), `packages/trees/src/index.ts` (drop SSR/hydration exports), `packages/trees/tsconfig.json` / `tsconfig.base.json` (JSX), `model/internalTypes.ts` if `FileTreeViewProps` becomes dead.

- [ ] **Step 1: Delete the preact view files** and grep for any remaining importers:

```bash
cd /Users/penguin/dev/diffdeck/packages/trees && grep -rn "FileTreeView\|from './runtime'\|from '../render/runtime'\|RenameInput\|components/Icon'\|renameHandoff\|scrollTarget\|preact" src && echo "--- if any above are live imports (not comments), fix them ---"
```
Remove only files with zero live importers. For each still-referenced symbol, repoint to the vanilla replacement.

- [ ] **Step 2: Strip SSR/hydration exports from `index.ts`**

Remove `preloadFileTree`, `serializeFileTreeSsrPayload`, `type FileTreeSsrPayload`, `type FileTreeHydrationProps` from the import + export lists (`index.ts`). Leave every other export intact.

- [ ] **Step 3: Drop preact deps from `packages/trees/package.json`**

Remove `"preact"` and `"preact-render-to-string"` from `dependencies`. Keep `@diffdeck/path-store`, `@diffdeck/theming`. (Leave the react devDep/peer question to Plan 4 unless it now breaks typecheck.) Run `bun install`.

- [ ] **Step 4: Fix JSX/tsconfig**

`packages/trees` no longer has `.tsx`. Ensure `tsconfig.base.json`'s `jsxImportSource:"preact"` doesn't break `diffs` (which overrides to react) — trees now needs no JSX. If trees' tsconfig inherited preact JSX, it's now inert; verify `tsc -p packages/trees/tsconfig.json` passes. Remove `render/jsx`-only type shims if dead.

- [ ] **Step 5: Full verification**

```bash
cd /Users/penguin/dev/diffdeck && bun run typecheck && bun test
```
Expected: typecheck green across all packages + apps/viewer; `bun test` all green. Confirm no `preact` import remains: `grep -rn "preact" packages/trees/src` → only comments/none.

- [ ] **Step 6: Visual before/after parity (real Chrome, manual gate)**

Rebuild the viewer bundle and the parity harness; confirm the tree still renders rows/icons/git-badges/truncation. This is the human-verifiable parity check the automated DOM tests can't fully cover:

```bash
cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts && bun run scripts/parity/build.ts
```
Expected: both build without error (the parity harness importing `@diffdeck/trees` now pulls the vanilla view). Report bundle sizes. (Actual browser eyeballing is noted for the controller/human; the build succeeding + all DOM tests green is the automated gate.)

- [ ] **Step 7: Commit**

```bash
cd /Users/penguin/dev/diffdeck && git add -A && git commit -m "feat(trees)!: remove preact — delete view skin, drop preact deps, strip SSR exports

BREAKING CHANGE: @diffdeck/trees no longer exports preloadFileTree/
serializeFileTreeSsrPayload/FileTreeSsrPayload/FileTreeHydrationProps (SSR/
hydration removed). FileTree is now a vanilla read-only renderer."
```

---

## Self-Review notes (for the controller)

- **Spec coverage:** Task 1 = parity net (spec §검증); Tasks 2–5 = vanilla rewrite (spec §아키텍처); Task 6 = FileTree swap + SSR delete; Task 7 = preact removal + exports + verification. All spec drop-list items handled in 6–7.
- **Contract preservation** is asserted by the Task 6 viewer-contract test (the exact main.ts sequence) and the DOM-attribute tests in Tasks 1/3.
- **Risk order:** parity net first (Task 1) is deliberate — every later task runs against it.
- **Uncertainty flagged for implementers:** exact depth/indent mechanism and `[data-truncate-*]` structure must be READ from source before asserting (Tasks 2–3 say so); controller construction for the view unit test (Task 4) may drive the view directly — implementer picks the smallest wiring and documents it.

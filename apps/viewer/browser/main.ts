import {
	CodeView,
	DIFFS_HEADER_ATTR,
	DIFFS_TAG_NAME,
	DIFFS_TITLE_ATTR,
	parseDiffFromFile,
} from "@diffdeck/diffs";
import { comparePathsInTreeOrder } from "@diffdeck/path-store";
import { FileTree } from "@diffdeck/trees";
import type { DiffFile } from "../server/diff.ts";
import { createCopyButton } from "./copyButton.ts";
import { movedBeyondThreshold } from "./drag.ts";
import { ensureImageCard, IMAGE_CARD_CSS } from "./imageCard.ts";
import { blobUrl, type ImageEntry, imageEntries } from "./imageDiff.ts";
import { isLargeFile } from "./largeFile.ts";
import {
	FLATTEN_KEY,
	resolveDiffStyle,
	resolveFlatten,
	resolveTreeHidden,
	resolveTreeSide,
	resolveUntracked,
	resolveWatch,
	TREE_SIDE_KEY,
	type TreeSide,
	WATCH_KEY,
} from "./prefs.ts";
import { createFindBar, type FindBar } from "./search/findBar.ts";
import { highlightDom } from "./search/highlightDom.ts";
import type { SearchFile, SearchMatch } from "./search/searchIndex.ts";

const params = new URLSearchParams(location.search);
const repo = params.get("repo") ?? "";
const token = params.get("token") ?? "";

const treeMount = document.getElementById("tree") as HTMLElement;
const diffMount = document.getElementById("diff") as HTMLElement;

// 이미지 diff 아이템: id(파일 경로) → 카드 데이터. renderPatch마다 갱신되고
// onPostRender가 해당 컨테이너의 shadow DOM에 카드를 주입할 때 참조한다.
let imageEntryById = new Map<string, ImageEntry>();
let imageUrlFor: Parameters<typeof ensureImageCard>[3] = () => "";

// Fold/unfold a file by clicking anywhere on its header bar. Delegated via
// composedPath so it works across @diffdeck/diffs' light/shadow DOM: a header
// click is any path crossing a [data-diffs-header] element (filename, stats,
// or empty header row); the file id comes from the enclosing <diffs-container>'s
// [data-fold] button. Code lines and hunk separators sit under a <pre> without
// that marker, so they're ignored (keeps unchanged-context expansion working).
const DRAG_THRESHOLD = 6;
let pointerDown: { x: number; y: number } | null = null;

diffMount.addEventListener("pointerdown", (event) => {
	pointerDown = { x: event.clientX, y: event.clientY };
});

diffMount.addEventListener("click", (event) => {
	if (!codeView) return;
	// Don't toggle when the interaction was a drag (e.g. selecting the filename)
	// so it never feels like an accidental collapse.
	if (
		pointerDown &&
		movedBeyondThreshold(
			pointerDown,
			{ x: event.clientX, y: event.clientY },
			DRAG_THRESHOLD,
		)
	) {
		return;
	}
	if (window.getSelection()?.toString()) return;

	const path = event.composedPath();
	const isHeader = path.some(
		(node): node is HTMLElement =>
			node instanceof HTMLElement && node.hasAttribute(DIFFS_HEADER_ATTR),
	);
	if (!isHeader) return;
	const container = path.find(
		(node): node is HTMLElement =>
			node instanceof HTMLElement &&
			node.tagName === DIFFS_TAG_NAME.toUpperCase(),
	);
	// data-fold is the viewer's own id carrier (set in makeFoldButton), not an engine attribute
	const id = container?.querySelector<HTMLElement>("[data-fold]")?.dataset.fold;
	if (!id) return;
	const item = codeView.getItem(id);
	if (item?.type !== "diff") return;
	const nextCollapsed = !collapsedIds.has(id);
	if (nextCollapsed) collapsedIds.add(id);
	else collapsedIds.delete(id);
	renderVersion += 1;
	codeView.updateItem({
		...item,
		collapsed: nextCollapsed,
		version: renderVersion,
	});
});

const statusEl = document.getElementById("status") as HTMLElement;
const modeSelect = document.getElementById("diff-mode") as HTMLSelectElement;
const appEl = document.getElementById("app") as HTMLElement;

let diffStyle: "unified" | "split" = resolveDiffStyle(params.get("style"));
let includeUntracked = resolveUntracked(params.get("untracked"));
let diffMode: "working" | "base" = "working";
let flattenDirs = resolveFlatten(params.get("flatten"), (k) =>
	localStorage.getItem(k),
);
let treeSide: TreeSide = resolveTreeSide(params.get("tree"), (k) =>
	localStorage.getItem(k),
);
let treeHidden: boolean = resolveTreeHidden(params.get("sidebar"));
let codeView: CodeView | null = null;
let fileTree: FileTree | null = null;

let lastPatch: string | null = null;
let lastTreeKey: string | null = null;
let renderedDiffStyle: "unified" | "split" | null = null;
let renderVersion = 0;

const collapsedIds = new Set<string>();
const seenIds = new Set<string>();

let searchFiles: SearchFile[] = [];
let findBar: FindBar | null = null;

// Reuse one button element per file across re-renders: a fold toggle re-runs
// renderHeaderPrefix, and only a persistent DOM node can CSS-tween its chevron
// rotation (a freshly created SVG is born at the final angle — no animation).
const foldButtons = new Map<string, HTMLButtonElement>();

const makeFoldButton = (id: string): HTMLButtonElement => {
	const collapsed = collapsedIds.has(id);
	let btn = foldButtons.get(id);
	if (!btn) {
		btn = document.createElement("button");
		btn.type = "button";
		btn.dataset.fold = id;
		btn.style.cssText =
			"background:transparent;border:0;color:#84848a;cursor:pointer;display:inline-flex;align-items:center;padding:0 6px 0 0;line-height:1";
		// Inline chevron SVG: Pierre's icon sprite lives in the diff's shadow DOM
		// and isn't reachable from this light-DOM slotted button, so we inline a
		// clean caret. It rotates (0deg expanded ▾, -90deg collapsed ▸) below.
		btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style="transition:transform .15s ease"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M4.5 6.5 8 10l3.5-3.5"/></svg>`;
		foldButtons.set(id, btn);
	}
	btn.setAttribute("aria-label", collapsed ? "Expand file" : "Collapse file");
	const svg = btn.querySelector("svg");
	if (svg) svg.style.transform = `rotate(${collapsed ? -90 : 0}deg)`;
	return btn;
};

const teardownViews = (): void => {
	codeView?.cleanUp();
	codeView = null;
	fileTree?.cleanUp();
	fileTree = null;
	renderedDiffStyle = null;
	lastTreeKey = null;
	foldButtons.clear();
	treeMount.replaceChildren();
};

// A rendered diff item is a <diffs-container> whose fold button carries the id.
const containerFileId = (container: Element): string | null =>
	container.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ?? null;

const highlightContainer = (container: HTMLElement): void => {
	const fileId = containerFileId(container);
	if (!fileId || !findBar) return;
	const root = container.shadowRoot ?? container;
	highlightDom(root, findBar.getQuery(), findBar.getActiveMatch(), fileId);
};

const highlightAllVisible = (): void => {
	const containers = diffMount.querySelectorAll<HTMLElement>(DIFFS_TAG_NAME);
	for (const container of containers) highlightContainer(container);
};

// Inject a "copy file path" button right after the filename in a rendered
// file header (idempotent — skip if already present; re-added after Pierre
// rebuilds the header).
const ensureCopyButton = (container: HTMLElement): void => {
	const fileId = containerFileId(container);
	if (!fileId) return;
	const root = container.shadowRoot ?? container;
	if (root.querySelector("[data-copy-name]")) return;
	const title = root.querySelector(`[${DIFFS_TITLE_ATTR}]`);
	if (!title) return;
	title.after(createCopyButton(fileId));
};

// 이미지 아이템 컨테이너에 Old/New 카드를 주입/제거 (onPostRender에서 호출).
const syncImageCard = (container: HTMLElement): void => {
	const fileId = containerFileId(container);
	if (!fileId) return;
	ensureImageCard(
		container,
		imageEntryById.get(fileId),
		collapsedIds.has(fileId),
		imageUrlFor,
	);
};

let expandAll = false; // find bar 활성 중 전역 미변경 context 펼침
const autoExpandedIds = new Set<string>(); // 검색이 임시로 펼친 대용량 파일

const codeViewOptions = (): ConstructorParameters<
	typeof CodeView<undefined>
>[0] => ({
	diffStyle,
	themeType: "dark",
	stickyHeaders: true,
	hunkSeparators: "line-info",
	expansionLineCount: 10,
	collapsedContextThreshold: 3,
	expandUnchanged: expandAll,
	renderHeaderPrefix: (fileDiff) => makeFoldButton(fileDiff.name),
	onPostRender: (node: HTMLElement, _instance: unknown, phase: string) => {
		if (phase === "unmount") return;
		const container =
			(node.closest?.(DIFFS_TAG_NAME) as HTMLElement | null) ?? node;
		highlightContainer(container);
		ensureCopyButton(container);
		syncImageCard(container);
	},
	unsafeCSS:
		// The header is sticky, so its own code scrolls underneath it: the hover
		// tint has to be mixed into --diffs-bg rather than layered over it as a
		// translucent colour, which would replace the opaque background and let
		// the code show through. --diffs-mixer is the engine's own contrast
		// token (light-dark(#000, #fff)), so this tints the right direction in
		// either theme; in srgb because that matches how the browser would have
		// composited the equivalent 5% overlay.
		`[${DIFFS_HEADER_ATTR}]{cursor:pointer;transition:background-color .15s}[${DIFFS_HEADER_ATTR}]:hover{background-color:color-mix(in srgb,var(--diffs-mixer) 5%,var(--diffs-bg))}` +
		"mark.cc-find-hit{background:#e3b341;color:#000;border-radius:2px}" +
		"mark.cc-find-hit--active{background:#f0883e;color:#000}" +
		"[data-copy-name]{opacity:0;transition:opacity .15s;background:transparent;border:0;color:#84848a;cursor:pointer;display:inline-flex;align-items:center;padding:0 4px;margin-left:2px;line-height:1}" +
		`[${DIFFS_HEADER_ATTR}]:hover [data-copy-name]{opacity:1}[data-copy-name]:hover{color:#adadb1}[data-copy-name]:focus-visible{opacity:1}${IMAGE_CARD_CSS}`,
});

const restoreAutoExpanded = (): void => {
	if (!codeView || autoExpandedIds.size === 0) return;
	for (const id of autoExpandedIds) {
		if (collapsedIds.has(id)) continue;
		const item = codeView.getItem(id);
		if (item?.type !== "diff") continue;
		collapsedIds.add(id);
		renderVersion += 1;
		codeView.updateItem({ ...item, collapsed: true, version: renderVersion });
	}
	autoExpandedIds.clear();
};

const renderPatch = (unsorted: DiffFile[]): void => {
	// 사이드바 트리와 같은 순서(디렉터리 우선·자연 정렬)로 diff 아이템을 배치.
	const files = unsorted.toSorted((a, b) =>
		comparePathsInTreeOrder(a.name, b.name),
	);
	if (files.length === 0) {
		teardownViews();
		diffMount.replaceChildren();
		diffMount.innerHTML = '<div id="empty">No changes.</div>';
		statusEl.textContent = "";
		return;
	}
	statusEl.textContent = `${files.length} file(s)`;

	// 바이너리 이미지는 파일 순서 그대로 diff 흐름에 인라인 카드로 들어간다:
	// 빈 diff 아이템(헤더 제공)에 onPostRender가 Old/New 카드를 주입.
	imageEntryById = new Map(imageEntries(files).map((e) => [e.name, e]));
	imageUrlFor = (path, side, version) =>
		blobUrl({ repo, token, path, side, mode: diffMode, version });

	// File tree lists ALL changed files (binary included); status maps 1:1 to
	// @diffdeck/trees GitStatus.
	const paths = files.map((f) => f.name);
	const gitStatus = files.map((f) => ({ path: f.name, status: f.status }));

	// Diff items: parse each non-binary file's full old/new contents into a
	// NON-partial FileDiffMetadata so hunk expansion works.
	renderVersion += 1;
	const items = files
		.filter((f) => !f.binary || imageEntryById.has(f.name))
		.map((f) => {
			const isImage = imageEntryById.has(f.name);
			const fileDiff = parseDiffFromFile(
				{ name: f.oldName ?? f.name, contents: isImage ? "" : f.oldContents },
				{ name: f.name, contents: isImage ? "" : f.newContents },
			);
			// Large files (lockfiles or over the changed-line threshold) start
			// collapsed on first sight.
			if (!seenIds.has(f.name)) {
				seenIds.add(f.name);
				const changedLines =
					fileDiff.additionLines.length + fileDiff.deletionLines.length;
				if (isLargeFile(f.name, changedLines)) collapsedIds.add(f.name);
			}
			return {
				id: f.name,
				type: "diff" as const,
				fileDiff,
				version: renderVersion,
				collapsed: collapsedIds.has(f.name),
			};
		});

	searchFiles = items.map((it) => ({ fileId: it.id, fileDiff: it.fileDiff }));
	findBar?.setData();

	// File tree: create once; afterwards update in place only when the file set
	// or statuses changed (so editing a file's contents doesn't reset it).
	const treeKey = JSON.stringify(gitStatus);
	if (!fileTree) {
		treeMount.replaceChildren();
		fileTree = new FileTree({
			paths,
			gitStatus,
			initialExpansion: "open",
			flattenEmptyDirectories: flattenDirs,
			search: true,
			onSelectionChange: (selected) => {
				const path = selected[0];
				if (path && codeView) codeView.scrollTo({ type: "item", id: path });
			},
		});
		fileTree.render({ containerWrapper: treeMount });
		positionTreeToggleBtn(treeSide);
		lastTreeKey = treeKey;
	} else if (treeKey !== lastTreeKey) {
		fileTree.resetPaths(paths);
		fileTree.setGitStatus(gitStatus);
		lastTreeKey = treeKey;
	}

	// Diff panel: recreate the CodeView on first render, when transitioning from
	// empty, or when diffStyle changed; otherwise reuse it so scroll is
	// preserved across updates.
	if (!codeView || renderedDiffStyle !== diffStyle) {
		codeView?.cleanUp();
		diffMount.replaceChildren();
		codeView = new CodeView(codeViewOptions());
		// Render further ahead of the viewport than CodeView's 200px default.
		// Re-mounting a file drops its highlighter (DiffHunksRenderer.recycle),
		// so the file paints headerless and 0-height until an async highlight
		// lands ~2 frames later; overscrollSize is the engine's own knob for
		// keeping such gaps off-screen ("reduce blanking during fast scrolls"),
		// and 200px is narrower than a single fast-scroll frame delta, so the
		// gap gets composited inside the pane and reads as a blinking header.
		// 1000 is what the engine's sibling Virtualizer defaults to for exactly
		// this (Virtualizer.ts:20-22), and it is the smallest value measured
		// clean at 400px/frame: 600 still showed 2 defective frames in 40.
		//
		// The cost is that overscrollSize also widens the `fitPerfectly`
		// large-jump threshold (CodeView.ts:2576-2580 compares against
		// viewportHeight + overscrollSize * 2), so jumps of ~viewport+400..2000px
		// now paint a full window instead of the minimum, and the element pool
		// grows (:963). Accepted: the blink is constant and user-visible, while
		// this only costs one frame on a jump — and no smaller value fixes it.
		//
		// Set per instance: main.ts rebuilds the CodeView on diffStyle change,
		// and setOptions never touches config.
		codeView.config.overscrollSize = 1000;
		codeView.setup(diffMount);
		codeView.setItems(items);
		codeView.render();
		renderedDiffStyle = diffStyle;
		// First-paint stabilization: the virtualized CodeView fills its visible
		// range only after the container is measured. Re-render on the next two
		// frames (guarded against a superseded instance).
		const cv = codeView;
		requestAnimationFrame(() => {
			if (cv !== codeView) return;
			cv.render();
			requestAnimationFrame(() => {
				if (cv === codeView) cv.render();
			});
		});
	} else {
		const scrollTop = codeView.getScrollTop();
		codeView.setItems(items);
		codeView.render();
		codeView.scrollTo({ type: "position", position: scrollTop });
	}
};

// Reflect the resolved base name on the "vs base" option, and disable it
// (falling back to working mode) when no base could be resolved.
const updateBaseOption = (base: string): void => {
	const opt = modeSelect?.querySelector<HTMLOptionElement>(
		'option[value="base"]',
	);
	if (!opt) return;
	if (base) {
		opt.textContent = `vs ${base}`;
		opt.disabled = false;
		if (modeSelect.value !== diffMode) modeSelect.value = diffMode;
	} else {
		opt.textContent = "vs base (unavailable)";
		opt.disabled = true;
		if (diffMode === "base") {
			diffMode = "working";
			modeSelect.value = "working";
			localStorage.setItem("cc-statusline:diff-mode", "working");
		}
	}
};

const fetchDiff = async (): Promise<{
	files: DiffFile[];
	base: string;
} | null> => {
	const query = new URLSearchParams({
		repo,
		token,
		untracked: includeUntracked ? "1" : "0",
		mode: diffMode,
	});
	try {
		const res = await fetch(`/api/diff?${query.toString()}`);
		if (!res.ok) return null;
		const files = (await res.json()) as DiffFile[];
		return { files, base: res.headers.get("x-diff-base") ?? "" };
	} catch (err) {
		console.error(err);
		return null;
	}
};

const load = async (): Promise<void> => {
	statusEl.textContent = "Loading…";
	const result = await fetchDiff();
	if (result === null) {
		diffMount.innerHTML = '<div id="empty">Failed to load diff.</div>';
		return;
	}
	updateBaseOption(result.base);
	lastPatch = JSON.stringify(result.files);
	renderPatch(result.files);
};

// Segmented Unified/Split control: the active segment stays highlighted
// (aria-pressed drives both accessibility and the CSS raised state).
const styleButtons = Array.from(
	document.querySelectorAll<HTMLButtonElement>(
		"#diff-style-group [data-style]",
	),
);
const syncStyleButtons = (): void => {
	for (const b of styleButtons) {
		b.setAttribute(
			"aria-pressed",
			b.dataset.style === diffStyle ? "true" : "false",
		);
	}
};
for (const b of styleButtons) {
	b.addEventListener("click", () => {
		const next = b.dataset.style === "split" ? "split" : "unified";
		if (next === diffStyle) return;
		diffStyle = next;
		syncStyleButtons();
		void load();
	});
}
syncStyleButtons();
const untrackedInput = document.getElementById(
	"toggle-untracked",
) as HTMLInputElement;
if (untrackedInput) untrackedInput.checked = includeUntracked;
untrackedInput?.addEventListener("change", () => {
	includeUntracked = untrackedInput.checked;
	void load();
});
document
	.getElementById("refresh")
	?.addEventListener("click", () => void load());
window.addEventListener("focus", () => void load());

modeSelect?.addEventListener("change", () => {
	diffMode = modeSelect.value === "base" ? "base" : "working";
	localStorage.setItem("cc-statusline:diff-mode", diffMode);
	void load();
});

// URL mode (from the statusline link) wins over the persisted preference so a
// "vs base" edit link opens directly in base mode; otherwise restore localStorage.
const urlMode = params.get("mode");
if (urlMode === "base" || urlMode === "working") {
	diffMode = urlMode;
	localStorage.setItem("cc-statusline:diff-mode", urlMode);
	if (modeSelect) modeSelect.value = urlMode;
} else if (localStorage.getItem("cc-statusline:diff-mode") === "base") {
	diffMode = "base";
	modeSelect.value = "base";
}

// Apply persisted file-tree side and reflect stored prefs in the overflow menu.
appEl.dataset.treeSide = treeSide;

const flattenInput = document.getElementById(
	"toggle-flatten",
) as HTMLInputElement | null;
if (flattenInput) flattenInput.checked = flattenDirs;

const treeSideInput = document.getElementById(
	"toggle-tree-side",
) as HTMLInputElement | null;
if (treeSideInput) treeSideInput.checked = treeSide === "right";

// 토글해도 메뉴는 열린 채 유지한다(연속 조작). 트리가 오른쪽일 때는 열린
// 메뉴가 트리 상단 일부를 덮어 flatten 변화가 즉시 안 보일 수 있지만,
// 메뉴를 닫으면(바깥 클릭/Esc) 적용돼 있다.
treeSideInput?.addEventListener("change", () => {
	treeSide = treeSideInput.checked ? "right" : "left";
	appEl.dataset.treeSide = treeSide;
	localStorage.setItem(TREE_SIDE_KEY, treeSide);
	positionTreeToggleBtn(treeSide);
});

flattenInput?.addEventListener("change", () => {
	flattenDirs = flattenInput.checked;
	localStorage.setItem(FLATTEN_KEY, flattenDirs ? "1" : "0");
	// flattenEmptyDirectories is a constructor option, so the tree must be
	// recreated; force a rebuild on the next render and reload the diff.
	fileTree?.cleanUp();
	fileTree = null;
	lastTreeKey = null;
	void load();
});

// Hide/show the file-tree sidebar: session-only (no localStorage — every
// fresh load starts visible unless launched with --hide-tree). Lives inside
// the tree's own search row, not the app toolbar: FileTree's `search: true`
// UI renders inside an open shadow root (`<file-tree-container>`) with no
// public hook for extra content, so this reaches in via the documented
// `[data-file-tree-search-container]` marker — the same shadow-DOM-reach
// pattern already used above for the diffs engine's copy button/image
// cards. The overflow-menu checkbox mirrors the same state through the same
// setter, so the two can never drift out of sync.
const treeToggleBtn = document.createElement("button");
treeToggleBtn.type = "button";
treeToggleBtn.id = "tree-toggle-btn";
treeToggleBtn.style.cssText =
	"flex:0 0 auto;height:var(--trees-row-height);margin:0 6px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;background:transparent;border:1px solid var(--trees-border-color);border-radius:var(--trees-border-radius);color:var(--trees-fg-muted);cursor:pointer";
treeToggleBtn.innerHTML =
	'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>';

const treeHiddenInput = document.getElementById(
	"toggle-tree-hidden",
) as HTMLInputElement | null;

// Places (or re-places) the button inside the tree's search row: before the
// search input when the tree is on the left, after it when on the right —
// mirroring the tree's own physical side. Called once per fresh FileTree
// (fileTree.render() re-creates the shadow root, dropping any prior
// insertion) and again whenever treeSide changes.
const positionTreeToggleBtn = (side: TreeSide): void => {
	const host = treeMount.querySelector("file-tree-container");
	const searchContainer = host?.shadowRoot?.querySelector<HTMLElement>(
		"[data-file-tree-search-container]",
	);
	if (!searchContainer) return;
	if (side === "right") searchContainer.append(treeToggleBtn);
	else searchContainer.prepend(treeToggleBtn);
};

const setTreeHidden = (next: boolean): void => {
	treeHidden = next;
	appEl.dataset.treeHidden = treeHidden ? "true" : "false";
	const label = treeHidden ? "Show file tree" : "Hide file tree";
	treeToggleBtn.setAttribute("aria-pressed", treeHidden ? "true" : "false");
	treeToggleBtn.setAttribute("aria-label", label);
	treeToggleBtn.setAttribute("title", label);
	if (treeHiddenInput) treeHiddenInput.checked = treeHidden;
};
setTreeHidden(treeHidden);

treeToggleBtn.addEventListener("click", () => setTreeHidden(!treeHidden));
treeHiddenInput?.addEventListener("change", () =>
	setTreeHidden(treeHiddenInput.checked),
);

// Overflow (⋯) menu: toggle on button click, close on outside click / Escape.
const overflowBtn = document.getElementById("overflow-btn");
const overflowMenu = document.getElementById("overflow-menu");

const setOverflowOpen = (open: boolean): void => {
	if (!overflowMenu || !overflowBtn) return;
	overflowMenu.hidden = !open;
	overflowBtn.setAttribute("aria-expanded", open ? "true" : "false");
};

overflowBtn?.addEventListener("click", (event) => {
	event.stopPropagation();
	if (overflowMenu) setOverflowOpen(Boolean(overflowMenu.hidden));
});

document.addEventListener("mousedown", (event) => {
	if (!overflowMenu || overflowMenu.hidden) return;
	const target = event.target as Node;
	if (overflowMenu.contains(target) || overflowBtn?.contains(target)) return;
	setOverflowOpen(false);
});

document.addEventListener("keydown", (event) => {
	if (event.key === "Escape") setOverflowOpen(false);
});

findBar = createFindBar({
	elements: {
		bar: document.getElementById("find-bar") as HTMLElement,
		input: document.getElementById("find-input") as HTMLInputElement,
		count: document.getElementById("find-count") as HTMLElement,
		prev: document.getElementById("find-prev") as HTMLButtonElement,
		next: document.getElementById("find-next") as HTMLButtonElement,
		close: document.getElementById("find-close") as HTMLButtonElement,
	},
	getFiles: () => searchFiles,
	revealMatch: (m: SearchMatch) => {
		codeView?.scrollTo({
			type: "line",
			id: m.fileId,
			lineNumber: m.lineNumber,
			side: m.side,
			align: "center",
		});
		codeView?.setSelectedLines({
			id: m.fileId,
			range: { start: m.lineNumber, end: m.lineNumber, side: m.side },
		});
	},
	selectMatch: (m: SearchMatch) => {
		codeView?.setSelectedLines({
			id: m.fileId,
			range: { start: m.lineNumber, end: m.lineNumber, side: m.side },
		});
	},
	clearSelection: () => codeView?.clearSelectedLines(),
	ensureVisible: (m: SearchMatch) => {
		if (!codeView) return;
		if (!collapsedIds.has(m.fileId)) return;
		const item = codeView.getItem(m.fileId);
		if (item?.type !== "diff") return;
		collapsedIds.delete(m.fileId);
		autoExpandedIds.add(m.fileId);
		renderVersion += 1;
		codeView.updateItem({ ...item, collapsed: false, version: renderVersion });
	},
	setExpandAll: (on: boolean) => {
		if (on === expandAll) {
			if (!on) restoreAutoExpanded();
			return;
		}
		expandAll = on;
		codeView?.setOptions(codeViewOptions());
		codeView?.render();
		if (!on) restoreAutoExpanded();
	},
	reapplyHighlights: () => highlightAllVisible(),
});

// Toolbar search button: opens the find bar (same as Cmd/Ctrl+F) for discoverability.
document
	.getElementById("find-open")
	?.addEventListener("click", () => findBar?.open());

void load();

const WATCH_POLL_MS = 2000;
let watchTimer: ReturnType<typeof setInterval> | null = null;

const poll = async (): Promise<void> => {
	const result = await fetchDiff();
	if (result === null) return;
	updateBaseOption(result.base);
	const serialized = JSON.stringify(result.files);
	if (serialized === lastPatch) return;
	lastPatch = serialized;
	renderPatch(result.files);
};

const startWatch = (): void => {
	if (watchTimer !== null) return;
	watchTimer = setInterval(() => void poll(), WATCH_POLL_MS);
};

const stopWatch = (): void => {
	if (watchTimer !== null) {
		clearInterval(watchTimer);
		watchTimer = null;
	}
};

const watchInput = document.getElementById("toggle-watch") as HTMLInputElement;
watchInput?.addEventListener("change", () => {
	if (watchInput.checked) {
		localStorage.setItem(WATCH_KEY, "1");
		startWatch();
	} else {
		localStorage.setItem(WATCH_KEY, "0");
		stopWatch();
	}
});

// URL 플래그 또는 저장된 watch 상태 복원 (ON이면 폴링 시작). 세션 전용:
// localStorage에는 쓰지 않는다 (사용자가 토글해야 영속화됨).
if (
	watchInput &&
	resolveWatch(params.get("watch"), (k) => localStorage.getItem(k))
) {
	watchInput.checked = true;
	startWatch();
}

import {
	CodeView,
	DIFFS_HEADER_ATTR,
	DIFFS_TAG_NAME,
	DIFFS_TITLE_ATTR,
	type FileDiffMetadata,
	getOrCreateWorkerPoolSingleton,
	parseDiffFromFile,
	type SelectedLineRange,
	terminateWorkerPoolSingleton,
} from "@diffdeck/diffs";
import { comparePathsInTreeOrder } from "@diffdeck/path-store";
import {
	FileTree,
	type FileTreeDirectoryHandle,
	type FileTreeItemHandle,
} from "@diffdeck/trees";
import type { DiffFile } from "../server/diff.ts";
import type { PrsByBranch } from "../server/prs.ts";
import type { RefRecord, RefsResult, WorktreeRecord } from "../server/refs.ts";
import type { RepoSummary } from "../server/summary.ts";
import { changeTotalsView } from "./changeTotals.ts";
import { createCopyButton } from "./copyButton.ts";
import { movedBeyondThreshold } from "./drag.ts";
import {
	buildEmptyStateModel,
	renderEmptyState,
	shouldAutoViewBase,
} from "./emptyState.ts";
import {
	encodeGrab,
	type GrabFileStatus,
	grabLabelParts,
	plainSnippet,
} from "./grab/encode.ts";
import {
	createGrabHighlighter,
	GRAB_HIGHLIGHT_NAME,
	type GrabRow,
	type HighlightRegistryLike,
	rowsInRange,
} from "./grab/highlight.ts";
import { createGrabPopover, type GrabOpenOptions } from "./grab/popover.ts";
import { type AnchorRect, computePlacement } from "./grab/position.ts";
import { normalizeRange, type NormalizedRange } from "./grab/range.ts";
import {
	resolveSelectionRange,
	type SelectionLike,
} from "./grab/selectionAdapter.ts";
import { extractSnippet } from "./grab/snippet.ts";
import { resolveTextTarget, rowSide } from "./grab/textSelection.ts";
import { decodeHeaderValue } from "./headerValue.ts";
import { ensureImageCard, IMAGE_CARD_CSS } from "./imageCard.ts";
import { blobUrl, type ImageEntry, imageEntries } from "./imageDiff.ts";
import { countChangedLines, isLargeFile } from "./largeFile.ts";
import {
	buildLoadErrorModel,
	type LoadErrorActionKind,
	type LoadFailure,
	loadErrorKey,
	renderLoadError,
} from "./loadError.ts";
import { createParseCache } from "./parseCache.ts";
import {
	compareBaseKey,
	FLATTEN_KEY,
	FOLD_WITH_TREE_KEY,
	readTreeWidth,
	resolveCompareBase,
	resolveDiffStyle,
	resolveFlatten,
	resolveFoldWithTree,
	resolveTreeHidden,
	resolveTreeSide,
	resolveUntracked,
	resolveWatch,
	TREE_SIDE_KEY,
	TREE_WIDTH_KEY,
	type TreeSide,
	WATCH_KEY,
} from "./prefs.ts";
import {
	buildHeadRows,
	filterPickerRows,
	type HeadRow,
} from "./refPicker/model.ts";
import {
	chipMinWidth,
	prChipView,
	prFor,
	prIconSvg,
	viewedPrBranch,
} from "./prBadge.ts";
import { findWorktree, repoLabelView } from "./repoLabel.ts";
import { computeDragWidth, computeKeyboardWidth } from "./resize.ts";
import { createFindBar, type FindBar } from "./search/findBar.ts";
import { highlightDom } from "./search/highlightDom.ts";
import type { SearchFile, SearchMatch } from "./search/searchIndex.ts";

const params = new URLSearchParams(location.search);
const repo = params.get("repo") ?? "";
const token = params.get("token") ?? "";

const treeMount = document.getElementById("tree") as HTMLElement;
const diffMount = document.getElementById("diff") as HTMLElement;

let imageEntryById = new Map<string, ImageEntry>();
let imageUrlFor: Parameters<typeof ensureImageCard>[3] = () => "";

// Header click folds the file. composedPath() crosses the engine's shadow
// DOM; only [data-diffs-header] hits count, so hunk separators still work.
const DRAG_THRESHOLD = 6;
let pointerDown: { x: number; y: number } | null = null;

diffMount.addEventListener("pointerdown", (event) => {
	pointerDown = { x: event.clientX, y: event.clientY };
});

diffMount.addEventListener("click", (event) => {
	if (!codeView) return;
	// A drag (e.g. selecting the filename) must not fold the file.
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
	const nextCollapsed = !effectiveCollapsed(id);
	// Take the file back from the find bar's temporary expansion, or
	// restoreAutoExpanded would later override this manual choice.
	autoExpandedIds.delete(id);
	if (nextCollapsed) {
		collapsedIds.add(id);
		forceExpandedIds.delete(id);
	} else {
		collapsedIds.delete(id);
		if (foldWithTree && treeCollapsedIds.has(id)) forceExpandedIds.add(id);
	}
	codeView.updateItem({
		...item,
		collapsed: nextCollapsed,
		version: parseCache.bump(id),
	});
});

const statusEl = document.getElementById("status") as HTMLElement;
const pickerBtn = document.getElementById(
	"ref-picker-btn",
) as HTMLButtonElement;
const pickerPanel = document.getElementById("ref-picker") as HTMLElement;
const pickerSearch = document.getElementById(
	"ref-picker-search",
) as HTMLInputElement;
const pickerList = document.getElementById("ref-picker-list") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;

const changeAddEl = document.getElementById("change-add") as HTMLElement;
const changeDelEl = document.getElementById("change-del") as HTMLElement;

// renderPatch에서만 부른다 — 로딩·실패 중에는 화면에 남은 직전 diff의 값을 둔다.
const applyChangeTotals = (
	files: readonly {
		hunks: readonly { additionLines: number; deletionLines: number }[];
	}[],
): void => {
	const view = changeTotalsView(files);
	changeAddEl.textContent = view.additions;
	changeDelEl.textContent = view.deletions;
};

const pickerScopeEl = document.getElementById("picker-scope") as HTMLElement;
const pickerNameEl = document.getElementById("picker-name") as HTMLElement;
const pickerBranchEl = document.getElementById("picker-branch") as HTMLElement;
const prChipEl = document.getElementById("pr-chip") as HTMLAnchorElement;
const prChipIconEl = document.getElementById("pr-chip-icon") as HTMLElement;
const prChipNumberEl = document.getElementById("pr-chip-number") as HTMLElement;
const prChipTitleEl = document.getElementById("pr-chip-title") as HTMLElement;

let lastWorktrees: readonly WorktreeRecord[] = [];
let lastRepoRoot: string | null = null;
let lastRefs: readonly RefRecord[] = [];
let lastPrs: PrsByBranch = {};
// 같은 응답이면 다시 그리지 않는다 — watch 폴마다 열린 피커를 다시 세우면
// 누르는 중인 행 노드가 갈려 click이 사라진다.
let lastPrsRaw = "";

const applyPrChip = (): void => {
	const worktreeBranch = findWorktree(lastWorktrees, repo)?.branch ?? null;
	const view = prChipView(
		prFor(lastPrs, viewedPrBranch(currentHead, worktreeBranch, lastRefs)),
	);
	prChipEl.hidden = view === null;
	if (view === null) return;
	prChipEl.href = view.href;
	prChipEl.title = view.tooltip;
	prChipEl.setAttribute("aria-label", view.ariaLabel);
	// 열거값에서 만든 상수 마크업이라 innerHTML이 안전하다.
	prChipIconEl.innerHTML = prIconSvg(view.state, 14);
	prChipNumberEl.textContent = view.number;
	prChipTitleEl.textContent = view.title;
	// 칩이 줄어드는 바닥(아이콘 + 번호)을 건다. 둘은 `flex: none`이라 칩이 눌려
	// 있어도 지금 폭이 곧 자연폭이다(viewer-toolbar.md).
	const cs = getComputedStyle(prChipEl);
	prChipEl.style.minWidth = `${chipMinWidth({
		icon: prChipIconEl.getBoundingClientRect().width,
		number: prChipNumberEl.getBoundingClientRect().width,
		gap: Number.parseFloat(cs.columnGap) || 0,
		padding:
			Number.parseFloat(cs.paddingLeft) + Number.parseFloat(cs.paddingRight),
		border:
			Number.parseFloat(cs.borderLeftWidth) +
			Number.parseFloat(cs.borderRightWidth),
	})}px`;
};

const applyRepoLabel = (
	worktrees?: readonly WorktreeRecord[],
	repoRoot?: string | null,
): void => {
	if (worktrees) {
		lastWorktrees = worktrees;
		lastRepoRoot = repoRoot ?? null;
	}
	const view = repoLabelView(repo, lastWorktrees, lastRepoRoot, {
		head: currentHead,
	});
	pickerScopeEl.textContent = view.scope;
	pickerNameEl.textContent = view.name;
	pickerBranchEl.textContent = view.branch;
	pickerBtn?.setAttribute("title", view.title);
	document.title = view.documentTitle;
	applyPrChip();
};

// 웹폰트(`font-display: swap`)가 측정 뒤에 오면 칩의 바닥 폭이 틀어지므로
// 다시 잰다(fonts.md).
document.fonts.addEventListener("loadingdone", () => applyPrChip());

// refs와 따로 받는다 — `gh`는 네트워크를 타서 느려 라벨·목록을 그 속도에
// 묶으면 안 된다(viewer-toolbar.md).
const refreshPrs = async (): Promise<void> => {
	try {
		const res = await fetch(
			`/api/prs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		if (!res.ok) return;
		const raw = await res.text();
		if (raw === lastPrsRaw) return;
		lastPrsRaw = raw;
		lastPrs = JSON.parse(raw) as PrsByBranch;
		applyPrChip();
		rebuildPickerRows();
	} catch {
		// 부가 정보다 — 못 받으면 PR 표시만 빠진다.
	}
};

// load()와 watch의 poll()이 부른다(피커 열림은 loadPickerRows가 맡는다).
// watch 중엔 focus가 없어서 poll()에서 빠지면 툴바가 옛 브랜치에 굳는다.
const refreshRepoLabel = async (): Promise<void> => {
	void refreshPrs();
	try {
		const res = await fetch(
			`/api/refs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		if (!res.ok) return;
		const body = (await res.json()) as RefsResult;
		lastRefs = body.refs;
		applyRepoLabel(body.worktrees, body.repoRoot);
	} catch {
		// 부가 정보다 — 못 받아도 이름은 이미 떠 있고 diff는 그대로 동작한다.
	}
};

let diffStyle: "unified" | "split" = resolveDiffStyle(params.get("style"));
let includeUntracked = resolveUntracked(params.get("untracked"));
// 견줄 기준: "HEAD"는 미커밋 변경만, "@auto"는 서버가 해석한 base, 그 밖은
// 그 참조 자체다.
let compareBase = "HEAD";
// head로 고른 ref(null이면 워킹트리). 저장하지 않는다 — URL이 진실이다.
let currentHead: string | null = params.get("head") || null;
const diffModeOf = (base: string): "working" | "base" =>
	base === "HEAD" ? "working" : "base";
const effectiveBaseName = (): string =>
	compareBase === "HEAD" || compareBase === "@auto" ? diffBase : compareBase;
let flattenDirs = resolveFlatten(params.get("flatten"), (k) =>
	localStorage.getItem(k),
);
let treeSide: TreeSide = resolveTreeSide(params.get("tree"), (k) =>
	localStorage.getItem(k),
);
let treeHidden: boolean = resolveTreeHidden(params.get("sidebar"));
let foldWithTree: boolean = resolveFoldWithTree(params.get("foldtree"), (k) =>
	localStorage.getItem(k),
);
let treeWidth: number = readTreeWidth((k) => localStorage.getItem(k));
let codeView: CodeView | null = null;
let fileTree: FileTree | null = null;

// 워커 스크립트 로드 실패는 엔진이 감지하지 못하고(diff가 영구히 빈다)
// 생성부의 try/catch로도 잡히지 않는다 — 이 워치독이 워커 없이 다시 그린다.
// 'error'는 워커 안의 미처리 예외에도 오지만 동기 경로로의 강등이라 안전하다.
let workerLoadRecovered = false;

const recoverFromWorkerLoadFailure = (): void => {
	if (workerLoadRecovered) return;
	workerLoadRecovered = true;
	terminateWorkerPoolSingleton();
	workerManager = undefined;
	codeView?.cleanUp();
	codeView = null;
	if (lastFiles) renderPatch(lastFiles);
};

let workerManager = (() => {
	try {
		return getOrCreateWorkerPoolSingleton({
			poolOptions: {
				workerFactory: () => {
					const worker = new Worker(new URL("worker.js", import.meta.url), {
						type: "module",
					});
					worker.addEventListener("error", recoverFromWorkerLoadFailure);
					return worker;
				},
				// 처리량이 아니라 스파이크 제거가 목적이다 — 워커마다 shiki 문법
				// 메모리가 중복된다.
				poolSize: 2,
			},
			// 렌더 옵션 5필드(theme 등)는 CodeView가 아니라 여기에 넣어야 워커
			// 경로에 적용된다(viewer.md).
			highlighterOptions: {},
		});
	} catch {
		return undefined;
	}
})();

let lastEtag: string | null = null;
let lastFiles: DiffFile[] | null = null;
let lastTreeKey: string | null = null;
let renderedDiffStyle: "unified" | "split" | null = null;

const parseCache = createParseCache<FileDiffMetadata>();

const collapsedIds = new Set<string>();
// 사이드바에서 조상 디렉토리가 접혀 함께 접히는 파일(syncTreeFold가 채운다).
const treeCollapsedIds = new Set<string>();
// 접힘 근거를 무시하고 펼쳐 둔 파일. 두 용도를 겸한다: 트리 때문에 접힌
// 파일을 사용자가 직접 펼친 경우(다시 접을 때까지), find가 매치를 보이려고
// 임시로 펼친 경우(autoExpandedIds에도 기록되고 검색이 끝나면 걷힌다).
const forceExpandedIds = new Set<string>();
const effectiveCollapsed = (id: string): boolean =>
	!forceExpandedIds.has(id) &&
	(collapsedIds.has(id) || (foldWithTree && treeCollapsedIds.has(id)));
const seenIds = new Set<string>();

let searchFiles: SearchFile[] = [];
let findBar: FindBar | null = null;

// One persistent button per file: a fresh SVG is born at its final angle, so
// only a reused node can animate the chevron rotation.
const foldButtons = new Map<string, HTMLButtonElement>();

const makeFoldButton = (id: string): HTMLButtonElement => {
	const collapsed = effectiveCollapsed(id);
	let btn = foldButtons.get(id);
	if (!btn) {
		btn = document.createElement("button");
		btn.type = "button";
		btn.dataset.fold = id;
		btn.style.cssText =
			"background:transparent;border:0;color:#84848a;cursor:pointer;display:inline-flex;align-items:center;padding:0 6px 0 0;line-height:1";
		// The engine's icon sprite lives in its shadow DOM, out of reach of this
		// light-DOM slotted button, so the caret is inlined.
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

const ensureCopyButton = (container: HTMLElement): void => {
	const fileId = containerFileId(container);
	if (!fileId) return;
	const root = container.shadowRoot ?? container;
	if (root.querySelector("[data-copy-name]")) return;
	const title = root.querySelector(`[${DIFFS_TITLE_ATTR}]`);
	if (!title) return;
	title.after(createCopyButton(fileId));
};

// 말줄임된 파일명의 전체 경로를 title로 보인다. "이미 있으면 건너뛰기"를
// 두지 않는다 — recycle이 노드를 재사용하며 textContent만 바꾸면 title이 낡는다.
const PREV_NAME_ATTR = "data-prev-name";
const syncTitleTooltip = (root: Element | ShadowRoot, attr: string): void => {
	const el = root.querySelector<HTMLElement>(`[${attr}]`);
	const text = el?.textContent;
	if (el && text && el.title !== text) el.title = text;
};
const ensureTitleTooltips = (container: HTMLElement): void => {
	const root = container.shadowRoot ?? container;
	syncTitleTooltip(root, DIFFS_TITLE_ATTR);
	syncTitleTooltip(root, PREV_NAME_ATTR);
};

const syncImageCard = (container: HTMLElement): void => {
	const fileId = containerFileId(container);
	if (!fileId) return;
	ensureImageCard(
		container,
		imageEntryById.get(fileId),
		effectiveCollapsed(fileId),
		imageUrlFor,
	);
};

let expandAll = false; // find bar 활성 중 전역 미변경 context 펼침
const autoExpandedIds = new Set<string>();

// CSS 박스의 바깥 크기(패딩·테두리 포함)이고 높이는 입력창이 최대로 자란
// 상태다. 배치는 open() 때 한 번만 계산되므로 작게 적으면 화면 끝에서
// 잘린다 — CSS 값에 맞춰 "정리"하지 않는다(grab.md).
const POPOVER_SIZE = { width: 358, height: 211 };
const viewport = (): { width: number; height: number } => ({
	width: window.innerWidth,
	height: window.innerHeight,
});

// 거터 "+" 경로로 연 팝오버만 엔진 selectedLines를 소유한다. 그 슬롯은 find
// 매치 하이라이트도 쓰므로 소유했을 때만 해제한다(grab.md).
let grabOwnsLineSelection = false;

const clearOwnedSelection = (): void => {
	if (!grabOwnsLineSelection) return;
	grabOwnsLineSelection = false;
	codeView?.clearSelectedLines();
};

// 팝오버 입력이 포커스를 가져가면 네이티브 선택이 사라지므로 텍스트 경로가
// 잡은 범위는 이 채널(CSS Highlight)로 다시 칠한다. 엔진 슬롯과는 독립이다.
const grabHighlighter = createGrabHighlighter({
	registry:
		(CSS as unknown as { highlights?: HighlightRegistryLike }).highlights ??
		null,
	createHighlight: (ranges) => {
		const Ctor = (
			window as unknown as { Highlight: new (...r: Range[]) => unknown }
		).Highlight;
		return new Ctor(...(ranges as unknown as Range[]));
	},
	createRange: () => document.createRange(),
});

let grabTextTarget: { fileId: string; range: NormalizedRange } | null = null;

const paintGrabHighlight = (): void => {
	const target = grabTextTarget;
	if (!target) return;
	for (const container of diffMount.querySelectorAll<HTMLElement>(
		DIFFS_TAG_NAME,
	)) {
		if (containerFileId(container) !== target.fileId) continue;
		const root = container.shadowRoot ?? container;
		const rows: GrabRow[] = [...root.querySelectorAll("[data-line]")].map(
			(el) => {
				const alt = el.getAttribute("data-alt-line");
				return {
					el,
					side: rowSide(el, diffStyle),
					line: Number(el.getAttribute("data-line")),
					altLine: alt === null ? null : Number(alt),
				};
			},
		);
		grabHighlighter.paint(rowsInRange(rows, target.range, diffStyle));
		return;
	}
	// 렌더 윈도우 밖이면 지운다 — 되돌아오면 onPostRender가 다시 칠한다.
	grabHighlighter.clear();
};

const grabPopover = createGrabPopover({
	doc: document,
	writeText: (text) => {
		const clip = navigator.clipboard;
		if (!clip?.writeText)
			return Promise.reject(new Error("clipboard API unavailable"));
		return clip.writeText(text);
	},
	onCopied: clearOwnedSelection,
	onClosed: () => {
		clearOwnedSelection();
		grabTextTarget = null;
		grabHighlighter.clear();
	},
});
document.body.append(grabPopover.element);

const statusOf = (fileId: string): GrabFileStatus =>
	lastFiles?.find((f) => f.name === fileId)?.status ?? "modified";

const buildGrabSnapshot = (
	fileId: string,
	range: NormalizedRange,
): Omit<GrabOpenOptions, "placement"> | null => {
	const item = codeView?.getItem(fileId);
	if (item?.type !== "diff") return null;
	const snippet = extractSnippet(item.fileDiff, range);
	if (!snippet) return null;
	const input = {
		path: fileId,
		prevPath: item.fileDiff.prevName,
		status: statusOf(fileId),
		mode: diffModeOf(compareBase),
		baseName: effectiveBaseName(),
		...(currentHead ? { head: currentHead } : {}),
		snippet,
	};
	return {
		label: grabLabelParts(fileId, snippet),
		labelTitle: fileId,
		buildOutput: (prompt) => encodeGrab({ ...input, prompt }),
		buildPlainOutput: () => plainSnippet(snippet),
	};
};

const selectedRowRect = (fileId: string): DOMRect | null => {
	for (const container of diffMount.querySelectorAll<HTMLElement>(
		DIFFS_TAG_NAME,
	)) {
		if (containerFileId(container) !== fileId) continue;
		const root = container.shadowRoot ?? container;
		const row =
			root.querySelector('[data-line][data-selected-line="last"]') ??
			root.querySelector('[data-line][data-selected-line="single"]') ??
			root.querySelector("[data-line][data-selected-line]");
		return (row ?? container).getBoundingClientRect();
	}
	return null;
};

const openGrabPopover = (
	snap: Omit<GrabOpenOptions, "placement">,
	rect: AnchorRect | null,
): void => {
	const anchor = rect ?? diffMount.getBoundingClientRect();
	grabPopover.open({
		...snap,
		placement: computePlacement(anchor, POPOVER_SIZE, viewport()),
	});
};

// 선택은 한 틱 뒤에 읽어 스냅샷으로 굳힌다 — 이후 DOM 교체·recycle이 선택을
// 죽여도 안전하다. 바깥 dismiss는 pointerdown/mousedown에만 걸려 있어 같은
// 제스처의 pointerup/click에서 열어도 곧바로 닫히지 않는다.
const openGrabFromTextSelection = (at: { x: number; y: number }): void => {
	setTimeout(() => {
		const roots = [...diffMount.querySelectorAll<HTMLElement>(DIFFS_TAG_NAME)]
			.map((c) => c.shadowRoot)
			.filter((r): r is ShadowRoot => r !== null);
		const resolved = resolveSelectionRange(
			document.getSelection() as unknown as SelectionLike | null,
			roots,
		);
		const target = resolved ? resolveTextTarget(resolved, diffStyle) : null;
		const snap = target ? buildGrabSnapshot(target.fileId, target.range) : null;
		if (!target || !snap) return;
		grabTextTarget = { fileId: target.fileId, range: target.range };
		paintGrabHighlight();
		openGrabPopover(snap, { left: at.x, top: at.y, bottom: at.y });
	}, 0);
};

diffMount.addEventListener("pointerup", (event) => {
	// 실제 드래그만 받는다. 움직이지 않은 멀티클릭은 아래 click 핸들러가 받는다.
	const upPoint = { x: event.clientX, y: event.clientY };
	if (
		!pointerDown ||
		!movedBeyondThreshold(pointerDown, upPoint, DRAG_THRESHOLD)
	) {
		return;
	}
	openGrabFromTextSelection(upPoint);
});

// 더블·트리플클릭은 움직이지 않아 드래그 게이트를 못 지난다. 클릭 횟수는
// click의 detail로만 읽힌다(Chrome의 pointer 이벤트는 detail이 늘 0이다).
// dblclick으로 바꾸면 트리플클릭의 줄 선택을 놓친다(grab.md).
diffMount.addEventListener("click", (event) => {
	if (event.detail < 2) return;
	openGrabFromTextSelection({ x: event.clientX, y: event.clientY });
});

const codeViewOptions = (): ConstructorParameters<
	typeof CodeView<undefined>
>[0] => ({
	diffStyle,
	themeType: "dark",
	stickyHeaders: true,
	hunkSeparators: "line-info",
	expansionLineCount: 10,
	collapsedContextThreshold: 3,
	// 엔진 기본값(100k줄)보다 낮춘 하이라이트 상한(넘으면 plain text) —
	// 하이라이트는 범위와 무관하게 파일 전체를 토크나이즈한다.
	// lockfile-freeze.e2e.ts의 픽스처들이 이 값의 아래·위에 맞춰져 있다.
	tokenizeMaxLength: 20_000,
	expandUnchanged: expandAll,
	// renderGutterUtility는 onGutterUtilityClick과 함께 쓰면 엔진이 throw한다.
	enableLineSelection: true,
	// 라인넘버 드래그만 끈다 — 드래그는 텍스트 grab의 제스처다. 클릭 선택과
	// shift+클릭 확장은 남는다(vendored-packages.md 예외 5).
	enableLineSelectionDrag: false,
	enableGutterUtility: true,
	onGutterUtilityClick: (range: SelectedLineRange, context) => {
		const snap = buildGrabSnapshot(context.item.id, normalizeRange(range));
		if (!snap) return;
		// 거터 경로는 엔진이 칠하므로 남은 텍스트 하이라이트를 지운다.
		grabTextTarget = null;
		grabHighlighter.clear();
		grabOwnsLineSelection = true;
		openGrabPopover(snap, selectedRowRect(context.item.id));
	},
	renderHeaderPrefix: (fileDiff) => makeFoldButton(fileDiff.name),
	onPostRender: (node: HTMLElement, _instance: unknown, phase: string) => {
		if (phase === "unmount") return;
		const container =
			(node.closest?.(DIFFS_TAG_NAME) as HTMLElement | null) ?? node;
		highlightContainer(container);
		ensureCopyButton(container);
		ensureTitleTooltips(container);
		syncImageCard(container);
		// 워커 하이라이트의 DOM 교체·recycle이 Range를 죽이므로 다시 칠한다.
		if (grabPopover.isOpen()) paintGrabHighlight();
	},
	unsafeCSS:
		// The header is sticky and code scrolls under it, so the hover tint is
		// mixed into the opaque --diffs-bg instead of a translucent overlay.
		`[${DIFFS_HEADER_ATTR}]{cursor:pointer;transition:background-color .15s}[${DIFFS_HEADER_ATTR}]:hover{background-color:color-mix(in srgb,var(--diffs-mixer) 5%,var(--diffs-bg))}` +
		`::highlight(${GRAB_HIGHLIGHT_NAME}){background-color:rgba(91,141,239,0.32)}` +
		"mark.cc-find-hit{background:#e3b341;color:#000;border-radius:2px}" +
		"mark.cc-find-hit--active{background:#f0883e;color:#000}" +
		"[data-copy-name]{opacity:0;transition:opacity .15s;background:transparent;border:0;color:#84848a;cursor:pointer;display:inline-flex;align-items:center;padding:0 4px;margin-left:2px;line-height:1}" +
		`[${DIFFS_HEADER_ATTR}]:hover [data-copy-name]{opacity:1}[data-copy-name]:hover{color:#adadb1}[data-copy-name]:focus-visible{opacity:1}${IMAGE_CARD_CSS}`,
});

const restoreAutoExpanded = (): void => {
	if (!codeView || autoExpandedIds.size === 0) return;
	for (const id of autoExpandedIds) {
		forceExpandedIds.delete(id);
		const item = codeView.getItem(id);
		if (item?.type !== "diff") continue;
		// Re-evaluate: the real collapse reason (manual, tree, none) may have
		// changed while the find bar was open.
		const collapsed = effectiveCollapsed(id);
		codeView.updateItem({ ...item, collapsed, version: parseCache.bump(id) });
	}
	autoExpandedIds.clear();
};

const isDirHandle = (
	item: FileTreeItemHandle,
): item is FileTreeDirectoryHandle => item.isDirectory();

const buildDirDescendants = (
	paths: readonly string[],
): Map<string, string[]> => {
	const map = new Map<string, string[]>();
	for (const path of paths) {
		const segments = path.split("/");
		let dir = "";
		for (let i = 0; i < segments.length - 1; i++) {
			dir = i === 0 ? segments[0] : `${dir}/${segments[i]}`;
			const list = map.get(dir);
			if (list) list.push(path);
			else map.set(dir, [path]);
		}
	}
	return map;
};

let knownDirDescendants: Map<string, string[]> = new Map();

// fileTree.resetPaths()는 모든 디렉토리를 다시 펼친다. 갱신 전에 접힌
// 디렉토리를 잡아 두었다가 되접는다 — Fold with tree와 무관하게 늘 필요하다.
const captureCollapsedDirPaths = (
	dirPaths: Iterable<string>,
): readonly string[] => {
	if (!fileTree) return [];
	const collapsed: string[] = [];
	for (const dir of dirPaths) {
		const item = fileTree.getItem(dir);
		if (item && isDirHandle(item) && !item.isExpanded()) collapsed.push(dir);
	}
	return collapsed;
};

const reapplyCollapsedDirs = (dirPaths: readonly string[]): void => {
	if (!fileTree) return;
	for (const dir of dirPaths) {
		const item = fileTree.getItem(dir);
		if (item && isDirHandle(item)) item.collapse();
	}
};

// fileTree.subscribe()는 페이로드 없이 모든 트리 변경(선택·포커스 포함)에
// 발화하므로 접힘이 실제로 바뀐 파일만 updateItem한다.
const syncTreeFold = (): void => {
	if (!codeView) return;
	const nextTreeCollapsed = new Set<string>();
	if (foldWithTree && fileTree) {
		for (const [dirPath, files] of knownDirDescendants) {
			const item = fileTree.getItem(dirPath);
			if (item && isDirHandle(item) && !item.isExpanded()) {
				for (const f of files) nextTreeCollapsed.add(f);
			}
		}
	}
	for (const id of new Set([...treeCollapsedIds, ...nextTreeCollapsed])) {
		if (treeCollapsedIds.has(id) === nextTreeCollapsed.has(id)) continue;
		if (forceExpandedIds.has(id) || collapsedIds.has(id)) continue; // 화면상 접힘 상태 자체는 안 바뀜
		const item = codeView.getItem(id);
		if (item?.type !== "diff") continue;
		codeView.updateItem({
			...item,
			collapsed: nextTreeCollapsed.has(id),
			version: parseCache.bump(id),
		});
	}
	treeCollapsedIds.clear();
	for (const id of nextTreeCollapsed) treeCollapsedIds.add(id);
};

const fetchSummary = async (): Promise<RepoSummary | null> => {
	try {
		const query = new URLSearchParams({ repo, token, base: compareBase });
		if (currentHead) query.set("head", currentHead);
		const res = await fetch(`/api/summary?${query.toString()}`);
		if (!res.ok) return null;
		return (await res.json()) as RepoSummary;
	} catch {
		return null;
	}
};

// 첫 로드와 빈 상태 해석 중이 같은 마크업을 쓴다 — 다르면 로딩에서 로딩으로
// 넘어가는 자리에서 한 번 깜박인다.
const LOADING_MARKUP =
	'<div id="empty" data-loading><span class="loading-spinner"></span>Loading diff…</div>';

// 일부러 둔 가드: 전환 뒤엔 mode가 base라 조건이 거짓이 되지만, 자동 전환이
// 한 번뿐임을 여기서 바로 읽히게 한다.
let autoBaseTried = false;

// 호출 시점에 다시 읽는다 — 초기화 때 캐시하면 사용자가 base를 고른 뒤에도
// 자동 전환이 그 선택을 덮는다.
const hasExplicitBase = (): boolean =>
	resolveCompareBase(urlChoice, (k) => localStorage.getItem(k), repo) !== null;

const enrichEmptyState = async (): Promise<void> => {
	const marker = diffMount.querySelector("#empty");
	if (!marker) return;
	// 요청 시점의 선택을 굳혀 두고 응답이 왔을 때 바뀌었으면 버린다. head도
	// 넣는다 — base가 이미 `@auto`면 브랜치를 갈아타도 mode는 그대로다.
	const mode = compareBase;
	const untrackedShown = includeUntracked;
	const head = currentHead;
	const summary = await fetchSummary();
	// 폴백 문구. 노드는 그대로 둔다 — 이후 marker 가드가 이 노드와 견준다.
	if (!summary) {
		if (diffMount.querySelector("#empty") === marker) {
			marker.removeAttribute("data-loading");
			// 304 복구 경로에서는 marker가 실패 카드일 수 있어 카드 흔적도 걷는다.
			marker.removeAttribute("data-load-error");
			marker.removeAttribute("role");
			marker.className = "";
			marker.textContent = "No changes.";
		}
		return;
	}
	if (diffMount.querySelector("#empty") !== marker) return;
	if (
		mode !== compareBase ||
		untrackedShown !== includeUntracked ||
		head !== currentHead
	) {
		return;
	}
	const model = buildEmptyStateModel(summary, {
		mode: diffModeOf(mode),
		untrackedShown,
	});
	// 저장하지 않는다 — 추론을 저장하면 hasExplicitBase()가 이후 자동 전환을
	// 영구히 막는다(viewer.md).
	if (
		shouldAutoViewBase(model, {
			hasExplicitBase: hasExplicitBase(),
			alreadyTried: autoBaseTried,
		})
	) {
		autoBaseTried = true;
		void selectBase("@auto", { persist: false });
		return;
	}
	const card = renderEmptyState(document, model, {
		onSwitchMode: () => void applySelection("@auto"),
		onShowUntracked: () => {
			if (!untrackedInput) return;
			untrackedInput.checked = true;
			untrackedInput.dispatchEvent(new Event("change"));
		},
	});
	marker.replaceWith(card);
};

const renderPatch = (unsorted: DiffFile[]): void => {
	grabPopover.close();
	const files = unsorted.toSorted((a, b) =>
		comparePathsInTreeOrder(a.name, b.name),
	);
	if (files.length === 0) {
		teardownViews();
		parseCache.prune([]);
		diffMount.replaceChildren();
		// 문구는 /api/summary가 온 뒤 enrichEmptyState가 한 번만 쓴다. 먼저
		// "No changes."를 쓰면 곧 말을 바꾸게 된다(viewer.md).
		diffMount.innerHTML = LOADING_MARKUP;
		statusEl.textContent = "";
		applyChangeTotals([]);
		void enrichEmptyState();
		return;
	}
	statusEl.textContent = `${files.length} file(s)`;

	// 이미지는 빈 diff 아이템(헤더만)으로 넣고 onPostRender가 카드를 주입한다.
	imageEntryById = new Map(imageEntries(files).map((e) => [e.name, e]));
	imageUrlFor = (path, side, version) =>
		blobUrl({
			repo,
			token,
			path,
			side,
			mode: diffModeOf(compareBase),
			base: compareBase,
			...(currentHead ? { head: currentHead } : {}),
			version,
		});

	const paths = files.map((f) => f.name);
	const gitStatus = files.map((f) => ({ path: f.name, status: f.status }));

	knownDirDescendants = buildDirDescendants(paths);
	const collapsedDirPaths = captureCollapsedDirPaths(
		knownDirDescendants.keys(),
	);

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
		fileTree.subscribe(() => syncTreeFold());
		reapplyCollapsedDirs(collapsedDirPaths);
		lastTreeKey = treeKey;
	} else if (treeKey !== lastTreeKey) {
		fileTree.resetPaths(paths);
		fileTree.setGitStatus(gitStatus);
		reapplyCollapsedDirs(collapsedDirPaths);
		lastTreeKey = treeKey;
	}
	// 아래 items가 effectiveCollapsed로 이 결과를 읽으므로 그 전에 부른다.
	syncTreeFold();

	// 파일 전량으로 파싱해야(non-partial) 접힌 context를 펼칠 수 있다.
	// contentVersion이 같으면 parseCache가 결과와 version을 돌려줘 바뀐 파일만
	// dirty가 된다.
	const items = files
		.filter((f) => !f.binary || imageEntryById.has(f.name))
		.map((f) => {
			const isImage = imageEntryById.has(f.name);
			const { value: fileDiff, version } = parseCache.resolve(
				f.name,
				f.contentVersion,
				() =>
					parseDiffFromFile(
						{
							name: f.oldName ?? f.name,
							contents: isImage ? "" : f.oldContents,
						},
						{ name: f.name, contents: isImage ? "" : f.newContents },
					),
			);
			// parseDiffFromFile은 비-ASCII 경로를 git식 8진 이스케이프로 인용된 채
			// 되읽는다("src/\355\225\234…"). 헤더·fold id·copy-path가 이 필드를
			// 읽으므로 서버가 준 이름으로 덮는다.
			fileDiff.name = f.name;
			if (f.oldName) fileDiff.prevName = f.oldName;
			// 변경량은 hunk의 숫자 필드로 센다 — fileDiff.additionLines는 파일 전체
			// 내용이다(viewer.md).
			if (!seenIds.has(f.name)) {
				seenIds.add(f.name);
				const changedLines = countChangedLines(fileDiff.hunks);
				if (isLargeFile(f.name, changedLines)) collapsedIds.add(f.name);
			}
			return {
				id: f.name,
				type: "diff" as const,
				fileDiff,
				version,
				collapsed: effectiveCollapsed(f.name),
			};
		});
	parseCache.prune(items.map((it) => it.id));
	applyChangeTotals(items.map((it) => it.fileDiff));

	searchFiles = items.map((it) => ({ fileId: it.id, fileDiff: it.fileDiff }));
	findBar?.setData();

	// Create a CodeView only when there is none: recreating empties #diff (the
	// scroll container) and loses the scroll position (viewer.md).
	if (!codeView) {
		// The mount may still hold the loading/empty/failure placeholder.
		diffMount.replaceChildren();
		codeView = new CodeView(codeViewOptions(), workerManager);
		// Render 1000px past the viewport (CodeView's default is 200px): rendering
		// trails scrolling by one rAF, so the buffer must cover one frame of a fast
		// fling. Set only here — setOptions never touches config (viewer.md).
		codeView.config.overscrollSize = 1000;
		codeView.setup(diffMount);
		codeView.setItems(items);
		codeView.render();
		renderedDiffStyle = diffStyle;
		// The virtualizer fills the viewport only after the container is
		// measured, so re-render on the next two frames.
		const cv = codeView;
		requestAnimationFrame(() => {
			if (cv !== codeView) return;
			cv.render();
			requestAnimationFrame(() => {
				if (cv === codeView) cv.render();
			});
		});
	} else if (renderedDiffStyle !== diffStyle) {
		// Unified↔Split reuses the instance so the engine's semantic anchor
		// holds the viewport. Keep setOptions BEFORE setItems: the anchor must
		// see the pre-transition layout, and no test reliably catches a swap.
		codeView.setOptions(codeViewOptions());
		codeView.setItems(items);
		codeView.render();
		renderedDiffStyle = diffStyle;
	} else {
		// Refresh / --watch: the engine re-anchors semantically. Do NOT add a
		// pixel scrollTo — it creeps by the sticky header height on every update
		// and can clobber the style toggle's anchor (viewer.md).
		codeView.setItems(items);
		codeView.render();
	}
};

type FetchDiffResult =
	| { kind: "data"; files: DiffFile[]; base: string; etag: string | null }
	| { kind: "unchanged"; base: string };

type FetchDiffAttempt =
	| FetchDiffResult
	| { kind: "terminal"; failure: LoadFailure & { kind: "http" } }
	| { kind: "retryable"; failure: LoadFailure };

const fetchDiffOnce = async (): Promise<FetchDiffAttempt> => {
	const query = new URLSearchParams({
		repo,
		token,
		untracked: includeUntracked ? "1" : "0",
		base: compareBase,
	});
	if (currentHead) query.set("head", currentHead);
	try {
		const res = await fetch(`/api/diff?${query.toString()}`, {
			headers: lastEtag ? { "if-none-match": lastEtag } : {},
		});
		const base = decodeHeaderValue(res.headers.get("x-diff-base"));
		if (res.status === 304) return { kind: "unchanged", base };
		if (res.status === 503) {
			return { kind: "retryable", failure: { kind: "busy" } };
		}
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			return {
				kind: "terminal",
				failure: {
					kind: "http",
					status: res.status,
					marker: res.headers.get("x-diff-error"),
					body,
				},
			};
		}
		const files = (await res.json()) as DiffFile[];
		return { kind: "data", files, base, etag: res.headers.get("etag") };
	} catch (err) {
		console.error(err);
		return { kind: "retryable", failure: { kind: "network" } };
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// 재시도는 한 번, 지연은 서버의 Retry-After와 같은 값이다. 늘리면 겹친
// 시도만큼 git 프로세스가 늘어 다음 시도가 더 느려진다(server.md).
const RETRY_DELAYS_MS = [1000] as const;

// 저장된 base가 사라졌으면(unknown-base 400) 저장값만 한 번 지우고
// 워킹트리로 되돌린다. URL에 명시된 base는 건드리지 않는다(viewer.md).
let staleBaseRecovered = false;
const recoverFromStaleBase = (unknownBase: boolean): boolean => {
	// 서버 표식으로만 발동한다 — 다른 400에서 돌면 저장값만 조용히 사라진다.
	if (!unknownBase) return false;
	if (staleBaseRecovered || !compareBaseFromStorage) return false;
	if (compareBase === "HEAD") return false;
	staleBaseRecovered = true;
	localStorage.removeItem(compareBaseKey(repo));
	compareBase = "HEAD";
	applyRepoLabel();
	lastEtag = null;
	return true;
};

// 실패도 값으로 돌려준다 — 모듈 변수로 흘리면 load()와 poll()이 서로의
// 결과를 덮는다.
type FetchDiffOutcome =
	| FetchDiffResult
	| { kind: "failed"; failure: LoadFailure };

const fetchDiff = async (): Promise<FetchDiffOutcome> => {
	for (let attempt = 0; ; attempt++) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await fetchDiffOnce();
		if (result.kind === "data" || result.kind === "unchanged") return result;
		if (result.kind === "terminal") {
			// 복구 뒤의 재요청도 503 재시도 1회를 온전히 가진다(server.md).
			if (recoverFromStaleBase(result.failure.marker === "unknown-base")) {
				attempt--;
				continue;
			}
			// 사라진 head는 링크가 요청한 것이라 자가복구하지 않는다 — 카드가 이유와
			// 나갈 길을 준다(viewer.md).
			return { kind: "failed", failure: result.failure };
		}
		if (attempt >= RETRY_DELAYS_MS.length) {
			return { kind: "failed", failure: result.failure };
		}
		// oxlint-disable-next-line no-await-in-loop
		await sleep(RETRY_DELAYS_MS[attempt]);
	}
};

let diffBase = "";
const applyFetched = (result: FetchDiffResult): void => {
	diffBase = result.base;
	if (result.kind === "unchanged") {
		statusEl.textContent =
			lastFiles && lastFiles.length > 0 ? `${lastFiles.length} file(s)` : "";
		// 빈 상태 카드의 개수(untracked·base 쪽)는 diff 지문 밖이라 304여도
		// 요약을 다시 받는다.
		if (lastFiles && lastFiles.length === 0) void enrichEmptyState();
		return;
	}
	lastEtag = result.etag;
	lastFiles = result.files;
	renderPatch(result.files);
};

const onLoadErrorAction = (kind: LoadErrorActionKind): void => {
	if (kind === "retry") {
		// 카드가 떠 있으면 살아 있는 CodeView가 없으므로 덮어써도 안전하다.
		diffMount.innerHTML = LOADING_MARKUP;
		void load();
		return;
	}
	const next = new URL(location.href);
	if (kind === "view-working-tree") {
		next.searchParams.delete("head");
	} else {
		// 레거시 `mode`도 같은 축이라 함께 걷는다.
		next.searchParams.delete("base");
		next.searchParams.delete("mode");
	}
	location.href = next.toString();
};

// load()와 watch의 poll()이 함께 부른다 — watch 중엔 focus가 없어서
// poll()이 실패를 삼키면 옛 화면이 무기한 남는다.
const showLoadFailure = (failure: LoadFailure): void => {
	const model = buildLoadErrorModel(failure, {
		repo,
		head: currentHead,
		base: compareBase,
	});
	// 카드는 살아 있는 CodeView가 없을 때만 그린다 — #diff가 엔진의 스크롤
	// 컨테이너라 덮어쓰면 패널이 영구히 빈다(viewer.md). `!lastFiles`로 가르지
	// 않는다: 빈 리포의 `[]`는 truthy라 카드가 억제된다.
	if (!codeView) {
		// 같은 실패면 다시 그리지 않는다 — 폴마다 갈면 버튼의 포커스가 날아간다.
		const shown = diffMount.querySelector("#empty[data-load-error]");
		if (shown?.getAttribute("data-load-error") !== loadErrorKey(model)) {
			diffMount.replaceChildren(
				renderLoadError(document, model, onLoadErrorAction),
			);
		}
	}
	// diff가 떠 있어 카드를 못 그릴 때는 이 줄이 이유를 나른다.
	statusEl.textContent = model.status;
};

const load = async (): Promise<void> => {
	void refreshRepoLabel();
	statusEl.textContent = "Loading…";
	// 첫 로드에만 띄운다 — 이후 갱신은 기존 화면을 둔 채 교체한다.
	if (!lastFiles) {
		diffMount.innerHTML = LOADING_MARKUP;
	}
	const result = await fetchDiff();
	if (result.kind === "failed") {
		showLoadFailure(result.failure);
		return;
	}
	applyFetched(result);
};

// aria-pressed drives both a11y and the CSS raised state.
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
		if (lastFiles) renderPatch(lastFiles);
		else void load();
	});
}
syncStyleButtons();
const untrackedInput = document.getElementById(
	"toggle-untracked",
) as HTMLInputElement;
if (untrackedInput) untrackedInput.checked = includeUntracked;
untrackedInput?.addEventListener("change", () => {
	includeUntracked = untrackedInput.checked;
	// 쿼리의 의미가 바뀌면 304를 끊는다 — 빈 diff의 etag는 선택과 무관하게
	// 같아서 빈 상태 카드가 이전 문구에 고착된다.
	lastEtag = null;
	void load();
});
document
	.getElementById("refresh")
	?.addEventListener("click", () => void load());
window.addEventListener("focus", () => void load());

const CHECK_SVG =
	'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

// 빈 목록의 문구를 pickerLoaded·pickerFailed로 가른다 — 받기 전이나
// 실패했는데 "No match"라고 하면 고를 것이 없다는 거짓말이 된다.
let pickerRows: HeadRow[] = [];
let pickerLoaded = false;
// PR이 늦게 오면 이걸로 행을 다시 세운다.
let pickerRefs: RefsResult | null = null;
let pickerFailed = false;
let pickerActive = 0;
let pickerVisible: HeadRow[] = [];

const renderPickerRows = (): void => {
	if (!pickerList) return;
	const rows = filterPickerRows(pickerRows, pickerSearch?.value ?? "");
	pickerVisible = rows;
	if (pickerActive >= rows.length) pickerActive = 0;
	pickerList.replaceChildren();
	pickerSearch?.removeAttribute("aria-activedescendant");
	if (rows.length === 0) {
		const empty = document.createElement("div");
		empty.id = "ref-picker-empty";
		empty.setAttribute("role", "presentation");
		empty.textContent = pickerLoaded
			? "No match"
			: pickerFailed
				? "Couldn't load branches"
				: "Loading…";
		pickerList.append(empty);
		return;
	}
	const SECTION_LABEL: Record<string, string> = {
		worktrees: "WORKTREES",
		branches: "BRANCHES",
	};
	let section: string | null = null;
	for (const [index, row] of rows.entries()) {
		if (row.section !== section) {
			if (section !== null) {
				const rule = document.createElement("div");
				rule.className = "ref-divider";
				// listbox의 자식은 option/group뿐이라 구분선·제목은 presentation이다.
				rule.setAttribute("role", "presentation");
				pickerList.append(rule);
			}
			const head = document.createElement("div");
			head.className = "ref-section";
			head.setAttribute("role", "presentation");
			head.textContent = SECTION_LABEL[row.section] ?? row.section;
			pickerList.append(head);
			section = row.section;
		}
		const el = document.createElement("div");
		el.className = "ref-row";
		el.id = `ref-row-${index}`;
		el.setAttribute("role", "option");
		el.dataset.value = row.value;
		if (index === pickerActive) {
			el.dataset.active = "true";
			pickerSearch?.setAttribute("aria-activedescendant", el.id);
		}
		const selected = row.selected;
		el.setAttribute("aria-selected", String(selected));
		// 사용자 입력이 섞이지 않는 상수 마크업이라 안전하다.
		if (selected) el.insertAdjacentHTML("afterbegin", CHECK_SVG);
		const line = document.createElement("span");
		line.className = "ref-row-line";
		const label = document.createElement("span");
		label.className = "ref-row-label";
		label.textContent = row.label;
		line.append(label);
		if (row.note) {
			const note = document.createElement("span");
			note.className = "ref-row-tag";
			note.textContent = row.note;
			line.append(note);
		}
		el.append(line);
		if (row.pr) {
			el.dataset.pr = row.pr.state;
			const pr = document.createElement("span");
			pr.className = "ref-row-pr";
			pr.insertAdjacentHTML("afterbegin", prIconSvg(row.pr.state, 11));
			const num = document.createElement("span");
			num.className = "ref-row-pr-number";
			num.textContent = `#${row.pr.number}`;
			const title = document.createElement("span");
			title.className = "ref-row-pr-title";
			title.textContent = row.pr.title;
			pr.append(num, title);
			el.append(pr);
		}
		el.addEventListener("click", () => void applyPick(row));
		pickerList.append(el);
	}
};

const rebuildPickerRows = (): void => {
	if (!pickerRefs) return;
	pickerRows = buildHeadRows(
		pickerRefs.worktrees,
		pickerRefs.refs,
		pickerRefs.defaultBranch,
		{ repo, head: currentHead },
		lastPrs,
	);
	if (!pickerPanel?.hidden) renderPickerRows();
};

// 열 때마다 새로 받는다 — 뷰어를 켜 둔 채 만든 브랜치도 보여야 한다.
const loadPickerRows = async (): Promise<void> => {
	try {
		const res = await fetch(
			`/api/refs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		if (!res.ok) {
			pickerFailed = true;
			renderPickerRows();
			return;
		}
		const body = (await res.json()) as RefsResult;
		pickerFailed = false;
		lastRefs = body.refs;
		applyRepoLabel(body.worktrees, body.repoRoot);
		pickerLoaded = true;
		pickerRefs = body;
		rebuildPickerRows();
	} catch {
		pickerFailed = true;
		renderPickerRows();
	}
};

const setPickerOpen = (open: boolean): void => {
	if (!pickerPanel || !pickerBtn) return;
	pickerPanel.hidden = !open;
	pickerBtn.setAttribute("aria-expanded", open ? "true" : "false");
	if (!open) return;
	if (pickerSearch) pickerSearch.value = "";
	pickerActive = 0;
	// 직전 실패를 새 시도 동안 주장하지 않는다 — 결과가 오기 전엔 모른다.
	pickerFailed = false;
	renderPickerRows();
	pickerSearch?.focus();
	void loadPickerRows();
	void refreshPrs();
};

// `persist`는 사용자가 고른 경우에만 켠다 — 추론을 저장하면 이후 자동
// 전환이 영구히 막힌다.
const selectBase = async (
	next: string,
	opts: { persist: boolean },
): Promise<void> => {
	if (next === compareBase) return;
	compareBase = next;
	if (opts.persist) localStorage.setItem(compareBaseKey(repo), next);
	applyRepoLabel();
	// 쿼리 의미가 바뀌므로 조건부 요청을 끊는다 (untracked 토글과 같은 이유).
	lastEtag = null;
	await load();
};

// 사용자가 고른 base(빈 상태 카드의 전환 액션). 저장한다.
const applySelection = async (next: string): Promise<void> => {
	setPickerOpen(false);
	pickerBtn?.focus();
	await selectBase(next, { persist: true });
};

// 워크트리 행은 다른 repo로 이동하고(head는 들고 가지 않는다), 브랜치 행은
// URL의 head만 바꾼다. 패널 닫기·포커스 복귀는 조기 반환보다 먼저다 — 이미
// 고른 행을 눌러도 닫혀야 한다(viewer-toolbar.md).
const applyPick = async (row: HeadRow): Promise<void> => {
	setPickerOpen(false);
	pickerBtn?.focus();
	if (row.kind === "worktree") {
		if (row.selected) return;
		const next = new URL(location.href);
		next.searchParams.set("repo", row.value);
		next.searchParams.delete("head");
		location.href = next.toString();
		return;
	}
	if (row.value === currentHead) return;
	currentHead = row.value;
	// 커밋된 rev를 워킹트리 기준(HEAD)과 견주면 늘 빈 diff라 auto로 올린다.
	// 추론이라 URL엔 싣지 않는다. 서버 parseSelection에도 같은 규칙이 있다.
	if (compareBase === "HEAD") compareBase = "@auto";
	const next = new URL(location.href);
	next.searchParams.set("head", row.value);
	history.replaceState(null, "", next.toString());
	applyRepoLabel();
	// 쿼리 의미가 바뀌므로 조건부 요청을 끊는다 (base 전환과 같은 이유).
	lastEtag = null;
	await load();
};

pickerBtn?.addEventListener("click", () => {
	const opening = Boolean(pickerPanel?.hidden);
	// 두 패널이 동시에 열려 있으면 바깥 클릭 규칙이 서로를 가린다.
	if (opening) setOverflowOpen(false);
	setPickerOpen(opening);
});
pickerSearch?.addEventListener("input", () => {
	pickerActive = 0;
	renderPickerRows();
});

pickerSearch?.addEventListener("keydown", (event) => {
	// 조합 중의 Enter는 한글 확정이지 선택이 아니다 (grab 팝오버와 같은 가드).
	if (event.isComposing || event.keyCode === 229) return;
	const last = pickerVisible.length - 1;
	if (last < 0) return;
	const move = (next: number): void => {
		event.preventDefault();
		pickerActive = next;
		renderPickerRows();
		pickerList
			?.querySelector('[data-active="true"]')
			?.scrollIntoView({ block: "nearest" });
	};
	if (event.key === "ArrowDown")
		return move(pickerActive >= last ? 0 : pickerActive + 1);
	if (event.key === "ArrowUp")
		return move(pickerActive <= 0 ? last : pickerActive - 1);
	if (event.key === "Home") return move(0);
	if (event.key === "End") return move(last);
	if (event.key === "Enter") {
		event.preventDefault();
		const row = pickerVisible[pickerActive];
		if (row) void applyPick(row);
	}
});

// 피커는 자기 dismiss를 갖는다 — 오버플로 메뉴의 리스너와 합치지 않는다.
document.addEventListener("mousedown", (event) => {
	if (!pickerPanel || pickerPanel.hidden) return;
	const target = event.target as Node;
	if (pickerPanel.contains(target) || pickerBtn?.contains(target)) return;
	setPickerOpen(false);
});

document.addEventListener("keydown", (event) => {
	if (!pickerPanel || pickerPanel.hidden) return;
	// 조합 중의 Escape는 조합 취소다(grab 팝오버와 같은 IME 가드).
	if (event.isComposing || event.keyCode === 229) return;
	if (event.key !== "Escape") return;
	setPickerOpen(false);
	pickerBtn?.focus();
});

// 레거시 `mode`는 URL 레이어에서 base로 승격한다 — 저장값 뒤로 내리면
// 외부 링크(link.ts)의 `?mode=base`가 조용히 무시된다.
const urlMode = params.get("mode");
const urlBase =
	params.get("base") ??
	(urlMode === "base" ? "@auto" : urlMode === "working" ? "HEAD" : null);
const storedLegacyMode = localStorage.getItem("cc-statusline:diff-mode");
// 빈 `?base=`는 resolveCompareBase처럼 "없음"으로 친다 — 자가복구 조건
// (compareBaseFromStorage)이 실제로 이긴 값과 맞아야 한다.
const urlChoice = urlBase !== null && urlBase !== "" ? urlBase : null;
const compareBaseFromStorage = urlChoice === null;
compareBase =
	resolveCompareBase(urlChoice, (k) => localStorage.getItem(k), repo) ??
	(storedLegacyMode === "base" ? "@auto" : "HEAD");
// 읽는 최상위 `let`(currentHead 등)이 선언된 뒤에 불러야 한다 — 번들은
// TDZ 오류를 가린다(viewer.md).
applyRepoLabel();

appEl.dataset.treeSide = treeSide;

const treeResizer = document.getElementById("tree-resizer");

const applyTreeWidth = (width: number): void => {
	treeWidth = width;
	appEl.style.setProperty("--vd-tree-w", `${width}px`);
	treeResizer?.setAttribute("aria-valuenow", String(width));
};
applyTreeWidth(treeWidth);

let dragStartX = 0;
let dragStartWidth = treeWidth;

treeResizer?.addEventListener("pointerdown", (event) => {
	// preventDefault() also suppresses focus-on-mousedown; focus explicitly so
	// arrow keys work right after a drag.
	event.preventDefault();
	treeResizer.focus();
	dragStartX = event.clientX;
	dragStartWidth = treeWidth;
	treeResizer.setPointerCapture(event.pointerId);
	treeResizer.dataset.dragging = "true";
	document.body.classList.add("vd-resizing");
});

treeResizer?.addEventListener("pointermove", (event) => {
	if (treeResizer.dataset.dragging !== "true") return;
	applyTreeWidth(
		computeDragWidth(dragStartWidth, dragStartX, event.clientX, treeSide),
	);
});

const endTreeResize = (event: PointerEvent): void => {
	if (!treeResizer || treeResizer.dataset.dragging !== "true") return;
	treeResizer.dataset.dragging = "false";
	document.body.classList.remove("vd-resizing");
	treeResizer.releasePointerCapture(event.pointerId);
	localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth));
};
treeResizer?.addEventListener("pointerup", endTreeResize);
treeResizer?.addEventListener("pointercancel", endTreeResize);

treeResizer?.addEventListener("keydown", (event) => {
	if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
	event.preventDefault();
	applyTreeWidth(
		computeKeyboardWidth(treeWidth, event.key === "ArrowLeft" ? -1 : 1),
	);
	localStorage.setItem(TREE_WIDTH_KEY, String(treeWidth));
});

const flattenInput = document.getElementById(
	"toggle-flatten",
) as HTMLInputElement | null;
if (flattenInput) flattenInput.checked = flattenDirs;

const treeSideInput = document.getElementById(
	"toggle-tree-side",
) as HTMLInputElement | null;
if (treeSideInput) treeSideInput.checked = treeSide === "right";

treeSideInput?.addEventListener("change", () => {
	treeSide = treeSideInput.checked ? "right" : "left";
	appEl.dataset.treeSide = treeSide;
	localStorage.setItem(TREE_SIDE_KEY, treeSide);
});

flattenInput?.addEventListener("change", () => {
	flattenDirs = flattenInput.checked;
	localStorage.setItem(FLATTEN_KEY, flattenDirs ? "1" : "0");
	// flattenEmptyDirectories is a constructor option, so rebuild the tree.
	fileTree?.cleanUp();
	fileTree = null;
	lastTreeKey = null;
	if (lastFiles) renderPatch(lastFiles);
	else void load();
});

const foldWithTreeInput = document.getElementById(
	"toggle-fold-with-tree",
) as HTMLInputElement | null;
if (foldWithTreeInput) foldWithTreeInput.checked = foldWithTree;
foldWithTreeInput?.addEventListener("change", () => {
	foldWithTree = foldWithTreeInput.checked;
	localStorage.setItem(FOLD_WITH_TREE_KEY, foldWithTree ? "1" : "0");
	syncTreeFold();
});

// Session-only (not persisted). The toolbar button and the menu checkbox go
// through this one setter so they never drift apart.
const treeToggleBtn = document.getElementById(
	"tree-toggle-btn",
) as HTMLButtonElement | null;
const treeHiddenInput = document.getElementById(
	"toggle-tree-hidden",
) as HTMLInputElement | null;

const setTreeHidden = (next: boolean): void => {
	treeHidden = next;
	appEl.dataset.treeHidden = treeHidden ? "true" : "false";
	const label = treeHidden ? "Show file tree" : "Hide file tree";
	treeToggleBtn?.setAttribute("aria-pressed", treeHidden ? "true" : "false");
	treeToggleBtn?.setAttribute("aria-label", label);
	treeToggleBtn?.setAttribute("title", label);
	if (treeHiddenInput) treeHiddenInput.checked = treeHidden;
};
setTreeHidden(treeHidden);

treeToggleBtn?.addEventListener("click", () => setTreeHidden(!treeHidden));
treeHiddenInput?.addEventListener("change", () =>
	setTreeHidden(treeHiddenInput.checked),
);

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

const versionValue = document.getElementById("version-value");
if (versionValue) {
	void fetch("/api/ping")
		.then((res) => {
			const v = res.headers.get("x-diffdeck-version");
			if (v) versionValue.textContent = `v${v}`;
		})
		.catch(() => {
			// 부가 정보다 — 못 읽어도 메뉴의 나머지는 그대로 동작한다.
		});
}

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
		if (!effectiveCollapsed(m.fileId)) return;
		const item = codeView.getItem(m.fileId);
		if (item?.type !== "diff") return;
		forceExpandedIds.add(m.fileId);
		autoExpandedIds.add(m.fileId);
		codeView.updateItem({
			...item,
			collapsed: false,
			version: parseCache.bump(m.fileId),
		});
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

document
	.getElementById("find-open")
	?.addEventListener("click", () => findBar?.open());

void load();

const WATCH_POLL_MS = 2000;
let watchTimer: ReturnType<typeof setInterval> | null = null;

// poll끼리만 막는다 — load()(사용자 액션)는 즉시 갱신이라 막지 않고, 겹쳐도
// 다음 폴에서 수렴한다.
let pollInFlight = false;

const poll = async (): Promise<void> => {
	if (pollInFlight) return;
	pollInFlight = true;
	// watch 중엔 focus가 없으므로 여기서도 라벨을 갱신한다(viewer-toolbar.md).
	void refreshRepoLabel();
	try {
		const result = await fetchDiff();
		if (result.kind === "failed") {
			showLoadFailure(result.failure);
			return;
		}
		applyFetched(result);
	} finally {
		pollInFlight = false;
	}
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

if (
	watchInput &&
	resolveWatch(params.get("watch"), (k) => localStorage.getItem(k))
) {
	watchInput.checked = true;
	startWatch();
}

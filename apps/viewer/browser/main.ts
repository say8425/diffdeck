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
import type { RefsResult, WorktreeRecord } from "../server/refs.ts";
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
	type BaseRow,
	buildBaseRows,
	filterBaseRows,
	type RowCounts,
} from "./refPicker/model.ts";
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
	const nextCollapsed = !effectiveCollapsed(id);
	// A manual click always claims this file away from the find bar's temporary
	// bookkeeping — see restoreAutoExpanded below for why this matters.
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
const pickerLabel = document.getElementById("ref-picker-label") as HTMLElement;
const appEl = document.getElementById("app") as HTMLElement;

const changeAddEl = document.getElementById("change-add") as HTMLElement;
const changeDelEl = document.getElementById("change-del") as HTMLElement;

/**
 * 전체 변경량을 툴바에 쓴다. 개수(`#status`)와 **같은 순간에만** 움직인다 —
 * 화면에 렌더된 것이 곧 이 숫자의 출처라, 로딩·실패 중에는 손대지 않는다
 * (그때 화면에는 직전 diff가 그대로 남아 있으므로 숫자도 그것이 맞다).
 */
const applyChangeTotals = (
	files: readonly {
		hunks: readonly { additionLines: number; deletionLines: number }[];
	}[],
): void => {
	const view = changeTotalsView(files);
	changeAddEl.textContent = view.additions;
	changeDelEl.textContent = view.deletions;
};

const repoLabelEl = document.getElementById("repo-label") as HTMLElement;
const repoScopeEl = document.getElementById("repo-scope") as HTMLElement;
const repoNameEl = document.getElementById("repo-name") as HTMLElement;
const repoBranchEl = document.getElementById("repo-branch") as HTMLElement;

/**
 * 툴바 라벨과 탭 제목을 **한 계산 경로**로 세운다. 둘이 갈라지면 같은 사실을
 * 화면 두 곳이 다르게 말하게 되므로 문자열 조립은 전부 repoLabel.ts가 한다.
 */
const applyRepoLabel = (
	worktrees: readonly WorktreeRecord[],
	repoRoot: string | null,
): void => {
	const view = repoLabelView(repo, worktrees, repoRoot);
	repoScopeEl.textContent = view.scope;
	repoNameEl.textContent = view.name;
	repoBranchEl.textContent = view.branch;
	repoLabelEl.setAttribute("title", view.title);
	document.title = view.documentTitle;
};

// 이름은 repo 경로에서 즉시 알 수 있으므로 첫 프레임부터 그린다. 브랜치는
// /api/refs가 도착하면 채워지고, 그때까지는 빈 텍스트다 — 그래서 라벨을
// hidden으로 토글할 일이 없다(CLAUDE.md의 author display + [hidden] 함정).
applyRepoLabel([], null);

/**
 * 브랜치를 /api/refs로 최신화한다.
 *
 * 부르는 곳은 셋이다: load()(부트스트랩·focus·refresh·토글), 피커 열림,
 * 그리고 watch의 poll(). **poll()이 빠지면 안 된다** — watch는 창을 안 보고
 * 있을 때 쓰는 기능이라 focus가 발화하지 않아서, diff만 새 브랜치 것으로
 * 갈리고 툴바·탭 제목은 옛 브랜치에 무기한 굳는다. 게다가 같은 화면의 빈 상태
 * 카드는 /api/summary(캐시 없음)로 **살아 있는** 브랜치를 말하므로, 한 화면이
 * 서로 다른 두 브랜치를 동시에 주장하게 된다 — 이 기능이 없애려던 오진을
 * 새로 만드는 셈이다.
 *
 * 비용은 /api/refs의 5초 TTL이 흡수한다: 폴이 2초여도 실제 git 호출은 5초에
 * 두 번(worktree list + for-each-ref)이 상한이고, 폴이 매번 태우는 diff 빌드에
 * 비하면 무시할 수준이다. "내용이 바뀐 폴에서만" 같은 조건은 쓸 수 없다 —
 * 워킹트리가 깨끗한 채로 브랜치만 갈아타면 diff 지문이 그대로라 304로 흘러
 * 한 번도 안 돌기 때문이다(그게 정확히 고쳐야 할 경우다).
 *
 * 신선도는 피커와 **같다**: 같은 TTL 캐시를 그대로 타므로 브랜치를 갈아탄
 * 직후의 첫 갱신은 캐시를 읽을 수 있고 늦어도 5초 안에 수렴한다. 캐시를
 * 우회하지 않는 이유는 같은 데이터를 보는 두 UI가 서로 다른 신선도를 주장하면
 * 안 되기 때문이다.
 */
const refreshRepoLabel = async (): Promise<void> => {
	try {
		const res = await fetch(
			`/api/refs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		if (!res.ok) return;
		const body = (await res.json()) as RefsResult;
		applyRepoLabel(body.worktrees, body.repoRoot);
	} catch {
		// 부가 정보다 — 못 받아도 이름은 이미 떠 있고 diff는 그대로 동작한다.
	}
};

let diffStyle: "unified" | "split" = resolveDiffStyle(params.get("style"));
let includeUntracked = resolveUntracked(params.get("untracked"));
// 견줄 기준. "HEAD"는 미커밋 변경만, "@auto"는 서버가 해석한 base,
// 그 밖은 그 참조 자체다. merge-base(HEAD, HEAD)가 HEAD라 "HEAD"가 별도
// 분기 없이 오늘의 워킹트리 뷰가 된다.
let compareBase = "HEAD";
const diffModeOf = (base: string): "working" | "base" =>
	base === "HEAD" ? "working" : "base";
// grab 참조와 이미지 blob이 쓰는 "실제로 견주는 대상"의 이름. 사용자가
// 고른 참조가 있으면 그것이고, 없으면 서버가 보고한 base다.
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

// 워커 하이라이트 풀: 토크나이즈를 메인스레드 밖으로 — 파일 진입 시 plain이
// 즉시 그려지고 색은 워커 완료 시 입혀진다.
// poolSize 2: 로컬 단일 사용자 — 목적은 처리량이 아니라 스파이크 제거이고
// 워커마다 shiki 문법 메모리가 중복된다.
//
// 폴백 불변식의 실제 메커니즘: 아래 try/catch는 "동기 생성 실패를 잡아
// workerManager를 undefined로 남긴다"는 방어처럼 보이지만, 실제로는 그 역할을
// 거의 하지 못하는 방어적 장식이다 — JS 스펙상 async 함수 안의 throw는 (첫
// await 이전이라도) 호출자에게 동기 전파되지 않고 그 함수가 반환하는 Promise의
// reject로만 흡수된다. workerFactory()(= new Worker(...))는 WorkerPoolManager
// 생성자 → queueInitialization → initialize() → (Promise executor 안의) 비동기
// IIFE → initializeWorkers()로 이어지는 체인 안에서 호출되는데, 이 체인의 모든
// 단계가 async 함수이므로 Worker 생성자가 던져도 그 예외는 체인 안에서
// 흡수되고 new WorkerPoolManager(...) 호출 자체는 절대 동기적으로 던지지
// 않는다. 실제 세이프티넷은 두 갈래다: ① 엔진 내부 initialize()의 catch가
// (비동기적으로) workersFailed=true를 세워 isWorkingPool()이 false가 되는
// 경로 — DiffHunksRenderer/FileRenderer 생성자(및 그 외 isWorkingPool 체크
// 지점)가 이를 보고 non-worker로 구성되므로, initializeWorkers 내부의
// 프로토콜류 실패는 이 경로로 커버된다. ② 워커 *스크립트*의 비동기 로드 실패
// (네트워크 차단·404 등)는 위 경로로 잡히지 않는다 — 엔진 스스로 감지하지
// 못한다: vendored
// WorkerPoolManager의 worker 'error' 리스너는 로그만 남기고 그 워커의 init
// promise를 정리/거부하지 않으므로 initialize()의 Promise.all이 영구 pending으로
// 남고, isWorkingPool()은 계속 true를 반환하며 메인 하이라이터도 끝내 할당되지
// 않아 diff 본문이 영구 공백으로 렌더된다(실측: worker-highlight.e2e.ts의 "...
// fails to load" 케이스). 그래서 이 비동기 실패는 엔진이 아니라 여기 앱 레벨
// 워치독이 담당한다: workerFactory가 만든 각 Worker에 'error' 리스너를 달아 두고,
// 첫 발생 시(poolSize 2라 최대 2번 온다 — workerLoadRecovered로 1회만 처리) 풀
// 싱글톤을 terminate하고 workerManager를 undefined로 되돌린 뒤, renderPatch의
// 기존 재구성 경로(codeView를 null로 비우면 다음 renderPatch 호출의 `!codeView`
// 분기가 CodeView를 새로 만든다)를 그대로 재사용해 마지막 데이터를 non-worker
// 동기 경로로 다시 렌더한다. Worker 'error'는 스크립트 로드 실패뿐 아니라 워커 내
// 미처리 런타임 예외에도 발화한다 — 그 경우에도 결과는 동기 경로로의 보수적
// 강등이라 안전하다(워커 내 메시지 처리 에러는 handleMessage의 try/catch가
// 프로토콜 응답으로 흡수하므로 실제 발화는 드물다).
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
				poolSize: 2,
			},
			// 워커 자체 기본값(worker.ts:34-40)이 메인스레드 기대 옵션과 일치함을
			// Step 4에서 대조 확인했다 — 불일치 필드가 있으면 여기에 명시한다.
			highlighterOptions: {},
		});
	} catch {
		return undefined;
	}
})();

// 마지막 200 응답의 ETag(폴링 304 조건부 요청용)와 파일 목록(스타일/flatten
// 토글처럼 서버 데이터가 그대로인 재렌더에 재사용).
let lastEtag: string | null = null;
let lastFiles: DiffFile[] | null = null;
let lastTreeKey: string | null = null;
let renderedDiffStyle: "unified" | "split" | null = null;

// 파일별 파싱 캐시: contentVersion이 같으면 Myers-diff 재파싱을 건너뛰고
// CodeView 아이템 version도 유지해 바뀐 파일만 dirty가 되게 한다.
const parseCache = createParseCache<FileDiffMetadata>();

const collapsedIds = new Set<string>();
// 조상 디렉토리가 사이드바 트리에서 접혀 있어 접혀야 하는 파일들 — foldWithTree가
// 켜져 있을 때만 syncTreeFold()가 채운다(Task 6에서 정의).
const treeCollapsedIds = new Set<string>();
// 접힘 근거(collapsedIds든 treeCollapsedIds든)를 무시하고 강제로 펼쳐 둔 파일들.
// 두 용도를 겸한다: (1) 트리 때문에 접힌 파일을 사용자가 직접 클릭해 펼친 경우 —
// 사용자가 다시 접기 전까지 유지된다. (2) find bar가 검색 결과를 보여주려고
// 임시로 펼친 경우 — autoExpandedIds에도 같이 기록되고, 검색이 끝나면 제거된다.
const forceExpandedIds = new Set<string>();
const effectiveCollapsed = (id: string): boolean =>
	!forceExpandedIds.has(id) &&
	(collapsedIds.has(id) || (foldWithTree && treeCollapsedIds.has(id)));
const seenIds = new Set<string>();

let searchFiles: SearchFile[] = [];
let findBar: FindBar | null = null;

// Reuse one button element per file across re-renders: a fold toggle re-runs
// renderHeaderPrefix, and only a persistent DOM node can CSS-tween its chevron
// rotation (a freshly created SVG is born at the final angle — no animation).
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

// [data-title]/[data-prev-name]의 <bdi> 텍스트는 CSS ellipsis로 시각적으로만
// 잘린다 — hover 시 전체 경로가 보이도록 title 속성을 렌더마다 동기화한다
// (idempotent 체크 없이 매번 갱신: 가상화 recycle이 노드를 재사용하며
// textContent만 바꾸는 경우, 이전 파일명이 남은 stale title이 될 수 있어서).
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

// 이미지 아이템 컨테이너에 Old/New 카드를 주입/제거 (onPostRender에서 호출).
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
const autoExpandedIds = new Set<string>(); // 검색이 임시로 펼친 대용량 파일

// computePlacement(게이트 안)가 먹는 손관리 상수. 상태 줄이 뜬 최대 높이를
// 선언한다 — 과대 선언은 안전한 방향(뒤집기가 이르게 발동하고 하단 클램프가
// 보수적일 뿐)이고, 과소 선언만 뷰포트 밖 잘림을 만든다.
//
// width는 **CSS의 340px이 아니라 358px**이다: #grab-popover에 box-sizing이
// 없어 content-box라 실제 렌더 폭은 340 + 패딩 16 + 테두리 2다. 340으로 두면
// 우측 클램프(viewport.width - size.width - MARGIN)가 18px 관대해져 화면
// 오른쪽 끝에서 드래그할 때 팝오버가 그만큼 잘린다(실측 358×69).
// height는 입력창이 max-height(90px)까지 자라고 하단 단축키 각주(.grab-keys,
// 15px + gap 6px)까지 뜬 최대 상태를 기준으로 잡는다 — 배치는 open() 때 한 번만
// 계산되므로, 자란 뒤 재배치가 없어서 과소 선언하면 화면 아래쪽에서 카드가
// 뷰포트를 벗어난다.
const POPOVER_SIZE = { width: 358, height: 211 };
const viewport = (): { width: number; height: number } => ({
	width: window.innerWidth,
	height: window.innerHeight,
});

// 선택 소유권 플래그: 그랩 팝오버가 엔진의 라인 선택(codeView.selectedLines —
// data-selected-line을 낳는 그 슬롯)을 소유 중인지. 거터 "+" 경로
// (onGutterUtilityClick)로 열 때만 true가 되고, 텍스트 드래그 경로는 절대
// 세우지 않는다 — 텍스트 경로는 네이티브 브라우저 Selection만 읽을 뿐 엔진의
// selectedLines를 건드리지 않으므로, 그 슬롯을 소유한 적이 없다. 이 플래그가
// false일 때 codeView.clearSelectedLines()를 호출하면 그건 항상 남의 상태를
// 지우는 것이다 — 대표적으로 find 바가 매치 탐색용으로 같은 슬롯을 쓴다
// (revealMatch/selectMatch → setSelectedLines). 플래그 없이 무조건
// clearSelectedLines()하면: ① 텍스트 경로 팝오버를 Esc로 닫을 때 find 매치
// 하이라이트가 사라지고, ② 팝오버를 연 적 없어도 renderPatch가 진입부에서
// 무조건 grabPopover.close()를 호출하므로(토글·워커 복구 등) 사용자가 거터
// 드래그로 "파킹"만 해 두고 아직 팝오버를 열지 않은 선택까지 매번 지워진다.
let grabOwnsLineSelection = false;

// onCopied(복사 성공 즉시)와 onClosed(Esc·외부 dismiss·자동 닫힘 등 close()
// 경로 전부) 양쪽에서 공유 — 둘 다 "이 팝오버가 소유했던 엔진 선택을
// 정리한다"는 같은 의도이고, 소유 아닐 때 둘 다 손대면 안 되는 것도 같다.
// 가드 안쪽에서 플래그를 리셋하므로 onCopied가 먼저 지우면 뒤이은 자동 닫힘의
// onClosed 호출은 자연히 no-op이 된다(멱등).
const clearOwnedSelection = (): void => {
	if (!grabOwnsLineSelection) return;
	grabOwnsLineSelection = false;
	codeView?.clearSelectedLines();
};

// grab 하이라이트: 텍스트 드래그 경로 전용 채널. 팝오버가 input.focus()로
// 네이티브 선택을 죽이므로(실측 — 포커스가 문서 선택을 팝오버 input으로
// 옮긴다) 잡은 라인을 우리가 다시 그린다. 엔진 selectedLines 슬롯을 쓰지
// 않는 독립 채널이라 find 매치 하이라이트와 공존하고 grabOwnsLineSelection
// 불변식도 그대로다.
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

// 재시딩에 필요한 최소 정보만 — 팝오버가 열려 있는 동안 불변.
let grabTextTarget: { fileId: string; range: NormalizedRange } | null = null;

// 대상 파일의 현재 렌더 마크업에서 행 모델을 다시 긁어 칠한다. 워커
// 하이라이트의 DOM 교체·가상화 recycle이 텍스트 노드를 갈아치우면 Range가
// 죽으므로, onPostRender에서 이 함수를 다시 부른다(CSS 규칙 자체는 엔진의
// unsafeCSS 통로로 들어가 recycle을 넘어 살아남으니 재주입은 불필요하다).
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
	// 대상 파일이 렌더 윈도우 밖(언마운트)이면 칠할 게 없다. 되돌아오면
	// onPostRender 재시딩이 다시 칠하므로 여기서 억지로 보존하지 않는다.
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
	// 팝오버가 어떤 경로로 닫히든(Esc·외부 dismiss·복사 성공 후 자동 닫힘 포함)
	// 그 팝오버가 실제로 엔진 선택을 소유했을 때만 해제한다 — 안 그러면 엔진의
	// placeUtility()가 스테일 선택을 계속 붙들고 있어서(선택이 존재하면 호버를
	// 무시하고 "+"를 선택 하단에 고정, 하단 행이 미렌더면 아예 숨김) 이후 다른
	// 행 호버에서 "+"가 죽는다.
	onClosed: () => {
		clearOwnedSelection();
		grabTextTarget = null;
		grabHighlighter.clear();
	},
});
document.body.append(grabPopover.element);

const statusOf = (fileId: string): GrabFileStatus =>
	lastFiles?.find((f) => f.name === fileId)?.status ?? "modified";

// 스냅샷 = 팝오버가 열려 있는 동안 불변인 데이터 전부(스펙 §팝오버).
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
		snippet,
	};
	return {
		label: grabLabelParts(fileId, snippet),
		labelTitle: fileId,
		buildOutput: (prompt) => encodeGrab({ ...input, prompt }),
		buildPlainOutput: () => plainSnippet(snippet),
	};
};

// 거터 경로 팝오버 앵커: 엔진이 stamp한 data-selected-line 행(없으면 컨테이너).
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

/**
 * 네이티브 텍스트 선택을 스냅샷으로 굳혀 팝오버를 연다. 앵커는 제스처가 끝난
 * 좌표(0크기 rect) — 행 전체 rect를 쓰면 커서와 무관하게 파일 왼쪽 끝에 뜬다.
 *
 * 선택 확정을 이벤트 루프 한 틱(setTimeout 0) 뒤로 미루는 게 계약이다: 워커
 * 하이라이트 DOM 교체·recycle이 선택을 죽여도 스냅샷은 이미 고정된 뒤가 된다.
 * 거터 "+" 경로와 동일하게 트리거 버튼 없이 즉시 열며, 같은 제스처의
 * pointerup/click에서 열어도 외부 dismiss는 pointerdown/mousedown에만 걸려
 * 있어 자기-dismiss는 없다.
 */
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
	// 드래그 게이트: 선택이 존재하기만 하면 여는 게 아니라, 폴드 토글(위 click
	// 핸들러 :87-96)과 동일하게 pointerDown/movedBeyondThreshold로 실제
	// 드래그였는지 확인한다. 마우스를 움직이지 않은 제스처는 여기서 걸러지고,
	// 그중 멀티클릭만 아래 click 핸들러가 따로 받는다.
	const upPoint = { x: event.clientX, y: event.clientY };
	if (
		!pointerDown ||
		!movedBeyondThreshold(pointerDown, upPoint, DRAG_THRESHOLD)
	) {
		return;
	}
	openGrabFromTextSelection(upPoint);
});

// 멀티클릭 경로: 더블/트리플클릭의 네이티브 단어·문단 선택은 마우스 이동 없이
// 만들어지므로 위 드래그 게이트를 통과하지 못한다. 클릭 횟수를 읽을 수 있는
// 지점은 click 이벤트뿐이다 — Chrome의 pointerdown/pointerup은 detail이 늘
// 0이다(실측). detail >= 2 하나로 더블(2)·트리플(3)을 함께 덮고, 평범한 단일
// 클릭(detail 1)은 그대로 제외된다. dblclick 이벤트를 쓰지 않는 이유도 여기
// 있다: 트리플클릭엔 전용 이벤트가 없어 세 번째 클릭의 문단 선택을 놓친다.
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
	// 엔진 기본값(100k줄)보다 낮춘 하이라이트 상한: 이보다 큰 파일은 plain
	// text로 렌더한다. 하이라이트 렌더는 범위를 무시하고 파일 전체를 동기
	// 토크나이즈하므로(renderDiffWithHighlighter의 문법 정합성 정책), 수만 줄
	// lockfile을 펼치는 순간 수 초 프리징이 됐다 — 그런 파일에 신택스 색은
	// 무의미하니 20k줄부터 포기한다. 접힌 상태의 헤더-만 렌더는 이 값과
	// 무관하게 zero-work다 (DiffHunksRenderer의 emptyWindow 경로).
	tokenizeMaxLength: 20_000,
	expandUnchanged: expandAll,
	// diff-grab: GitHub식 거터 라인 선택 + "+" 버튼 (스펙 §경로 A).
	// renderGutterUtility는 금지 — onGutterUtilityClick과 병용 시 엔진 throw.
	enableLineSelection: true,
	// 라인넘버 드래그는 끈다 — 드래그는 코드 텍스트 선택(그랩)의 제스처다.
	// 클릭 한 줄 선택·shift클릭 확장·"+" 클릭은 그대로(엔진 pendingLineSelect).
	enableLineSelectionDrag: false,
	enableGutterUtility: true,
	onGutterUtilityClick: (range: SelectedLineRange, context) => {
		const snap = buildGrabSnapshot(context.item.id, normalizeRange(range));
		if (!snap) return;
		// 거터 경로는 엔진 선택 하이라이트가 칠하므로 grab 채널은 쓰지 않는다.
		// 텍스트 하이라이트가 남아 있으면 여기서 지운다(이중 페인트 방지).
		grabTextTarget = null;
		grabHighlighter.clear();
		// 거터 경로만 엔진 선택을 소유한다 — 이 클릭이 있기 전에 엔진이 이미
		// range를 selectedLines에 반영해 뒀으므로(GitHub식 거터 드래그
		// 선택), 그 상태를 "이 팝오버가 책임진다"고 표시한다.
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
		// The header is sticky, so its own code scrolls underneath it: the hover
		// tint has to be mixed into --diffs-bg rather than layered over it as a
		// translucent colour, which would replace the opaque background and let
		// the code show through. --diffs-mixer is the engine's own contrast
		// token (light-dark(#000, #fff)), so this tints the right direction in
		// either theme; in srgb because that matches how the browser would have
		// composited the equivalent 5% overlay.
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
		// Re-evaluate now that the search override is gone — the file's real
		// collapse reason (manual, tree, or none) may have changed while the
		// find bar was open (e.g. the user expanded its directory in the tree).
		const collapsed = effectiveCollapsed(id);
		codeView.updateItem({ ...item, collapsed, version: parseCache.bump(id) });
	}
	autoExpandedIds.clear();
};

const isDirHandle = (
	item: FileTreeItemHandle,
): item is FileTreeDirectoryHandle => item.isDirectory();

// 디렉토리 경로 → 그 아래 모든 파일 경로(모든 하위 depth 포함) 맵. 파일 경로
// 총 길이에 선형 — 매 depth마다 접두사를 처음부터 다시 만들지 않고 누적한다.
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

// fileTree.resetPaths()는 이 프로젝트의 initialExpansion:"open" 기본값 때문에
// 호출될 때마다 모든 디렉토리를 펼침으로 되돌린다(초기화 옵션의
// initialExpandedPaths로는 되돌릴 수 없음 — 이미 전부 "기본 펼침"이라 no-op).
// 리셋 직전 접혀 있던 디렉토리를 캡처해 뒀다가, 리셋 후 다시 .collapse()해
// 되돌린다. foldWithTree와 무관하게 항상 동작 — 사이드바 트리 자체의 접힘
// 상태를 데이터 갱신 전반에 걸쳐 보존하는 것이 이 기능이 올바르게 작동하기
// 위한 전제조건이다.
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

// foldWithTree가 켜져 있을 때 "트리 때문에 접혀야 할 파일 집합"을 다시 계산해
// treeCollapsedIds와 diff하고, 실제로 상태가 바뀐 파일에 대해서만
// codeView.updateItem()을 호출한다. fileTree.subscribe()(페이로드 없음 — 선택/
// 포커스/검색 등 모든 트리 변경에 공통으로 발화)와 renderPatch() 양쪽에서
// 호출된다.
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
		const res = await fetch(`/api/summary?${query.toString()}`);
		if (!res.ok) return null;
		return (await res.json()) as RepoSummary;
	} catch {
		return null;
	}
};

// 빈 상태를 정보형 카드로 승격한다. best-effort: 요약 fetch가 실패하면 기존
// "No changes." 폴백이 그대로 남는다. marker 동일성 가드 — fetch 동안 다른
// 렌더가 #empty를 갈아치웠으면(새 diff 도착 등) 낡은 카드를 덮어쓰지 않는다.
// 자동 base 전환을 한 페이지에서 한 번만 시도한다. 조건이 계속 참이어도
// 재진입하지 않게 하는 안전장치다(전환 뒤에는 mode가 base라 조건 자체가
// 거짓이 되지만, 루프 없음을 코드에서 바로 읽히게 둔다).
let autoBaseTried = false;

// 사용자가 견줄 기준을 고른 적이 있는가 — URL의 `base=`든 저장된
// 프리퍼런스든. resolveCompareBase가 null을 주면 아무 선택도 없다는 뜻이다.
// 호출 시점에 다시 읽는다: 모듈 초기화 때 캐시해 두면 피커로 고른 뒤에도
// 옛 값이 남아 자동 전환이 사용자의 선택을 덮는다.
const hasExplicitBase = (): boolean =>
	resolveCompareBase(urlChoice, (k) => localStorage.getItem(k), repo) !== null;

const enrichEmptyState = async (): Promise<void> => {
	const marker = diffMount.querySelector("#empty");
	if (!marker) return;
	// 모드/untracked를 fetch 시작 시점에 스냅샷 — fetch 중 사용자가 모드를
	// 바꾸면(새 diff가 로딩 중) 새 모드 문구의 카드를 그리면 모순이므로 버린다.
	const mode = compareBase;
	const untrackedShown = includeUntracked;
	const summary = await fetchSummary();
	if (!summary) return;
	if (diffMount.querySelector("#empty") !== marker) return;
	if (mode !== compareBase || untrackedShown !== includeUntracked) return;
	const model = buildEmptyStateModel(summary, {
		mode: diffModeOf(mode),
		untrackedShown,
	});
	// 빈 화면을 보여주는 대신 볼 것이 있는 쪽으로 바로 데려간다. 저장하지
	// 않는다 — 추론이지 사용자의 선택이 아니다. 피커로 직접 고르면 그때
	// 저장되고, 그 뒤로는 hasExplicitBase()가 이 경로를 영구히 막는다.
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
	// 사이드바 트리와 같은 순서(디렉터리 우선·자연 정렬)로 diff 아이템을 배치.
	const files = unsorted.toSorted((a, b) =>
		comparePathsInTreeOrder(a.name, b.name),
	);
	if (files.length === 0) {
		teardownViews();
		parseCache.prune([]);
		diffMount.replaceChildren();
		diffMount.innerHTML = '<div id="empty">No changes.</div>';
		statusEl.textContent = "";
		applyChangeTotals([]);
		void enrichEmptyState();
		return;
	}
	statusEl.textContent = `${files.length} file(s)`;

	// 바이너리 이미지는 파일 순서 그대로 diff 흐름에 인라인 카드로 들어간다:
	// 빈 diff 아이템(헤더 제공)에 onPostRender가 Old/New 카드를 주입.
	imageEntryById = new Map(imageEntries(files).map((e) => [e.name, e]));
	imageUrlFor = (path, side, version) =>
		blobUrl({
			repo,
			token,
			path,
			side,
			mode: diffModeOf(compareBase),
			base: compareBase,
			version,
		});

	// File tree lists ALL changed files (binary included); status maps 1:1 to
	// @diffdeck/trees GitStatus.
	const paths = files.map((f) => f.name);
	const gitStatus = files.map((f) => ({ path: f.name, status: f.status }));

	// 트리 → diff 폴드 동기화 준비: 이번 렌더의 디렉토리 맵을 새로 만들고, 아직
	// 갱신 전인(기존) fileTree에서 현재 접혀 있는 디렉토리를 캡처해 둔다 —
	// resetPaths()가 모든 디렉토리를 펼침으로 되돌리기 때문에, 아래에서
	// 되돌린다.
	knownDirDescendants = buildDirDescendants(paths);
	const collapsedDirPaths = captureCollapsedDirPaths(
		knownDirDescendants.keys(),
	);

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
		fileTree.subscribe(() => syncTreeFold());
		reapplyCollapsedDirs(collapsedDirPaths);
		lastTreeKey = treeKey;
	} else if (treeKey !== lastTreeKey) {
		fileTree.resetPaths(paths);
		fileTree.setGitStatus(gitStatus);
		reapplyCollapsedDirs(collapsedDirPaths);
		lastTreeKey = treeKey;
	}
	// 트리 상태를 최종 반영 — foldWithTree가 꺼져 있으면 treeCollapsedIds를
	// 비우는 역할도 겸한다. 아래 아이템 배열이 이 결과를 읽으므로 반드시 그
	// 전에 호출한다.
	syncTreeFold();

	// Diff items: parse each non-binary file's full old/new contents into a
	// NON-partial FileDiffMetadata so hunk expansion works. contentVersion이
	// 같은 파일은 parseCache가 이전 파싱 결과와 아이템 version을 돌려주므로,
	// 실제로 바뀐 파일만 재파싱되고 CodeView도 그 아이템만 dirty로 본다.
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
			// fileDiff.name/prevName은 신뢰할 수 없다: parseDiffFromFile(vendored)이
			// npm `diff`의 createTwoFilesPatch로 유니파이드 diff 텍스트를 만든 뒤 그
			// 텍스트의 `--- `/`+++ ` 헤더 줄을 되읽어 이름을 복원하는데, `diff`가
			// 비-ASCII 경로를 그 텍스트 헤더에 git 스타일 큰따옴표+8진 이스케이프로
			// 인용해서 쓰고 vendored 파서는 그걸 그대로(unquote 없이) 되읽는다 —
			// 예를 들어 "src/한글파일.ts"의 fileDiff.name이 문자 그대로
			// "src/\355\225\234\352\270\200\355\214\214\354\235\264.ts"가 된다. 헤더
			// 표시(vendored 기본 렌더)·fold id·copy-path가 전부 이 필드들을 읽으므로,
			// 서버가 이미 준 진짜 이름으로 파싱 직후 덮어써 근원에서 바로잡는다.
			fileDiff.name = f.name;
			if (f.oldName) fileDiff.prevName = f.oldName;
			// Large files (lockfiles or over the changed-line threshold) start
			// collapsed on first sight.
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
	// 개수 옆의 전체 변경량. items는 방금 전량 파싱됐으므로 합산은 공짜다.
	applyChangeTotals(items.map((it) => it.fileDiff));

	searchFiles = items.map((it) => ({ fileId: it.id, fileDiff: it.fileDiff }));
	findBar?.setData();

	// Diff panel: recreate the CodeView only on first render or when
	// transitioning from empty; otherwise reuse it so scroll is preserved
	// across updates. A diffStyle change also reuses it — see the setOptions
	// branch below.
	if (!codeView) {
		// No cleanUp() needed: codeView is null here by definition, and the
		// paths that clear it (recoverFromWorkerLoadFailure, teardownViews)
		// both tear the old instance down before nulling. replaceChildren
		// still matters — the mount may hold the loading/empty-state
		// placeholder.
		diffMount.replaceChildren();
		codeView = new CodeView(codeViewOptions(), workerManager);
		// Render further ahead of the viewport than CodeView's 200px default.
		// The old headerless-remount blink is cured at the source — the forked
		// DiffHunksRenderer.recycle() re-acquires the shared highlighter
		// synchronously (like its constructor), so a re-mounted file paints
		// fully in the frame it renders. What remains is the engine's scroll →
		// queueRender → next-rAF pipeline: rendering trails the scroll position
		// by one frame, so the buffer must cover one frame's scroll delta.
		// 1000px (the engine's sibling Virtualizer default, Virtualizer.ts:20-22)
		// keeps the pane fully covered up to 800px/frame flings — verified by
		// e2e/header-mount.e2e.ts's extreme-fling probe; 200px would re-expose
		// blank bands at fast scrolls.
		//
		// The cost is that overscrollSize also widens the `fitPerfectly`
		// large-jump threshold (CodeView.ts:2576-2580 compares against
		// viewportHeight + overscrollSize * 2), so jumps of ~viewport+400..2000px
		// now paint a full window instead of the minimum, and the element pool
		// grows (:963). Accepted: one frame's cost on a jump vs. visible
		// blanking during every fast scroll.
		//
		// Set per instance, and only here: setOptions never touches config, so
		// the value survives every later option change (including diffStyle).
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
	} else if (renderedDiffStyle !== diffStyle) {
		// Unified↔Split: hand the change to the engine instead of rebuilding.
		// Recreating the CodeView emptied diffMount (which *is* the scroll
		// container), collapsing scrollHeight so the browser clamped scrollTop
		// to 0 — the toggle threw you back to the top of the diff.
		//
		// The engine already models this transition: diffStyle is an item-layout
		// option (CodeView.ts hasItemLayoutOptionChanged), so setOptions resets
		// the layout caches, and it opens by calling capturePendingLayoutAnchor()
		// so the render path can resolveAnchoredScrollTop() and hold the viewport
		// across the reflow. That anchor is semantic (item + line), which is what
		// this transition needs: unified and split have genuinely different
		// content heights, so restoring the old scrollTop in pixels would land on
		// a different file entirely.
		//
		// shouldClearPool() deliberately ignores diffStyle, so the element pool
		// survives; diffstyle-scroll.e2e.ts asserts the recycled nodes still
		// render as split (data-diff-type) alongside the anchoring itself.
		//
		// Keep setOptions BEFORE setItems. It is the anchor capture that has to
		// see the pre-transition layout, and the reset it queues survives the
		// reconcile only because markLayoutDirtyFromIndex() mins against the
		// existing index — setOptions marks from 0, and a later setItems
		// marking from, say, file 5 cannot walk that back. Swapping the two
		// would capture the anchor against post-reconcile state instead, and
		// no test here would necessarily catch it.
		codeView.setOptions(codeViewOptions());
		codeView.setItems(items);
		codeView.render();
		renderedDiffStyle = diffStyle;
	} else {
		// Plain data update (refresh / --watch poll). Let the engine anchor this
		// too, exactly as the style change above does — do NOT restore the old
		// scrollTop in pixels.
		//
		// setItems → reconcileItems marks layout dirty from the first changed
		// item, and the render path re-arms its scroll correction unconditionally
		// whenever layoutDirtyIndex is set, deriving a fresh anchor from
		// renderState when no pendingLayoutAnchor is cached. So the correction is
		// already semantic and already happening; a pixel scrollTo on top of it
		// is not just redundant but actively wrong in three ways:
		//
		//   1. It creeps, on every single update. A `position` target is not an
		//      identity restore: resolveScrollTargetTop subtracts
		//      getStickyHeaderOffset() (= diffHeaderHeight, 44, because we pass
		//      stickyHeaders: true and no disableFileHeader) whenever the value
		//      isn't clamped. Every refresh and every --watch poll nudged the
		//      viewport up by 44px.
		//   2. It drifts. If a file *above* the viewport changed length, the
		//      content below it moves, so the old pixel offset now points at a
		//      different line — measured at 1244px of drift for a 60-line growth.
		//   3. It clobbers the style toggle's anchor. scrollTo() sets
		//      pendingScrollTarget, and the frame honours that verbatim over the
		//      resolved anchor. renderedDiffStyle is updated synchronously above
		//      while that branch's render is still only queued, so an update
		//      landing in that one-frame window routes here and would overwrite
		//      the anchored position with a pre-transition pixel value — which,
		//      against split's roughly halved content, lands near the bottom.
		//
		// The correction is not universal, and does not need to be: setItems has
		// append-only paths that mark nothing dirty (nothing above the viewport
		// moved, so there is nothing to correct), and anchor resolution can come
		// back empty — the anchor's item removed, or renderState reset when the
		// list shrinks past the render window. The fallback there is the clamped
		// current position, which still beats the old value-minus-44.
		// Regression net: update-anchor.e2e.ts.
		codeView.setItems(items);
		codeView.render();
	}
};

// 트리거가 "지금 무엇과 견주는 중인가"를 말한다. @auto는 서버가 이름을
// 알려줘야 쓸 수 있으므로 매 응답마다 다시 그린다.
const pickerLabelText = (): string =>
	compareBase === "HEAD"
		? "Working tree"
		: compareBase === "@auto"
			? `vs ${diffBase || "base"}`
			: `vs ${compareBase}`;

const syncPickerLabel = (): void => {
	if (!pickerLabel) return;
	const text = pickerLabelText();
	pickerLabel.textContent = text;
	pickerBtn?.setAttribute("title", text);
};

type FetchDiffResult =
	| { kind: "data"; files: DiffFile[]; base: string; etag: string | null }
	| { kind: "unchanged"; base: string };

type FetchDiffAttempt =
	| FetchDiffResult
	// 서버가 살아있고 이 요청 자체가 잘못됐다는 신호(토큰 불일치·git repo
	// 아님) — 재시도해도 같은 답을 받으므로 즉시 포기한다.
	| { kind: "terminal"; unknownBase: boolean }
	// 서버가 일시적으로 응답을 못 만든(single-flight 타임아웃 503,
	// singleFlight.ts) 경우와 네트워크 레벨 실패(fetch 자체가 throw) —
	// 둘 다 곧 회복될 수 있으니 재시도할 가치가 있다.
	| { kind: "retryable" };

const fetchDiffOnce = async (): Promise<FetchDiffAttempt> => {
	const query = new URLSearchParams({
		repo,
		token,
		untracked: includeUntracked ? "1" : "0",
		base: compareBase,
	});
	try {
		// 조건부 요청: 서버 지문이 그대로면 304가 오고, 수십 MB payload 전송과
		// JSON 파싱·재렌더 전부를 건너뛴다.
		const res = await fetch(`/api/diff?${query.toString()}`, {
			headers: lastEtag ? { "if-none-match": lastEtag } : {},
		});
		const base = decodeHeaderValue(res.headers.get("x-diff-base"));
		if (res.status === 304) return { kind: "unchanged", base };
		if (res.status === 503) return { kind: "retryable" };
		if (!res.ok) {
			return {
				kind: "terminal",
				unknownBase: res.headers.get("x-diff-error") === "unknown-base",
			};
		}
		const files = (await res.json()) as DiffFile[];
		return { kind: "data", files, base, etag: res.headers.get("etag") };
	} catch (err) {
		console.error(err);
		return { kind: "retryable" };
	}
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

// 서버의 single-flight 타임아웃(45초, singleFlight.ts)이 503으로 응답하는
// 순간엔 그 키가 이미 비워져 있으므로(createSingleFlight의 `.finally()`),
// 곧바로 다시 요청하면 죽은 플라이트가 아니라 새 플라이트에 합류한다.
// 딱 한 번만 재시도한다(두 번이 아니라) — /api/diff는 baseFlight·diffFlight
// 두 플라이트를 순차로 기다리므로(server.ts) 시도 하나가 최악의 경우 이미
// 45초 × 2 = 90초까지 걸릴 수 있고, diff.ts의 BUILD_CONCURRENCY=8는 호출당
// 상한이라 겹치는 시도마다 동시 git 서브프로세스 수가 그대로 곱해진다 —
// 재시도를 늘릴수록 정확히 그 경합을 키워 다음 시도를 더 오래 걸리게
// 만든다. 지연값(1000ms)은 서버 쪽 Retry-After(1초, server.ts)와 의도적으로
// 맞춘 수다. 범용 재시도 라이브러리가 아니라 이 한 호출 전용의 최소 구현.
const RETRY_DELAYS_MS = [1000] as const;

// 저장된 기준이 가리키던 브랜치가 사라지면(PR 머지 후 원격 브랜치 삭제 +
// `git fetch --prune`) 서버는 400을 낸다. 400은 재시도 없는 terminal이므로,
// 손대지 않으면 **이후 모든 실행**이 실패 카드로 시작한다 — 화면에는 이유도
// 안 나온다. 저장된 값에서 온 경우에만 한 번 지우고 워킹트리로 되돌린다.
// URL이 명시한 기준은 건드리지 않는다: 사용자가 그 링크로 그 비교를 요구한
// 것이므로, 조용히 다른 것을 보여주는 편이 에러보다 나쁘다(서버가 목록 밖
// base를 400으로 거절하는 것과 같은 근거).
let staleBaseRecovered = false;
const recoverFromStaleBase = (unknownBase: boolean): boolean => {
	// "not a git repository" 400에서도 돌면 프리퍼런스만 조용히 사라지고
	// 화면은 그대로 실패 카드다 — 서버가 준 표식으로만 발동한다.
	if (!unknownBase) return false;
	if (staleBaseRecovered || !compareBaseFromStorage) return false;
	if (compareBase === "HEAD") return false;
	staleBaseRecovered = true;
	localStorage.removeItem(compareBaseKey(repo));
	compareBase = "HEAD";
	syncPickerLabel();
	lastEtag = null;
	return true;
};

const fetchDiff = async (): Promise<FetchDiffResult | null> => {
	// 각 시도가 이전 시도의 결과(terminal이면 즉시 포기, retryable이면 대기 후
	// 재시도)에 의존하므로 의도적으로 순차 실행 — Promise.all로 병렬화할 대상이
	// 아니다 (diff.ts:resolveBaseRef와 동일 관례).
	for (let attempt = 0; ; attempt++) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await fetchDiffOnce();
		if (result.kind === "data" || result.kind === "unchanged") return result;
		if (result.kind === "terminal") {
			// attempt를 되돌린다 — 복구 직후의 재요청이 503을 만나면 남은
			// 1회 재시도가 필요하고, 그것이 CLAUDE.md "Loading… 자가치유"
			// 3요소 중 클라이언트 몫이다.
			if (recoverFromStaleBase(result.unknownBase)) {
				attempt--;
				continue;
			}
			return null;
		}
		if (attempt >= RETRY_DELAYS_MS.length) return null;
		// oxlint-disable-next-line no-await-in-loop
		await sleep(RETRY_DELAYS_MS[attempt]);
	}
};

// x-diff-base가 보고한 "서버가 해석한 base" 이름. 피커 라벨(@auto일 때)과
// grab 참조가 읽는다.
let diffBase = "";
const applyFetched = (result: FetchDiffResult): void => {
	diffBase = result.base;
	syncPickerLabel();
	if (result.kind === "unchanged") {
		// 변경 없음: 현재 렌더 유지, 상태 라벨만 복원한다.
		statusEl.textContent =
			lastFiles && lastFiles.length > 0 ? `${lastFiles.length} file(s)` : "";
		// 단, 빈 상태 카드가 떠 있는 동안엔 요약을 재계산한다 — untracked
		// 개수·base 이동은 diff 지문 밖 사실이라(untracked=0은 -uno) 새
		// untracked 파일이 생겨도 304가 오고, 카드가 낡은 개수를 확신 있게
		// 계속 주장하게 된다. marker/스냅샷 가드가 재진입을 안전하게 만든다.
		if (lastFiles && lastFiles.length === 0) void enrichEmptyState();
		return;
	}
	lastEtag = result.etag;
	lastFiles = result.files;
	renderPatch(result.files);
};

const load = async (): Promise<void> => {
	// 정체성 갱신은 diff와 독립이다 — 기다리지 않는다. 브랜치를 갈아탄 뒤
	// 창으로 돌아오면(focus → load) 라벨이 따라온다.
	void refreshRepoLabel();
	statusEl.textContent = "Loading…";
	// 첫 로드(아직 아무것도 렌더된 적 없음)에만 로딩 인디케이터를 띄운다 —
	// 이후 갱신은 기존 내용을 유지한 채 백그라운드로 교체되므로 비워지지
	// 않는 것이 의도된 동작이다. 렌더가 성공하면 renderPatch가 이 노드를
	// 통째로 대체한다.
	if (!lastFiles) {
		diffMount.innerHTML =
			'<div id="empty" data-loading><span class="loading-spinner"></span>Loading diff…</div>';
	}
	const result = await fetchDiff();
	if (result === null) {
		// 살아 있는 CodeView가 없을 때만 실패 카드로 덮어쓴다. 위 로딩
		// 인디케이터는 `!lastFiles`로 같은 취지를 노리지만, 정확한 위험 조건은
		// "렌더된 내용이 있다"가 아니라 "붙어 있는 CodeView가 있다"다: diffMount는
		// CodeView의 스크롤 컨테이너 그 자체라, innerHTML 대입이 CodeView가 setup
		// 때 붙여 둔 컨테이너를 문서에서 떼어낸다. CodeView.setup()은 이미 setup된
		// 인스턴스의 재부착을 거부하므로(`already setup`), 인스턴스를 새로 만들기
		// 전까지 패널은 영구히 빈 채로 남는다 — 서버를 Ctrl+C로 끄고 탭으로
		// 돌아오기만 해도(focus 리스너가 load()를 호출한다) 걸리는 경로다.
		//
		// `!lastFiles`로 걸면 변경이 없는 리포(lastFiles === []는 truthy)에서
		// 어긋난다: 그 경로는 teardownViews()로 이미 codeView를 비운 뒤라 카드를
		// 쓰는 게 안전한데도 억제돼, 상태 라벨만 실패를 말하고 화면은 "No
		// changes."를 계속 주장하게 된다.
		if (!codeView) {
			diffMount.innerHTML = '<div id="empty">Failed to load diff.</div>';
		}
		// 어느 쪽이든 실패는 알린다 — 안 그러면 라벨이 "Loading…"에 고착된다.
		statusEl.textContent = "Failed to load diff.";
		return;
	}
	applyFetched(result);
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
		// 스타일은 클라이언트 렌더 옵션일 뿐이라 서버 데이터가 그대로다 —
		// 재fetch 없이 마지막 파일 목록으로 즉시 재렌더한다(파싱 캐시 히트).
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
	// 쿼리 의미가 바뀌므로 조건부 요청을 끊는다 — 빈 payload의 etag는 모드/
	// untracked와 무관하게 동일해서, 유지하면 304로 빈 상태 카드가 이전
	// 토글 기준 문구에 고착된다.
	lastEtag = null;
	void load();
});
document
	.getElementById("refresh")
	?.addEventListener("click", () => void load());
window.addEventListener("focus", () => void load());

// ── 견줄 기준 피커 ──────────────────────────────────────────────────────
const CHECK_SVG =
	'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

// 목록을 받기 전에도 Working tree 행은 항상 있다. 빈 배열로 두면 피커를
// 열 때마다 "No match"가 한 프레임 스치고, 그건 목록이 없는 것처럼 읽힌다.
let pickerRows: BaseRow[] = buildBaseRows([], null, null);
// 방향키가 움직이는 활성 행. 필터가 바뀌면 첫 행으로 되돌린다.
let pickerActive = 0;
// 현재 화면에 그려진 행들 — 키보드 처리와 렌더가 같은 목록을 봐야 한다.
let pickerVisible: BaseRow[] = [];

const renderPickerRows = (): void => {
	if (!pickerList) return;
	const rows = filterBaseRows(pickerRows, pickerSearch?.value ?? "");
	pickerVisible = rows;
	if (pickerActive >= rows.length) pickerActive = 0;
	pickerList.replaceChildren();
	pickerSearch?.removeAttribute("aria-activedescendant");
	if (rows.length === 0) {
		const empty = document.createElement("div");
		empty.id = "ref-picker-empty";
		empty.textContent = "No match";
		pickerList.append(empty);
		return;
	}
	const SECTION_LABEL: Record<string, string> = {
		uncommitted: "UNCOMMITTED",
		branches: "COMPARE WITH A BRANCH",
	};
	let section: string | null = null;
	for (const [index, row] of rows.entries()) {
		if (row.section !== section) {
			if (section !== null) {
				const rule = document.createElement("div");
				rule.className = "ref-divider";
				pickerList.append(rule);
			}
			const head = document.createElement("div");
			head.className = "ref-section";
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
		const selected = row.value === compareBase;
		el.setAttribute("aria-selected", String(selected));
		// 사용자 입력이 섞이지 않는 상수 마크업이라 안전하다.
		if (selected) el.insertAdjacentHTML("afterbegin", CHECK_SVG);
		const label = document.createElement("span");
		label.className = "ref-row-label";
		label.textContent = row.label;
		el.append(label);
		if (row.note) {
			const note = document.createElement("span");
			note.className = "ref-row-tag";
			note.textContent = row.note;
			el.append(note);
		}
		el.addEventListener("click", () => void applySelection(row.value));
		pickerList.append(el);
	}
};

// 열 때마다 새로 받는다. 한 번 받고 영원히 쓰면 뷰어를 켜 둔 채 만든
// 브랜치가 리로드 전까지 절대 안 보이고, /api/refs의 5초 TTL도 무의미해진다
// (그 TTL은 "열 때마다 호출된다"를 전제로 잡은 값이다).
const loadPickerRows = async (): Promise<void> => {
	try {
		const res = await fetch(
			`/api/refs?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		if (!res.ok) return;
		const body = (await res.json()) as RefsResult;
		// %(HEAD)는 명령을 실행한 워크트리 기준이라 리포 전역 목록에서는
		// misleading하다. 이 워크트리가 무엇을 체크아웃했는지는 worktree
		// 목록에서 자기 경로를 찾아 읽는다.
		// 정확 일치가 아니라 findWorktree를 쓴다 — repo는 CLI 기동 시점의
		// process.cwd()라 리포 루트라는 보장이 없어, 하위 디렉토리에서 켜면
		// 정확 일치가 실패해 HEAD 태그가 조용히 사라진다. 툴바 라벨과 같은
		// 판정을 공유해야 "내가 어느 워크트리에 있는가"의 답이 하나로 남는다.
		const current = findWorktree(body.worktrees, repo)?.branch ?? null;
		// 같은 응답으로 라벨도 최신화한다 — 피커를 열 때마다 공짜로 따라온다.
		applyRepoLabel(body.worktrees, body.repoRoot);
		// 목록을 먼저 그린다. 개수를 기다리면 목록이 /api/refs(수 ms)가 아니라
		// /api/summary(수십 ms)의 속도로 뜨고, 더 나쁘게는 getRepoSummary가
		// 의도적으로 single-flight 밖이라(CLAUDE.md) 거기서 매달리면 목록이
		// Working tree 한 줄에 영구히 갇힌다.
		pickerRows = buildBaseRows(body.refs, body.defaultBranch, current);
		renderPickerRows();

		// 개수는 부가 정보다 — 도착하면 얹고, 못 받으면 목록을 그대로 쓴다.
		const summary = await fetchSummary();
		if (!summary) return;
		const counts: RowCounts = {
			working: summary.workingFiles,
			// 표시명(base)이 아니라 **실제로 잰 ref**로 맞춘다. base는 origin/
			// 접두가 벗겨져 있어, 그걸로 맞추면 origin/main으로 잰 숫자가 로컬
			// main 행에 붙는다 — 로컬이 뒤처져 있으면 값이 실제로 갈린다.
			base:
				summary.ref !== null && summary.baseFiles !== null
					? { name: summary.ref, files: summary.baseFiles }
					: null,
		};
		pickerRows = buildBaseRows(body.refs, body.defaultBranch, current, counts);
		renderPickerRows();
	} catch {
		// 목록을 못 받아도 피커는 열린다 — 지금 고른 값은 라벨이 계속 말한다.
	}
};

const setPickerOpen = (open: boolean): void => {
	if (!pickerPanel || !pickerBtn) return;
	pickerPanel.hidden = !open;
	pickerBtn.setAttribute("aria-expanded", open ? "true" : "false");
	if (!open) return;
	if (pickerSearch) pickerSearch.value = "";
	pickerActive = 0;
	renderPickerRows();
	pickerSearch?.focus();
	void loadPickerRows();
};

/**
 * 견줄 기준을 바꾼다. `persist`가 사용자의 **선택**과 서버 상태로부터의
 * **추론**을 가른다 — 추론을 저장해 버리면 고른 적 없는 프리퍼런스가 생겨
 * 이후 자동 전환이 영영 막힌다.
 */
const selectBase = async (
	next: string,
	opts: { persist: boolean },
): Promise<void> => {
	if (next === compareBase) return;
	compareBase = next;
	if (opts.persist) localStorage.setItem(compareBaseKey(repo), next);
	syncPickerLabel();
	// 쿼리 의미가 바뀌므로 조건부 요청을 끊는다 (untracked 토글과 같은 이유).
	lastEtag = null;
	await load();
};

// 피커/카드에서 사용자가 직접 고른 경로. 고른 값이 지금과 같아도 패널은
// 닫고 포커스를 돌려줘야 하므로 그 둘이 조기 반환보다 앞에 온다.
const applySelection = async (next: string): Promise<void> => {
	setPickerOpen(false);
	pickerBtn?.focus();
	await selectBase(next, { persist: true });
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

// 네이티브 <select>가 공짜로 주던 키보드 조작을 되돌려 놓는다. 클릭 전용으로
// 두면 이 컨트롤만 마우스를 요구하게 된다.
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
		if (row) void applySelection(row.value);
	}
});

// 피커는 자기 dismiss를 갖는다 — 오버플로 메뉴의 리스너에 얹으면 한쪽을
// 고치다 다른 쪽이 조용히 깨진다.
document.addEventListener("mousedown", (event) => {
	if (!pickerPanel || pickerPanel.hidden) return;
	const target = event.target as Node;
	if (pickerPanel.contains(target) || pickerBtn?.contains(target)) return;
	setPickerOpen(false);
});

document.addEventListener("keydown", (event) => {
	if (!pickerPanel || pickerPanel.hidden) return;
	// 한글 등 조합 입력 중의 Escape는 조합 취소이지 팝오버 닫기가 아니다
	// (grab 팝오버와 같은 가드).
	if (event.isComposing || event.keyCode === 229) return;
	if (event.key !== "Escape") return;
	setPickerOpen(false);
	pickerBtn?.focus();
});

// URL이 저장된 선택을 이긴다. 레거시 `mode`는 **URL 레이어에서** base 값으로
// 승격시켜야 그 계약이 유지된다 — 저장된 선택 뒤로 내리면 한 번이라도 피커를
// 쓴 사용자에게는 statusline의 `?mode=base` 링크가 조용히 무시된다
// (link.ts는 지금도 mode를 발행한다).
const urlMode = params.get("mode");
const urlBase =
	params.get("base") ??
	(urlMode === "base" ? "@auto" : urlMode === "working" ? "HEAD" : null);
const storedLegacyMode = localStorage.getItem("cc-statusline:diff-mode");
// `?base=`(빈 값)는 resolveCompareBase가 "없음"으로 치므로 여기서도 같은
// 규칙을 써야 판정이 어긋나지 않는다 — URL이 이겼는지를 실제로 이긴 값으로
// 정한다. 저장된 값에서 왔을 때만 자가복구가 돈다.
const urlChoice = urlBase !== null && urlBase !== "" ? urlBase : null;
const compareBaseFromStorage = urlChoice === null;
compareBase =
	resolveCompareBase(urlChoice, (k) => localStorage.getItem(k), repo) ??
	(storedLegacyMode === "base" ? "@auto" : "HEAD");
syncPickerLabel();

// Apply persisted file-tree side and reflect stored prefs in the overflow menu.
appEl.dataset.treeSide = treeSide;

// Draggable/keyboard-resizable sidebar width. Lives in the --vd-tree-w CSS
// custom property (index.html's grid reads it via var(--vd-tree-w, 300px));
// computeDragWidth/computeKeyboardWidth (resize.ts) do the math, this block
// is just event plumbing + persistence.
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
	// preventDefault() stops text selection while dragging, but it also
	// suppresses the browser's default focus-on-mousedown -- restore it
	// explicitly so a mouse drag leaves the resizer focused for immediate
	// keyboard follow-up (matches what a plain click/tab would do).
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

// 토글해도 메뉴는 열린 채 유지한다(연속 조작). 트리가 오른쪽일 때는 열린
// 메뉴가 트리 상단 일부를 덮어 flatten 변화가 즉시 안 보일 수 있지만,
// 메뉴를 닫으면(바깥 클릭/Esc) 적용돼 있다.
treeSideInput?.addEventListener("change", () => {
	treeSide = treeSideInput.checked ? "right" : "left";
	appEl.dataset.treeSide = treeSide;
	localStorage.setItem(TREE_SIDE_KEY, treeSide);
});

flattenInput?.addEventListener("change", () => {
	flattenDirs = flattenInput.checked;
	localStorage.setItem(FLATTEN_KEY, flattenDirs ? "1" : "0");
	// flattenEmptyDirectories is a constructor option, so the tree must be
	// recreated; force a rebuild on the next render. 서버 데이터는 그대로라
	// 재fetch 없이 마지막 파일 목록으로 재렌더한다.
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

// Hide/show the file-tree sidebar: session-only (no localStorage — every
// fresh load starts visible unless launched with --hide-tree). The toolbar
// button and the overflow-menu checkbox both drive (and reflect) the same
// state through this one setter, so they can never drift out of sync.
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

// 버전은 /api/ping이 헤더로 보고한다 — 이 라우트가 존재하는 이유가 바로
// 그것이다(장수 데몬이 디스크의 패키지보다 오래 살 수 있어, 클라이언트가
// 자기가 기대하는 버전과 대조하라고 pid·version을 싣는다).
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

// Toolbar search button: opens the find bar (same as Cmd/Ctrl+F) for discoverability.
document
	.getElementById("find-open")
	?.addEventListener("click", () => findBar?.open());

void load();

const WATCH_POLL_MS = 2000;
let watchTimer: ReturnType<typeof setInterval> | null = null;

// 인플라이트 가드: 대형 diff에서 서버 응답이 폴 주기(2s)를 넘길 때 요청이
// 겹겹이 쌓이지 않게 한다. poll끼리만 막는다 — 사용자 액션 경로(load():
// focus/refresh/토글)는 의도된 즉시 갱신이라 막지 않으며, 동시 실행돼도
// 다음 폴 사이클에서 최신 상태로 수렴한다.
let pollInFlight = false;

const poll = async (): Promise<void> => {
	if (pollInFlight) return;
	pollInFlight = true;
	// watch 중에는 focus가 발화하지 않으므로 여기서도 정체성을 갱신한다.
	// 빠지면 diff만 새 브랜치 것으로 갈리고 라벨·탭 제목은 옛 브랜치에 굳는다
	// (refreshRepoLabel의 주석에 근거와 비용 계산이 있다).
	void refreshRepoLabel();
	try {
		const result = await fetchDiff();
		if (result === null) return;
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

// URL 플래그 또는 저장된 watch 상태 복원 (ON이면 폴링 시작). 세션 전용:
// localStorage에는 쓰지 않는다 (사용자가 토글해야 영속화됨).
if (
	watchInput &&
	resolveWatch(params.get("watch"), (k) => localStorage.getItem(k))
) {
	watchInput.checked = true;
	startWatch();
}

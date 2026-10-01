import type { WorktreeRecord } from "../server/refs.ts";

const APP_NAME = "diffdeck";

// emptyState.ts의 맥락 줄과 같은 구분자다.
const SEPARATOR = " · ";

// `rev-parse --short`(core.abbrev auto)와 한 글자 갈릴 수 있지만 빈 상태 카드
// 쪽을 7자로 자르지 않는다 — auto는 git이 고른 모호하지 않은 길이다.
const SHORT_OID_LENGTH = 7;

const SCOPE_SEPARATOR = " / ";

const BARE_SUFFIX = ".git";

export interface RepoLabelSelection {
	head: string | null;
}

// 조각은 구분자를 품는다(`"repo / "`, `" · main"`) — 마크업의 span 사이에 공백
// 노드를 두지 않는다. "모름"은 빈 문자열이다.
export interface RepoLabelView {
	scope: string;
	name: string;
	branch: string;
	title: string;
	documentTitle: string;
}

const stripTrailingSlashes = (path: string): string => path.replace(/\/+$/, "");

export const repoDisplayName = (path: string): string => {
	const trimmed = stripTrailingSlashes(path);
	const slash = trimmed.lastIndexOf("/");
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

// 세그먼트 경계의 최장 접두 일치다 — `repo`(기동한 cwd)는 하위 디렉토리일 수
// 있고, 중첩 워크트리에서는 안쪽이 이겨야 한다.
export const findWorktree = (
	worktrees: readonly WorktreeRecord[],
	repo: string,
): WorktreeRecord | null => {
	const target = stripTrailingSlashes(repo);
	let best: WorktreeRecord | null = null;
	let bestLength = -1;
	for (const worktree of worktrees) {
		const path = stripTrailingSlashes(worktree.path);
		if (path !== target && !target.startsWith(`${path}/`)) continue;
		if (path.length > bestLength) {
			best = worktree;
			bestLength = path.length;
		}
	}
	return best;
};

// detached는 빈 상태 카드와 같은 어휘(`detached @ <oid>`)다. `/api/refs`의
// head는 full OID라 여기서 자른다.
const branchOf = (worktree: WorktreeRecord | null): string | null => {
	if (worktree === null) return null;
	if (worktree.branch) return worktree.branch;
	if (worktree.head) {
		return `detached @ ${worktree.head.slice(0, SHORT_OID_LENGTH)}`;
	}
	return null;
};

// bare 리포는 루트가 `myproj.git`이라 관례적 `.git` 접미를 벗긴다.
const repoRootName = (repoRoot: string | null): string | null => {
	if (repoRoot === null) return null;
	const raw = repoDisplayName(stripTrailingSlashes(repoRoot));
	const name = raw.endsWith(BARE_SUFFIX)
		? raw.slice(0, -BARE_SUFFIX.length)
		: raw;
	// 이름을 못 내는 루트(`/`)에 접두를 붙이면 라벨이 `" / feat"`로 시작한다.
	return name === "" ? null : name;
};

// 메인 워크트리면 접두를 생략한다(`diffdeck / diffdeck`이 되지 않게).
const scopeNameOf = (repoRoot: string | null, path: string): string | null =>
	repoRoot !== null && stripTrailingSlashes(repoRoot) === path
		? null
		: repoRootName(repoRoot);

const suffixOf = (parts: readonly (string | null)[]): string =>
	parts
		.filter((p): p is string => p !== null && p !== "")
		.map((p) => `${SEPARATOR}${p}`)
		.join("");

// 워크트리 목록이 오기 전에도 이름은 URL로 바로 말한다 — 라벨을 hidden으로
// 토글하지 않는다.
export const repoLabelView = (
	repo: string,
	worktrees: readonly WorktreeRecord[],
	repoRoot: string | null,
	selection: RepoLabelSelection = { head: null },
): RepoLabelView => {
	// 브랜치를 head로 보면 어느 워크트리에서 보든 같은 diff라 워크트리 조각을
	// 빼고 head가 이름 자리를 갖는다. 브랜치 이름이 `/`를 품으므로 ` / ` 대신
	// ` · `로 잇는다.
	if (selection.head !== null) {
		const scope = repoRootName(repoRoot);
		const root = repoRoot === null ? repo : stripTrailingSlashes(repoRoot);
		return {
			scope: scope === null ? "" : `${scope}${SEPARATOR}`,
			name: selection.head,
			branch: "",
			title: `${root}${SEPARATOR}${selection.head}`,
			documentTitle: `${selection.head} — ${APP_NAME}`,
		};
	}
	const worktree = findWorktree(worktrees, repo);
	// `repo`가 하위 디렉토리일 수 있어 워크트리 최상위 경로의 이름을 쓴다.
	const path = stripTrailingSlashes(worktree?.path ?? repo);
	const name = repoDisplayName(path);
	const branch = branchOf(worktree);
	const scope = scopeNameOf(repoRoot, path);

	const title = `${path}${suffixOf([branch])}`;
	// 탭 제목에는 리포 접두를 넣지 않는다 — 탭은 오른쪽부터 잘리고 리포 이름은
	// 워크트리마다 같아 탭을 가르지 못한다.
	const head = branch === null ? name : `${name}${SEPARATOR}${branch}`;

	return {
		scope: scope === null ? "" : `${scope}${SCOPE_SEPARATOR}`,
		name,
		branch: suffixOf([branch]),
		title,
		documentTitle: name === "" ? APP_NAME : `${head} — ${APP_NAME}`,
	};
};

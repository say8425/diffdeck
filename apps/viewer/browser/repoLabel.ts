/**
 * 툴바의 리포·브랜치 표식 — "지금 **어느 워크트리의 무엇**을 보고 있는가".
 *
 * 왜 있나: 뷰어는 repo를 URL 파라미터로만 받아서, 워크트리를 여럿 쓰는
 * 리포에서 엉뚱한 워크트리를 열어도 화면에 단서가 하나도 없었다. 게다가
 * 뒤처진 브랜치에서는 어떤 base를 골라도 merge-base가 HEAD라 결과가 전부
 * 같아 보여서("피커를 바꿔도 화면이 안 변한다") 고장으로 오인하기 쉽다.
 * 정체성을 상시로 말해 두면 그 오진이 애초에 생기지 않는다.
 *
 * 왜 `main.ts`가 아니라 별도 모듈인가: `main.ts`는 커버리지 게이트 밖이라
 * (bunfig.toml의 `coveragePathIgnorePatterns`) 거기 문자열 조립을 두면 게이트가
 * 100% 초록인 채로 버그가 산다 — `isLargeFile`/`countChangedLines` 사건과
 * 정확히 같은 구조다(CLAUDE.md). 이 파일은 게이트 **안**이라 분기마다 유닛이
 * 붙는다. 그래서 **DOM에 닿는 문자열 전부**를 여기서 만들고 main.ts는 배선만 한다.
 *
 * 타입체크는 어느 쪽도 못 본다 — `apps/viewer/tsconfig.json`의 include는
 * `server/**`·`cli.ts`·`cli/**`·`build.ts`뿐이라 `browser/**` 전체가 루프 밖이고
 * 이 파일도 예외가 아니다. 방어는 유닛과 e2e뿐이라고 읽어야 한다.
 */
import type { WorktreeRecord } from "../server/refs.ts";

/** 탭 제목 끝에 붙는 앱 이름. */
const APP_NAME = "diffdeck";

/** 조각 구분자. `emptyState.ts`의 `contextParts.join(" · ")`와 같은 어휘다. */
const SEPARATOR = " · ";

/**
 * detached HEAD에서 보여줄 OID 길이. git이 오래 써 온 고전적 짧은 길이다.
 *
 * `git rev-parse --short`의 기본값과 **같지 않다** — 그쪽은 `core.abbrev`(기본
 * auto)를 따라 객체 수에 비례해 길어진다(실측: 3.5k 객체 리포는 7자, 37k 객체
 * 리포는 8자). 빈 상태 카드는 서버가 `--short`로 줄인 값을 그대로 쓰므로
 * (`summary.ts` → `emptyState.ts`) 큰 리포에서 두 표시가 한 글자 갈릴 수 있다.
 * 그걸 맞추자고 카드 쪽을 7자로 자르지는 않는다 — auto abbrev는 git이 **모호하지
 * 않은 길이**를 고른 결과라, 잘라내면 화면이 모호한 OID를 말하게 된다. 둘 다
 * 같은 커밋의 옳은 접두사이므로 이 차이는 받아들인다.
 */
const SHORT_OID_LENGTH = 7;

/** 리포와 워크트리를 가르는 구분자. 경로처럼 읽히라고 슬래시를 쓴다. */
const SCOPE_SEPARATOR = " / ";

/** bare 저장소 디렉토리의 관례적 접미 — 리포 이름에서는 벗긴다. */
const BARE_SUFFIX = ".git";

/** 화면 각 자리에 그대로 들어가는 문자열들. 조립은 전부 이 모듈이 끝낸다. */
export interface RepoLabelView {
	/**
	 * `#repo-scope`의 텍스트 — 이 워크트리를 품은 리포. 구분자를 품는다
	 * (`"diffdeck / "`). 메인 워크트리이거나 리포 루트를 모르면 빈 문자열.
	 */
	scope: string;
	/** `#repo-name`의 텍스트. 빈 문자열이면 라벨이 아무 말도 하지 않는다. */
	name: string;
	/** `#repo-branch`의 텍스트. 구분자를 품는다(`" · main"`). 모르면 빈 문자열. */
	branch: string;
	/** `#repo-label`의 `title` — 말줄임된 라벨을 hover로 편다. */
	title: string;
	/** `document.title`. 워크트리를 여럿 열어 두면 탭만으로 구별돼야 한다. */
	documentTitle: string;
}

const stripTrailingSlashes = (path: string): string => path.replace(/\/+$/, "");

/**
 * 경로의 마지막 세그먼트. 루트와 빈 문자열에는 이름이 없다(빈 문자열).
 */
export const repoDisplayName = (path: string): string => {
	// 후행 슬래시를 먼저 벗긴다 — `/a/b/`의 이름은 `b`지 빈 문자열이 아니다.
	const trimmed = stripTrailingSlashes(path);
	const slash = trimmed.lastIndexOf("/");
	return slash === -1 ? trimmed : trimmed.slice(slash + 1);
};

/**
 * `repo`가 속한 워크트리를 찾는다.
 *
 * **정확 일치만 보면 안 된다.** `repo`는 CLI 기동 시점의 `process.cwd()`라
 * (`cli.ts`) 리포 루트라는 보장이 없다 — 하위 디렉토리에서 켜면 정확 일치가
 * 실패해 브랜치가 조용히 사라진다. 그래서 경로를 품는 워크트리 중 **가장 긴**
 * 것을 고른다: 중첩 워크트리(`<repo>/.claude/worktrees/*` 관례)에서 바깥
 * 리포가 이기면 라벨이 엉뚱한 워크트리를 말하게 되는데, 그게 바로 이 기능이
 * 없애려는 혼동이다.
 *
 * 비교는 **세그먼트 경계**에서만 한다 — 맨 접두 비교는 `/w/a`가 `/w/abc`를
 * 자기 하위로 삼는다.
 */
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

/**
 * 사람이 읽을 브랜치 표시. detached는 `emptyState.ts:42-43`과 **같은 어휘**를
 * 쓴다 — 같은 사실을 화면 두 곳이 다르게 말하면 안 된다. `/api/refs`의 head는
 * full OID라(요약 API와 달리 `--short`를 안 거친다) 여기서 잘라 맞춘다.
 */
const branchOf = (worktree: WorktreeRecord | null): string | null => {
	if (worktree === null) return null;
	if (worktree.branch) return worktree.branch;
	if (worktree.head) {
		return `detached @ ${worktree.head.slice(0, SHORT_OID_LENGTH)}`;
	}
	return null;
};

/**
 * 툴바 라벨과 탭 제목에 들어갈 문자열 일습.
 *
 * 워크트리 목록이 아직 안 왔거나(부트스트랩 첫 프레임) `/api/refs`가 실패해도
 * **이름은 즉시 말한다** — repo 경로는 URL에 이미 있기 때문이다. 그래서 라벨을
 * `hidden`으로 토글할 일이 없고, author `display`와 `[hidden]` 짝을 잊는
 * 함정(CLAUDE.md — `#grab-popover`·`.grab-hint`에서 두 번 밟았다)에 애초에
 * 들어가지 않는다. "모름"은 hidden이 아니라 **빈 텍스트**다.
 */
/**
 * 이 워크트리를 품은 리포의 표시 이름. 메인 워크트리에 있으면 null —
 * 자기 자신을 접두로 되풀이하면 `diffdeck / diffdeck`이 된다.
 *
 * bare 리포에서는 루트가 저장소 디렉토리(`myproj.git`)라 관례적 `.git` 접미를
 * 벗긴다. 평범한 리포의 디렉토리가 `.git`으로 끝나는 일은 사실상 없다.
 */
const scopeNameOf = (repoRoot: string | null, path: string): string | null => {
	if (repoRoot === null) return null;
	const root = stripTrailingSlashes(repoRoot);
	if (root === path) return null;
	const raw = repoDisplayName(root);
	const name = raw.endsWith(BARE_SUFFIX)
		? raw.slice(0, -BARE_SUFFIX.length)
		: raw;
	// 이름을 못 내는 루트(`/`)에 접두를 붙이면 라벨이 `" / feat"`로 시작한다.
	return name === "" ? null : name;
};

export const repoLabelView = (
	repo: string,
	worktrees: readonly WorktreeRecord[],
	repoRoot: string | null,
): RepoLabelView => {
	const worktree = findWorktree(worktrees, repo);
	// 워크트리를 찾았으면 그 **최상위 경로**의 이름이 옳다. `repo`가 하위
	// 디렉토리일 때 그 basename은 `viewer` 같은 엉뚱한 값이다.
	const path = stripTrailingSlashes(worktree?.path ?? repo);
	const name = repoDisplayName(path);
	const branch = branchOf(worktree);
	const scope = scopeNameOf(repoRoot, path);

	const title = branch === null ? path : `${path}${SEPARATOR}${branch}`;
	// 탭 제목에는 접두를 넣지 않는다. 탭은 좁고 오른쪽부터 잘리는데, 리포
	// 이름은 그 리포의 워크트리마다 **같아서** 탭을 가르지 못한다 — 구별되는
	// 쪽(워크트리·브랜치)을 앞세워야 탭만 보고 고를 수 있다. 전체 맥락은
	// 툴바 라벨과 그 title이 진다.
	const head = branch === null ? name : `${name}${SEPARATOR}${branch}`;

	return {
		scope: scope === null ? "" : `${scope}${SCOPE_SEPARATOR}`,
		name,
		branch: branch === null ? "" : `${SEPARATOR}${branch}`,
		title,
		documentTitle: name === "" ? APP_NAME : `${head} — ${APP_NAME}`,
	};
};

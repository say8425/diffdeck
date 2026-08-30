/**
 * 피커가 고를 수 있는 것들 — 살아 있는 워크트리와 참조 — 의 목록.
 *
 * git 호출 두 번이면 끝난다. 브랜치와 워크트리를 잇는 것은 UI가 지어낸
 * 개념이 아니라 git이 이미 갖고 있는 관계다: `%(worktreepath)`가 브랜치마다
 * 그것을 물고 있는 워크트리를 알려준다.
 */
import { $ } from "bun";

export interface WorktreeRecord {
	path: string;
	/** 짧은 브랜치명. detached면 null. */
	branch: string | null;
	head: string | null;
	detached: boolean;
}

export interface RefRecord {
	name: string;
	kind: "local" | "remote";
	/** 이 참조를 물고 있는 **살아 있는** 워크트리의 경로. 없으면 null. */
	worktreePath: string | null;
}

export interface RefsResult {
	worktrees: WorktreeRecord[];
	refs: RefRecord[];
	defaultBranch: string | null;
	/**
	 * 리포의 메인 워크트리 경로(bare면 그 저장소 디렉토리). 툴바가 "어느
	 * 리포의 어느 워크트리인가"를 말하려면 워크트리 경로만으로는 부족해서
	 * 필요하다 — `worktrees[]`로는 알 수 없다(아래 `parseRepoRoot` 참고).
	 */
	repoRoot: string | null;
}

const REMOTES_PREFIX = "refs/remotes/";
const HEADS_PREFIX = "refs/heads/";

/**
 * `git worktree list --porcelain -z` 파싱.
 *
 * 실측 형식(git 2.54.0): 속성 한 줄마다 NUL이 붙고 레코드 사이는 빈 항목이다.
 * 속성은 `key value` 또는 홀로 선 불리언 단어(`detached`, `bare`)다.
 */
export const parseWorktreeList = (raw: string): WorktreeRecord[] => {
	const out: WorktreeRecord[] = [];
	let path: string | null = null;
	let branch: string | null = null;
	let head: string | null = null;
	let detached = false;
	let usable = true;

	const flush = (): void => {
		if (path && usable) out.push({ path, branch, head, detached });
		path = null;
		branch = null;
		head = null;
		detached = false;
		usable = true;
	};

	for (const token of raw.split("\0")) {
		if (token === "") {
			flush();
			continue;
		}
		if (token.startsWith("worktree ")) path = token.slice("worktree ".length);
		else if (token.startsWith("HEAD ")) head = token.slice("HEAD ".length);
		else if (token.startsWith(`branch ${HEADS_PREFIX}`))
			branch = token.slice(`branch ${HEADS_PREFIX}`.length);
		else if (token === "detached") detached = true;
		// bare에는 워킹트리가 없고, prunable은 디렉토리가 이미 사라진 등록이다.
		// 둘 다 고를 수 있게 두면 존재하지 않는 경로로 데려간다.
		else if (token === "bare" || token.startsWith("prunable")) usable = false;
	}
	flush();
	return out;
};

/**
 * 같은 원본에서 **메인 워크트리 경로**를 읽는다. git 호출을 늘리지 않는다.
 *
 * git은 메인 워크트리를 항상 첫 레코드로 낸다 — 링크된 워크트리나 중첩
 * 워크트리에서 명령을 실행해도 그렇다(실측: 평범·bare·중첩 셋 다).
 *
 * **`parseWorktreeList`의 결과를 대신 쓰면 안 된다.** 그쪽은 bare와 prunable을
 * 걸러내는데(고를 수 있게 두면 워킹트리 없는 경로로 데려간다), bare 리포는
 * 메인 항목이 바로 그 bare라 첫 항목이 링크된 워크트리로 밀린다 — 그러면
 * 라벨이 남의 워크트리 이름을 리포 이름이라고 말한다(실측으로 확인했다).
 * 여기서는 필터를 타지 않은 원본의 첫 `worktree ` 토큰을 그대로 쓴다.
 */
export const parseRepoRoot = (raw: string): string | null => {
	for (const token of raw.split("\0")) {
		if (token.startsWith("worktree ")) return token.slice("worktree ".length);
	}
	return null;
};

const REF_FIELDS = 4;

/**
 * `for-each-ref --format=%(refname)%00%(refname:short)%00%(worktreepath)%00%(symref)%00` 파싱.
 *
 * 필드 구분자가 NUL인 이유: git은 refname에 `|`를 허용한다(실측 — `weird|pipe`
 * 브랜치를 만들어 확인했다). 레코드 사이에는 git이 리터럴 개행을 하나 끼워
 * 넣는데, refname에는 개행이 못 들어가므로 필드마다 선행 개행 하나만 벗기면
 * 안전하다.
 *
 * `liveWorktrees`와 교차 확인하는 것이 핵심이다: for-each-ref는 **이미 삭제된**
 * 워크트리 경로도 그대로 실어 보낸다(실측).
 */
export const parseRefList = (
	raw: string,
	liveWorktrees: ReadonlySet<string>,
): { refs: RefRecord[]; defaultBranch: string | null } => {
	const fields = raw
		.split("\0")
		.map((f) => (f.startsWith("\n") ? f.slice(1) : f));
	// 포맷이 %00으로 끝나므로 후행 빈 항목이 정확히 하나 생긴다. 전부
	// 벗기면 마지막 필드(symref)가 정당하게 비어 있는 레코드까지 먹어
	// 치워서 레코드가 통째로 사라진다.
	if (fields.at(-1) === "") fields.pop();

	const refs: RefRecord[] = [];
	let defaultBranch: string | null = null;

	for (let i = 0; i + REF_FIELDS <= fields.length; i += REF_FIELDS) {
		const [refname = "", short = "", worktreePath = "", symref = ""] =
			fields.slice(i, i + REF_FIELDS);
		// refs/remotes/<remote>/HEAD는 브랜치가 아니라 기본 브랜치를 가리키는
		// 심볼릭 참조다. 짧게 쓰면 그냥 "origin"이라 목록에 두면 헛 항목이 된다.
		if (refname.startsWith(REMOTES_PREFIX) && refname.endsWith("/HEAD")) {
			if (symref.startsWith(REMOTES_PREFIX)) {
				const withRemote = symref.slice(REMOTES_PREFIX.length);
				const slash = withRemote.indexOf("/");
				if (slash !== -1) defaultBranch = withRemote.slice(slash + 1);
			}
			continue;
		}
		refs.push({
			name: short,
			kind: refname.startsWith(HEADS_PREFIX) ? "local" : "remote",
			worktreePath:
				worktreePath !== "" && liveWorktrees.has(worktreePath)
					? worktreePath
					: null,
		});
	}
	return { refs, defaultBranch };
};

const REF_FORMAT =
	"--format=%(refname)%00%(refname:short)%00%(worktreepath)%00%(symref)%00";

export const getRefs = async (repo: string): Promise<RefsResult> => {
	// 정렬을 붙이지 않는다. `%(committerdate)` 정렬은 참조마다 커밋 객체를
	// 읽게 만들어 브랜치가 많은 리포에서 비용을 지배한다 — 목록은 검색으로
	// 찾는 것이고, 기본(refname) 순서면 충분하다.
	const [wtRaw, refRaw] = await Promise.all([
		$`git -C ${repo} worktree list --porcelain -z`.nothrow().quiet().text(),
		$`git -C ${repo} for-each-ref ${REF_FORMAT} refs/heads refs/remotes`
			.nothrow()
			.quiet()
			.text(),
	]);
	const worktrees = parseWorktreeList(wtRaw);
	const live = new Set(worktrees.map((w) => w.path));
	const { refs, defaultBranch } = parseRefList(refRaw, live);
	return { worktrees, refs, defaultBranch, repoRoot: parseRepoRoot(wtRaw) };
};

import { gitText } from "./gitOutput.ts";

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
	/** 메인 워크트리 경로(bare면 저장소 디렉토리). `worktrees[]`로는 알 수 없다. */
	repoRoot: string | null;
}

const REMOTES_PREFIX = "refs/remotes/";
const HEADS_PREFIX = "refs/heads/";

/**
 * `git worktree list --porcelain -z`: 속성마다 NUL로 끝나고 레코드 사이는 빈 항목이다.
 * 속성은 `key value` 또는 불리언 단어(`detached`·`bare`)다.
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
		// bare는 워킹트리가 없고 prunable은 디렉토리가 사라진 등록이다 — 고르면 없는 경로로 간다.
		else if (token === "bare" || token.startsWith("prunable")) usable = false;
	}
	flush();
	return out;
};

/**
 * 메인 워크트리 경로 — git은 어디서 실행해도 메인을 첫 레코드로 낸다. 걸러낸
 * `parseWorktreeList` 결과를 쓰면 안 된다: bare 리포에서는 첫 항목이 링크된 워크트리가 된다.
 */
export const parseRepoRoot = (raw: string): string | null => {
	for (const token of raw.split("\0")) {
		if (token.startsWith("worktree ")) return token.slice("worktree ".length);
	}
	return null;
};

const REF_FIELDS = 4;

/**
 * `for-each-ref`(`REF_FORMAT`) 파싱. 필드 구분자가 NUL인 것은 git이 refname에 `|`를
 * 허용해서다. 레코드 사이에 끼는 개행은 필드마다 선행 개행 하나만 벗긴다(refname엔
 * 개행이 없다). `liveWorktrees`와 교차 확인한다 — for-each-ref는 삭제된 워크트리
 * 경로도 싣는다.
 */
export const parseRefList = (
	raw: string,
	liveWorktrees: ReadonlySet<string>,
): { refs: RefRecord[]; defaultBranch: string | null } => {
	const fields = raw
		.split("\0")
		.map((f) => (f.startsWith("\n") ? f.slice(1) : f));
	// 후행 빈 항목은 정확히 하나만 벗긴다 — 전부 벗기면 symref가 빈 마지막 레코드가 사라진다.
	if (fields.at(-1) === "") fields.pop();

	const refs: RefRecord[] = [];
	let defaultBranch: string | null = null;

	for (let i = 0; i + REF_FIELDS <= fields.length; i += REF_FIELDS) {
		const [refname = "", short = "", worktreePath = "", symref = ""] =
			fields.slice(i, i + REF_FIELDS);
		// refs/remotes/<remote>/HEAD는 브랜치가 아니라 기본 브랜치를 가리키는 심볼릭 참조다.
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
	// 정렬하지 않는다 — `%(committerdate)` 정렬은 참조마다 커밋 객체를 읽는다.
	const [wtRaw, refRaw] = await Promise.all([
		// 둘 다 `$`가 아니라 gitText — 출력이 참조·워크트리 수에 비례해 64KB를 넘을 수 있다.
		gitText(["-C", repo, "worktree", "list", "--porcelain", "-z"]),
		gitText([
			"-C",
			repo,
			"for-each-ref",
			REF_FORMAT,
			"refs/heads",
			"refs/remotes",
		]),
	]);
	const worktrees = parseWorktreeList(wtRaw);
	const live = new Set(worktrees.map((w) => w.path));
	const { refs, defaultBranch } = parseRefList(refRaw, live);
	return { worktrees, refs, defaultBranch, repoRoot: parseRepoRoot(wtRaw) };
};

/**
 * 브랜치 → PR. `gh pr list` 한 번으로 받아 head 브랜치 이름으로 묶는다(브랜치마다
 * `gh pr view`를 부르지 않는다). 부가 정보라 어떤 실패도 던지지 않는다.
 */
import { gitText } from "./gitOutput.ts";

export type PrState = "open" | "draft" | "merged" | "closed";

export interface PrRecord {
	number: number;
	title: string;
	state: PrState;
	url: string;
}

/** head 브랜치 이름(원격 접두 없음) → PR. */
export type PrsByBranch = Record<string, PrRecord>;

/** merged·closed는 리포 나이만큼 쌓이므로 최신순으로 이만큼만 받는다. */
export const PR_LIST_LIMIT = 100;

/** flight 안에서 돌므로 매달리면 flight 타임아웃까지 목록이 빈다 — 부가 정보라 짧게 끊는다. */
export const GH_TIMEOUT_MS = 10_000;

const GH_FIELDS =
	"number,title,headRefName,state,isDraft,url,isCrossRepository,headRepositoryOwner";

interface GhPr {
	number?: unknown;
	title?: unknown;
	headRefName?: unknown;
	state?: unknown;
	isDraft?: unknown;
	url?: unknown;
	isCrossRepository?: unknown;
	headRepositoryOwner?: unknown;
}

/**
 * 원격 URL의 소유자(`git@github.com:acme/api.git`·`https://github.com/acme/api`
 * → `acme`). 호스트는 보지 않는다 — GitHub Enterprise도 같은 모양이다.
 */
export const remoteOwner = (url: string): string | null =>
	/[:/]([^/:]+)\/[^/]+?(?:\.git)?\/?$/.exec(url.trim())?.[1] ?? null;

const ownerLogin = (owner: unknown): string | null =>
	owner !== null &&
	typeof owner === "object" &&
	typeof (owner as { login?: unknown }).login === "string"
		? (owner as { login: string }).login
		: null;

const stateOf = (pr: GhPr): PrState | null => {
	if (pr.state === "OPEN") return pr.isDraft === true ? "draft" : "open";
	if (pr.state === "MERGED") return "merged";
	if (pr.state === "CLOSED") return "closed";
	return null;
};

const isLive = (state: PrState): boolean =>
	state === "open" || state === "draft";

/**
 * 한 브랜치에 PR이 여럿이면 열린 것(draft 포함)이 이기고, 같은 부류끼리는 먼저 온 것
 * (`gh`가 최신순이라 가장 최근)이 이긴다. 남의 포크 PR은 뺀다 — 포크의 `main`이 우리
 * `main` 행에 붙는다. 단 `ownFork`(`origin` 소유자)의 PR은 남긴다: 포크 워크플로에서는
 * 내 PR이 전부 cross-repository로 온다.
 */
export const parsePrList = (
	raw: string,
	ownFork: string | null = null,
): PrsByBranch => {
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!Array.isArray(list)) return {};
	// 프로토타입 없는 객체 — 브랜치 이름이 `__proto__`·`constructor`일 수 있다.
	const out: PrsByBranch = Object.create(null) as PrsByBranch;
	for (const pr of list as GhPr[]) {
		if (pr === null || typeof pr !== "object") continue;
		if (
			pr.isCrossRepository === true &&
			(ownFork === null || ownerLogin(pr.headRepositoryOwner) !== ownFork)
		) {
			continue;
		}
		const state = stateOf(pr);
		if (
			state === null ||
			typeof pr.number !== "number" ||
			typeof pr.title !== "string" ||
			typeof pr.headRefName !== "string" ||
			typeof pr.url !== "string"
		) {
			continue;
		}
		const prev = out[pr.headRefName];
		if (prev && (isLive(prev.state) || !isLive(state))) continue;
		out[pr.headRefName] = {
			number: pr.number,
			title: pr.title,
			state,
			url: pr.url,
		};
	}
	return out;
};

/** `gh`를 실행해 stdout을 돌려준다. 실패는 전부 null이다. */
export type GhRunner = (
	repo: string,
	args: readonly string[],
) => Promise<string | null>;

export const runGh: GhRunner = async (repo, args) => {
	try {
		const proc = Bun.spawn(["gh", ...args], {
			cwd: repo,
			stdout: "pipe",
			stderr: "ignore",
			stdin: "ignore",
			timeout: GH_TIMEOUT_MS,
		});
		const out = await new Response(proc.stdout).text();
		return (await proc.exited) === 0 ? out : null;
	} catch {
		// `gh`가 설치돼 있지 않으면 스폰 자체가 ENOENT로 던진다.
		return null;
	}
};

/** `origin`의 URL. 없으면 빈 문자열(`remote get-url`이 실패로 끝난다). */
export const readOriginUrl = (repo: string): Promise<string> =>
	gitText(["-C", repo, "remote", "get-url", "origin"]);

/**
 * null은 "못 받았다"(`gh` 없음·인증 없음·GitHub 원격 아님·타임아웃)이고 빈 객체는
 * "PR이 없다"다 — 서버가 이것으로 실패만 짧게 캐시한다.
 */
export const getPrs = async (
	repo: string,
	run: GhRunner = runGh,
	originUrl: (repo: string) => Promise<string> = readOriginUrl,
): Promise<PrsByBranch | null> => {
	const [raw, origin] = await Promise.all([
		run(repo, [
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			String(PR_LIST_LIMIT),
			"--json",
			GH_FIELDS,
		]),
		originUrl(repo),
	]);
	return raw === null ? null : parsePrList(raw, remoteOwner(origin));
};

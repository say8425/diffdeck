/**
 * 브랜치 → 그 브랜치의 PR. 피커 행과 툴바 칩이 읽는다.
 *
 * `gh pr list` 한 번으로 리포의 최근 PR을 받아 head 브랜치 이름으로 묶는다.
 * 브랜치마다 `gh pr view`를 부르면 목록 길이만큼 네트워크 왕복이 생긴다.
 *
 * **부가 정보다** — `gh`가 없거나, 로그인이 안 됐거나, 원격이 GitHub이 아니거나,
 * 네트워크가 느리면 빈 결과를 돌려주고 화면은 PR 표시만 뺀다. 그래서 어떤
 * 실패도 던지지 않는다.
 */

export type PrState = "open" | "draft" | "merged" | "closed";

export interface PrRecord {
	number: number;
	title: string;
	state: PrState;
	url: string;
}

/** head 브랜치 이름(원격 접두 없음) → PR. */
export type PrsByBranch = Record<string, PrRecord>;

/**
 * 받아 올 PR 수의 상한. merged·closed는 리포 나이만큼 쌓이므로 전부 받지
 * 않는다 — 오래된 브랜치가 PR 표시를 잃는 것이 목록 전체를 느리게 하는 것보다
 * 낫다. `gh pr list`는 최신순으로 준다.
 */
export const PR_LIST_LIMIT = 100;

/**
 * `gh`를 기다리는 상한. 네트워크를 타므로 느릴 수 있는데, 이 호출은 flight
 * 안에서 돌기 때문에 매달리면 그 flight의 타임아웃(45초)까지 목록이 비어 있다.
 * 부가 정보에 그만큼 기다릴 이유가 없다.
 */
export const GH_TIMEOUT_MS = 10_000;

const GH_FIELDS =
	"number,title,headRefName,state,isDraft,url,isCrossRepository";

interface GhPr {
	number?: unknown;
	title?: unknown;
	headRefName?: unknown;
	state?: unknown;
	isDraft?: unknown;
	url?: unknown;
	isCrossRepository?: unknown;
}

const stateOf = (pr: GhPr): PrState | null => {
	if (pr.state === "OPEN") return pr.isDraft === true ? "draft" : "open";
	if (pr.state === "MERGED") return "merged";
	if (pr.state === "CLOSED") return "closed";
	return null;
};

/** 열려 있는 PR(draft 포함)이 끝난 PR보다 앞선다. */
const isLive = (state: PrState): boolean =>
	state === "open" || state === "draft";

/**
 * `gh pr list --json …` 출력을 브랜치별로 묶는다.
 *
 * 한 브랜치에 PR이 여럿이면(닫고 다시 연 경우) **열린 것**이 이기고, 둘 다
 * 열렸거나 둘 다 끝났으면 먼저 온 것 — `gh`가 최신순으로 주므로 가장 최근
 * 것이 이긴다.
 *
 * **포크에서 온 PR은 뺀다.** 그 head는 남의 리포 브랜치라 이름이 같아도 이
 * 리포의 브랜치가 아니다 — `main`에서 올린 포크 PR이 우리 `main` 행에 붙는다.
 */
export const parsePrList = (raw: string): PrsByBranch => {
	let list: unknown;
	try {
		list = JSON.parse(raw);
	} catch {
		return {};
	}
	if (!Array.isArray(list)) return {};
	// 프로토타입 없는 객체 — 브랜치 이름이 `__proto__`·`constructor`여도
	// 상속된 값을 "이미 있는 PR"로 읽거나 프로토타입을 바꾸지 않는다.
	const out: PrsByBranch = Object.create(null) as PrsByBranch;
	for (const pr of list as GhPr[]) {
		if (pr === null || typeof pr !== "object") continue;
		if (pr.isCrossRepository === true) continue;
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

/** `gh`를 실행해 stdout을 돌려준다. 실패는 전부 빈 문자열이다. */
export type GhRunner = (
	repo: string,
	args: readonly string[],
) => Promise<string>;

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
		return (await proc.exited) === 0 ? out : "";
	} catch {
		// `gh`가 설치돼 있지 않으면 스폰 자체가 ENOENT로 던진다.
		return "";
	}
};

export const getPrs = async (
	repo: string,
	run: GhRunner = runGh,
): Promise<PrsByBranch> =>
	parsePrList(
		await run(repo, [
			"pr",
			"list",
			"--state",
			"all",
			"--limit",
			String(PR_LIST_LIMIT),
			"--json",
			GH_FIELDS,
		]),
	);

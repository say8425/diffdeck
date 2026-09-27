import { existsSync } from "node:fs";
import { $ } from "bun";

/**
 * `repo` 파라미터가 왜 diff를 못 만드는가. 예전엔 전부 한 문장("not a git
 * repository")이었고 브라우저는 그마저 버리고 "Failed to load diff."만
 * 보여줬다 — 홈 디렉토리를 연 것인지, 지워진 워크트리를 연 것인지, git이
 * 아예 안 뜨는 것인지 화면에서 가를 방법이 없었다.
 *
 * 값은 응답의 `x-diff-error` 헤더로 나간다(unknown-base·unknown-head와 같은
 * 채널). 본문 문자열 매칭은 취약하므로 클라이언트는 이 표식만 읽는다.
 */
export type RepoProblem =
	| "no-repo" // URL에 repo가 없다
	| "repo-missing" // 그 경로가 디스크에 없다(삭제·이동된 워크트리)
	| "not-a-repo" // 있지만 git 워킹트리 밖이다
	| "no-worktree" // git 디렉토리 안이지만 워킹트리가 없다(bare, .git 내부)
	| "unsafe-repo" // 리포지만 소유자가 달라 git이 거부한다(safe.directory)
	| "git-unavailable"; // git을 띄우지 못했다(미설치, 서버 cwd 삭제)

export interface RevParseResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** 테스트 주입점 — 스폰 실패(throw)와 종료 코드를 흉내 낸다. */
export interface RepoCheckDeps {
	exists: (path: string) => boolean;
	revParse: (repo: string) => Promise<RevParseResult>;
}

const realRevParse = async (repo: string): Promise<RevParseResult> => {
	const out = await $`git -C ${repo} rev-parse --is-inside-work-tree`
		.nothrow()
		.quiet();
	return {
		exitCode: out.exitCode,
		stdout: out.stdout.toString(),
		stderr: out.stderr.toString(),
	};
};

export const REAL_REPO_CHECK_DEPS: RepoCheckDeps = {
	exists: existsSync,
	revParse: realRevParse,
};

/** diff를 만들 수 있으면 null, 아니면 그 이유. */
export const classifyRepo = async (
	repo: string,
	deps: RepoCheckDeps = REAL_REPO_CHECK_DEPS,
): Promise<RepoProblem | null> => {
	if (!repo) return "no-repo";
	// git보다 먼저 본다 — git은 없는 경로도 128("cannot change to")로 끝나서
	// "리포가 아니다"와 갈리지 않는다.
	if (!deps.exists(repo)) return "repo-missing";
	let result: RevParseResult;
	try {
		result = await deps.revParse(repo);
	} catch {
		// cwd가 삭제된 프로세스는 자식을 하나도 못 띄운다(posix_spawn ENOENT —
		// CLAUDE.md "프로세스 cwd가 삭제되면" 항목). 이 경우 모든 repo가 여기로
		// 온다.
		return "git-unavailable";
	}
	if (result.exitCode === 0) {
		// bare 리포와 .git 내부는 0으로 끝나며 `false`를 찍는다(실측).
		return result.stdout.trim() === "true" ? null : "no-worktree";
	}
	// 128은 git 자신의 fatal이다. 그 밖(셸의 command not found = 1 등)은 git이
	// 제대로 뜨지 않았다는 뜻이다.
	if (result.exitCode !== 128) return "git-unavailable";
	// 같은 128이어도 이건 리포가 **맞다** — "Not a git repository"라고 하면
	// 사용자가 엉뚱한 곳을 찾는다. 메시지는 로캘을 타지 않는 식별자
	// (`safe.directory`)로 가른다: git은 번역된 본문에도 그 설정 이름을
	// 그대로 싣는다.
	return result.stderr.includes("safe.directory")
		? "unsafe-repo"
		: "not-a-repo";
};

const MESSAGES: Record<RepoProblem, string> = {
	"no-repo": "missing repo parameter",
	"repo-missing": "no such directory",
	// not-a-repo만 예전 본문을 유지한다 — 외부 클라이언트가 읽고 있을 수 있다.
	// 나머지(repo 누락·없는 경로·…)는 예전에도 이 문자열이었지만 이제 각자
	// 이유를 말한다. 기계가 읽을 곳은 본문이 아니라 x-diff-error다.
	"not-a-repo": "not a git repository",
	"no-worktree": "git repository without a working tree",
	"unsafe-repo": "git refuses this repository (safe.directory)",
	"git-unavailable": "could not run git",
};

/** 네 라우트가 공유하는 400 응답. */
export const repoProblemResponse = (problem: RepoProblem): Response =>
	new Response(MESSAGES[problem], {
		status: 400,
		headers: { "x-diff-error": problem },
	});

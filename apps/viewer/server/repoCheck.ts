import { existsSync } from "node:fs";
import { $ } from "bun";

/**
 * diff를 못 만드는 이유. `x-diff-error` 헤더로 나가고, 클라이언트는 본문이 아니라
 * 이 표식을 읽는다.
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
	// git보다 먼저 본다 — git은 없는 경로도 128로 끝나 "리포가 아니다"와 갈리지 않는다.
	if (!deps.exists(repo)) return "repo-missing";
	let result: RevParseResult;
	try {
		result = await deps.revParse(repo);
	} catch {
		// cwd가 삭제된 프로세스는 자식을 못 띄운다(posix_spawn ENOENT — .claude/rules/server.md).
		return "git-unavailable";
	}
	if (result.exitCode === 0) {
		// bare 리포와 .git 내부는 0으로 끝나며 `false`를 찍는다.
		return result.stdout.trim() === "true" ? null : "no-worktree";
	}
	// 128은 git 자신의 fatal이다. 그 밖은 git이 제대로 뜨지 않았다는 뜻이다.
	if (result.exitCode !== 128) return "git-unavailable";
	// 같은 128이어도 리포는 맞다. 로캘을 타지 않는 설정 이름(`safe.directory`)으로 가른다 —
	// git은 번역된 메시지에도 그 이름을 그대로 싣는다.
	return result.stderr.includes("safe.directory")
		? "unsafe-repo"
		: "not-a-repo";
};

const MESSAGES: Record<RepoProblem, string> = {
	"no-repo": "missing repo parameter",
	"repo-missing": "no such directory",
	// 이 본문만 옛 문자열 그대로 둔다 — 외부 클라이언트가 읽고 있을 수 있다.
	"not-a-repo": "not a git repository",
	"no-worktree": "git repository without a working tree",
	"unsafe-repo": "git refuses this repository (safe.directory)",
	"git-unavailable": "could not run git",
};

/** repo를 받는 라우트(diff·summary·refs·prs·blob)가 공유하는 400 응답. */
export const repoProblemResponse = (problem: RepoProblem): Response =>
	new Response(MESSAGES[problem], {
		status: 400,
		headers: { "x-diff-error": problem },
	});

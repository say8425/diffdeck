/**
 * getDiffFiles를 돌리기 전에 싼 신호(status + rev-parse + 변경 파일 stat)로 "지난 응답
 * 이후 그대로"를 판정하는 지문. status 줄이 그대로여도 mtime/size가 내용 변경을 잡는다.
 * mtime 해상도보다 빠른 같은 크기 재작성은 놓칠 수 있지만 다음 변경에서 회복된다.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";
import { gitText } from "./gitOutput.ts";

export const repoFingerprint = async (
	repo: string,
	opts: {
		untracked?: boolean;
		mode?: "working" | "base";
		ref?: string;
		/** new 쪽 리비전. 없으면 워킹트리를 본다. */
		head?: string;
	} = {},
): Promise<string> => {
	const untrackedFlag = opts.untracked ? "-uall" : "-uno";
	const [status, head, baseRev, headRev] = await Promise.all([
		// `$`가 아니라 gitText — untracked를 켜면 출력이 64KB를 쉽게 넘고 watch가 자주 부른다.
		gitText(["-C", repo, "status", "--porcelain", "-z", untrackedFlag]),
		$`git -C ${repo} rev-parse HEAD 2>/dev/null`.nothrow().text(),
		opts.mode === "base" && opts.ref
			? $`git -C ${repo} rev-parse ${opts.ref} 2>/dev/null`.nothrow().text()
			: Promise.resolve(""),
		// head 브랜치가 움직이면 캐시가 깨져야 한다. 워킹트리 status는 그 뷰와 무관하지만
		// 그대로 둔다 — 여분의 재계산일 뿐 낡은 payload가 남는 방향은 아니다.
		opts.head
			? $`git -C ${repo} rev-parse ${opts.head} 2>/dev/null`.nothrow().text()
			: Promise.resolve(""),
	]);

	const parts: string[] = [
		String(opts.untracked ?? false),
		opts.mode ?? "working",
		status,
		head,
		baseRev,
		headRev,
	];

	// porcelain -z: `XY <path>\0` 토큰이고, R/C는 다음 토큰이 원본 경로다.
	const tokens = status.split("\0");
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (!token) continue;
		const xy = token.slice(0, 2);
		const path = token.slice(3);
		if (/[RC]/.test(xy)) i++;
		try {
			const st = statSync(join(repo, path));
			parts.push(`${path}\0${st.mtimeMs}\0${st.size}`);
		} catch {
			parts.push(`${path}\0gone`);
		}
	}
	return Bun.hash(parts.join("\x01")).toString(36);
};

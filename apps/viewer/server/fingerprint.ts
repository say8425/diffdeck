/**
 * 저렴한 리포 변경 지문(fingerprint). /api/diff의 파일별 git 서브프로세스
 * 파이프라인(getDiffFiles)을 돌리기 전에, 훨씬 싼 신호(git status 1회 +
 * rev-parse + 변경 파일 stat)로 "지난 응답 이후 아무것도 안 바뀌었다"를
 * 판정하기 위한 값이다. 지문이 같으면 파이프라인을 건너뛰고 캐시된 payload를
 * 그대로 재사용한다.
 *
 * 구성: status --porcelain(-z, untracked 여부 반영) + HEAD 리비전(+ base 모드는
 * base ref 리비전) + status에 오른 각 경로의 stat(mtime,size). status 라인이
 * 그대로여도(예: 이미 modified인 파일을 또 편집) mtime/size가 내용 변경을
 * 잡아낸다. mtime 해상도보다 빠른 동일 크기 재작성은 원리상 놓칠 수 있지만
 * (에디터/워처가 쓰는 표준 트레이드오프), 다음 실제 변경에서 자가 복구된다.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

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
		$`git -C ${repo} status --porcelain -z ${untrackedFlag} 2>/dev/null`
			.nothrow()
			.text(),
		$`git -C ${repo} rev-parse HEAD 2>/dev/null`.nothrow().text(),
		opts.mode === "base" && opts.ref
			? $`git -C ${repo} rev-parse ${opts.ref} 2>/dev/null`.nothrow().text()
			: Promise.resolve(""),
		// head가 브랜치면 그 브랜치가 움직였을 때 캐시가 깨져야 한다.
		// 반대로 워킹트리 status는 그 뷰와 무관하지만 그대로 둔다 — 여분의
		// 재계산이 생길 뿐이고, 낡은 payload가 눌러앉는 방향은 아니다.
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

	// porcelain -z: `XY <path>\0` 토큰, rename/copy(XY에 R/C)는 다음 토큰이
	// 원본 경로다. -z라 특수문자 경로도 C-quoting 없이 그대로 온다.
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

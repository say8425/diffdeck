import { $ } from "bun";
import { resolveDiffBaseRev } from "./diff.ts";

/**
 * 빈 diff 화면의 정보형 빈 상태 전용 경량 요약. diff가 0건일 때만 lazy하게
 * 호출되므로 캐시 없음. 개수 파싱은 전부 -z + NUL 분할 (비-ASCII/개행
 * 파일명 안전 — parseNameStatusZ와 같은 이유).
 */
export interface RepoSummary {
	branch: string | null;
	head: string;
	/** 표시용 이름 — origin/ 접두가 벗겨져 있다. */
	base: string | null;
	/**
	 * baseFiles를 **실제로 잰** 참조. `base`와 달리 접두가 살아 있어
	 * (`origin/main` vs `main`) 목록의 어느 행이 그 숫자의 주인인지
	 * 가릴 수 있다. 표시명으로 맞추면 로컬 동명 브랜치에 남의 숫자가 붙는다.
	 */
	ref: string | null;
	workingFiles: number;
	baseFiles: number | null;
	untrackedFiles: number;
	aheadCommits: number | null;
}

const countZ = (out: string): number =>
	out.split("\0").filter((s) => s !== "").length;

export const getRepoSummary = async (
	repo: string,
	opts: { base: string | null; ref: string | null },
): Promise<RepoSummary> => {
	const branch = (
		await $`git -C ${repo} branch --show-current 2>/dev/null`.nothrow().text()
	).trim();
	const head = (
		await $`git -C ${repo} rev-parse --short HEAD 2>/dev/null`.nothrow().text()
	).trim();
	const workingFiles = countZ(
		await $`git -C ${repo} diff --name-only -z HEAD 2>/dev/null`
			.nothrow()
			.text(),
	);
	const untrackedFiles = countZ(
		await $`git -C ${repo} ls-files --others --exclude-standard -z 2>/dev/null`
			.nothrow()
			.text(),
	);
	let baseFiles: number | null = null;
	let aheadCommits: number | null = null;
	if (opts.ref) {
		const mergeBase = await resolveDiffBaseRev(repo, {
			mode: "base",
			ref: opts.ref,
		});
		if (mergeBase) {
			baseFiles = countZ(
				await $`git -C ${repo} diff --name-only -z ${mergeBase} 2>/dev/null`
					.nothrow()
					.text(),
			);
			const ahead = (
				await $`git -C ${repo} rev-list --count ${`${mergeBase}..HEAD`} 2>/dev/null`
					.nothrow()
					.text()
			).trim();
			aheadCommits = /^\d+$/.test(ahead) ? Number(ahead) : null;
		}
	}
	return {
		branch: branch || null,
		head,
		base: opts.base,
		ref: opts.ref ?? null,
		workingFiles,
		baseFiles,
		untrackedFiles,
		aheadCommits,
	};
};

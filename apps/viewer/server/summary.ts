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
	/**
	 * 미커밋 변경 파일 수. head가 커밋된 리비전이면 **null**이다 — 그 뷰에서
	 * 워킹트리는 측정 대상이 아니고, 0으로 적으면 "아무것도 없다"는 **주장**이
	 * 되어 실제로는 변경이 있는데도 카드가 조용하다고 말하게 된다.
	 */
	workingFiles: number | null;
	baseFiles: number | null;
	/** untracked 파일 수. workingFiles와 같은 이유로 head가 rev면 null이다. */
	untrackedFiles: number | null;
	aheadCommits: number | null;
}

const countZ = (out: string): number =>
	out.split("\0").filter((s) => s !== "").length;

export const getRepoSummary = async (
	repo: string,
	opts: { base: string | null; ref: string | null; head?: string },
): Promise<RepoSummary> => {
	// head가 브랜치면 카드의 "on <branch>"는 그 브랜치를 말해야 한다 —
	// 워크트리의 브랜치를 말하면 보고 있지도 않은 곳을 가리킨다.
	const branch = opts.head
		? opts.head
		: (
				await $`git -C ${repo} branch --show-current 2>/dev/null`
					.nothrow()
					.text()
			).trim();
	const head = (
		await $`git -C ${repo} rev-parse --short ${opts.head ?? "HEAD"} 2>/dev/null`
			.nothrow()
			.text()
	).trim();
	// 커밋된 리비전에는 미커밋 변경도 untracked도 없다. 0이 아니라 null인
	// 이유는 위 필드 주석에 있다 — 재지 않은 것을 0으로 적으면 주장이 된다.
	const workingFiles = opts.head
		? null
		: countZ(
				await $`git -C ${repo} diff --name-only -z HEAD -- 2>/dev/null`
					.nothrow()
					.text(),
			);
	const untrackedFiles = opts.head
		? null
		: countZ(
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
			head: opts.head,
		});
		if (mergeBase) {
			// diff와 같은 축을 세야 카드가 화면과 다른 개수를 말하지 않는다.
			// 끝의 `--`는 diff.ts의 같은 이유다 — 참조 이름이 경로와 겹치면
			// `ambiguous argument`가 나고 nothrow가 그것을 0으로 삼킨다.
			baseFiles = countZ(
				opts.head
					? await $`git -C ${repo} diff --name-only -z ${mergeBase} ${opts.head} -- 2>/dev/null`
							.nothrow()
							.text()
					: await $`git -C ${repo} diff --name-only -z ${mergeBase} -- 2>/dev/null`
							.nothrow()
							.text(),
			);
			const ahead = (
				await $`git -C ${repo} rev-list --count ${`${mergeBase}..${opts.head ?? "HEAD"}`} 2>/dev/null`
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

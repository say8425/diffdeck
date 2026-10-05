import { resolveDiffBaseRev } from "./diff.ts";
import { gitText } from "./gitOutput.ts";

/** 빈 상태 카드용 요약. diff가 비었을 때만 불리므로 캐시하지 않는다. */
export interface RepoSummary {
	branch: string | null;
	head: string;
	/** 표시용 이름 — origin/ 접두가 벗겨져 있다. */
	base: string | null;
	/** baseFiles를 잰 참조. git에 넘긴 전체 refname이다(`refs/remotes/origin/main`). */
	ref: string | null;
	/**
	 * 미커밋 변경 파일 수. head가 커밋된 리비전이면 null이다 — 재지 않은 값을 0으로
	 * 적으면 카드가 "볼 것이 없다"고 주장한다.
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
	opts: {
		base: string | null;
		ref: string | null;
		/** git에 넘기는 전체 refname. */
		head?: string;
		/** 카드에 보일 이름 — 사용자가 고른 짧은 이름이다. */
		headName?: string;
	},
): Promise<RepoSummary> => {
	const branch = opts.head
		? (opts.headName ?? opts.head)
		: (await gitText(["-C", repo, "branch", "--show-current"])).trim();
	const head = (
		await gitText(["-C", repo, "rev-parse", "--short", opts.head ?? "HEAD"])
	).trim();
	const workingFiles = opts.head
		? null
		: countZ(
				await gitText(["-C", repo, "diff", "--name-only", "-z", "HEAD", "--"]),
			);
	const untrackedFiles = opts.head
		? null
		: countZ(
				await gitText([
					"-C",
					repo,
					"ls-files",
					"--others",
					"--exclude-standard",
					"-z",
				]),
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
			// 끝의 `--`는 diff.ts와 같은 계약이다 — ref 이름이 경로와 겹치면 git이 실패하고
			// gitText가 그것을 빈 출력(0개)으로 삼킨다.
			baseFiles = countZ(
				await gitText(
					opts.head
						? [
								"-C",
								repo,
								"diff",
								"--name-only",
								"-z",
								mergeBase,
								opts.head,
								"--",
							]
						: ["-C", repo, "diff", "--name-only", "-z", mergeBase, "--"],
				),
			);
			const ahead = (
				await gitText([
					"-C",
					repo,
					"rev-list",
					"--count",
					`${mergeBase}..${opts.head ?? "HEAD"}`,
				])
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

import type { PrRecord, PrsByBranch } from "../../server/prs.ts";
import type { RefRecord, WorktreeRecord } from "../../server/refs.ts";
import { prBranchOf, prFor } from "../prBadge.ts";
import { findWorktree, repoDisplayName } from "../repoLabel.ts";

export type RowSection = "worktrees" | "branches";

export interface HeadRow {
	kind: "worktree" | "local" | "remote";
	// worktree면 최상위 경로(그리로 이동한다), 브랜치면 참조 이름(head로 본다).
	value: string;
	label: string;
	section: RowSection;
	tag: "default" | null;
	note: string | null;
	selected: boolean;
	pr: PrRecord | null;
}

export interface CurrentHead {
	/** `repo` 파라미터. 리포 루트라는 보장이 없다(하위 디렉토리에서 기동). */
	repo: string;
	head: string | null;
}

const worktreeNote = (
	worktree: WorktreeRecord,
	defaultBranch: string | null,
): string | null => {
	if (!worktree.branch) return null;
	// 브랜치 구역과 같은 어휘로 `default`를 단다 — 왜 맨 위인지 읽히게.
	return worktree.branch === defaultBranch
		? `${worktree.branch} · default`
		: worktree.branch;
};

const worktreeRows = (
	worktrees: readonly WorktreeRecord[],
	defaultBranch: string | null,
	current: CurrentHead,
	prs: PrsByBranch,
): HeadRow[] => {
	// 고를 것이 없으면 구역을 내지 않는다(제목만 남은 빈 구역은 "뭔가 빠졌다"로
	// 읽힌다). head가 브랜치면 하나뿐인 워크트리도 남긴다 — 숨기면 브랜치 뷰에
	// 갇힌다.
	if (worktrees.length <= 1 && current.head === null) return [];
	// 라벨과 같은 판정(findWorktree)을 쓴다 — 답이 둘이면 어긋난다.
	const viewed =
		current.head === null ? findWorktree(worktrees, current.repo) : null;
	const rank = (worktree: WorktreeRecord): number => {
		if (defaultBranch !== null && worktree.branch === defaultBranch) return 0;
		return worktree === viewed ? 1 : 2;
	};
	return [...worktrees]
		.map((worktree, index) => ({ worktree, index }))
		.sort((a, b) => rank(a.worktree) - rank(b.worktree) || a.index - b.index)
		.map(({ worktree }) => ({
			kind: "worktree" as const,
			value: worktree.path,
			label: repoDisplayName(worktree.path),
			section: "worktrees" as const,
			tag: null,
			note: worktreeNote(worktree, defaultBranch),
			selected: worktree === viewed,
			pr: prFor(prs, worktree.branch),
		}));
};

const branchRows = (
	refs: readonly RefRecord[],
	defaultBranch: string | null,
	current: CurrentHead,
	prs: PrsByBranch,
): HeadRow[] => {
	const toRow = (record: RefRecord): HeadRow => {
		const isDefault = record.name === defaultBranch;
		return {
			kind: record.kind,
			value: record.name,
			label: record.name,
			section: "branches",
			tag: isDefault ? "default" : null,
			note: isDefault ? "default" : null,
			selected: record.name === current.head,
			// PR은 원격 접두 없는 이름으로 온다.
			pr: prFor(prs, prBranchOf(record.name, record.kind)),
		};
	};
	const rank = (record: RefRecord): number => {
		if (record.name === defaultBranch) return 0;
		if (record.name === current.head) return 1;
		return record.kind === "local" ? 2 : 3;
	};
	return [...refs]
		.map((record, index) => ({ record, index }))
		.sort((a, b) => rank(a.record) - rank(b.record) || a.index - b.index)
		.map(({ record }) => toRow(record));
};

export const buildHeadRows = (
	worktrees: readonly WorktreeRecord[],
	refs: readonly RefRecord[],
	defaultBranch: string | null,
	current: CurrentHead,
	prs: PrsByBranch = {},
): HeadRow[] => [
	...worktreeRows(worktrees, defaultBranch, current, prs),
	...branchRows(refs, defaultBranch, current, prs),
];

export const filterPickerRows = (
	rows: readonly HeadRow[],
	query: string,
): HeadRow[] => {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...rows];
	// 행에 보이는 글자는 전부 검색어다 — note(워크트리 행의 브랜치 이름)와 PR
	// 번호·제목도 본다.
	return rows.filter(
		(r) =>
			r.label.toLowerCase().includes(needle) ||
			(r.note ?? "").toLowerCase().includes(needle) ||
			(r.pr !== null &&
				(`#${r.pr.number}`.includes(needle) ||
					r.pr.title.toLowerCase().includes(needle))),
	);
};

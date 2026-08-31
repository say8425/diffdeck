/**
 * 피커가 보여줄 "무엇을 볼까" 목록의 순수 로직.
 *
 * **이 피커는 base가 아니라 head를 고른다.** 예전에는 "무엇과 견줄까"(base)를
 * 골랐는데, 그러면 목록에 뜬 브랜치 이름이 "그 브랜치를 보여줘"로 읽히면서
 * 실제로는 반대 축을 건드리는 어긋남이 생겼다 — 메인 워크트리에서 남의
 * 브랜치를 골라도 1 file만 나오던 것이 그 결과다. base는 이제 서버가
 * 해석한다(`@auto`).
 *
 * 두 구역은 고르면 **일어나는 일이 다르다**:
 * - 워크트리 → 그 워크트리로 **이동**한다(`repo` 파라미터가 바뀐다).
 * - 브랜치   → 그 브랜치를 head로 **본다**(`head` 파라미터, 커밋된 것만).
 *
 * DOM도 fetch도 모르므로 유닛으로 전부 덮인다 — 배선만 main.ts에 남는다.
 */
import type { RefRecord, WorktreeRecord } from "../../server/refs.ts";
import { findWorktree, repoDisplayName } from "../repoLabel.ts";

/** 목록의 두 구역. 종류가 다르다는 것을 화면에서 가르는 근거다. */
export type RowSection = "worktrees" | "branches";

export interface HeadRow {
	/**
	 * 고르면 무엇이 일어나는가.
	 * - `worktree` — 그 워크트리로 이동(`value`는 최상위 **경로**).
	 * - `local`/`remote` — 그 브랜치를 head로 본다(`value`는 참조 **이름**).
	 */
	kind: "worktree" | "local" | "remote";
	/** 워크트리면 최상위 경로, 브랜치면 참조 이름. */
	value: string;
	/** 화면에 보이는 이름. */
	label: string;
	section: RowSection;
	/** 맥락 표시. note에 합쳐져 오른쪽에 붙는다. */
	tag: "default" | null;
	/** 행 오른쪽 보조 텍스트. 워크트리는 **물고 있는 브랜치**가 여기 온다. */
	note: string | null;
	/** 지금 보고 있는 행. 값의 종류가 둘이라 비교를 모델이 끝낸다. */
	selected: boolean;
}

/** 지금 무엇을 보고 있는가. */
export interface CurrentHead {
	/** 뷰어가 연 경로(`repo` 파라미터). 리포 루트라는 보장은 없다. */
	repo: string;
	/** head로 고른 브랜치. 워크트리를 보고 있으면 null. */
	head: string | null;
}

const worktreeNote = (
	worktree: WorktreeRecord,
	defaultBranch: string | null,
): string | null => {
	if (!worktree.branch) return null;
	// 브랜치 구역과 같은 어휘로 `default`를 단다 — 왜 맨 위인지 읽히게.
	// ` · `로 잇는 것은 이 피커가 태그와 개수를 잇던 방식 그대로다.
	return worktree.branch === defaultBranch
		? `${worktree.branch} · default`
		: worktree.branch;
};

/**
 * 워크트리 구역. **고를 것이 없으면 구역 자체를 내지 않는다** — 제목만 남기고
 * 목록을 비우면 "뭔가 있어야 하는데 없다"로 읽힌다. 워크트리가 하나면 지금
 * 그것을 보고 있으므로 고를 것이 없다.
 *
 * 순서: default 브랜치를 물고 있는 워크트리 → 지금 보고 있는 것 → 받은 순서.
 */
const worktreeRows = (
	worktrees: readonly WorktreeRecord[],
	defaultBranch: string | null,
	current: CurrentHead,
): HeadRow[] => {
	// head가 브랜치면 워크트리는 "지금 보고 있지 않은 것"이라 고를 대상이다 —
	// 그때까지 숨기면 워크트리가 하나뿐인 리포에서 브랜치 뷰에 갇힌다.
	if (worktrees.length <= 1 && current.head === null) return [];
	// "내가 어느 워크트리에 있는가"는 repoLabel의 판정을 그대로 쓴다 — 답이
	// 앱 안에 둘 있으면 안 되고, repo가 하위 디렉토리일 때도 맞아야 한다.
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
		}));
};

/**
 * 브랜치 구역. 순서: default → 지금 보고 있는 브랜치 → 나머지(로컬 먼저).
 *
 * 올림은 **위치**로 판단한다 — 자기 브랜치가 default이기도 하면 태그는
 * `default`로 남지만 자리는 하나뿐이므로 중복해서 올리지 않는다.
 */
const branchRows = (
	refs: readonly RefRecord[],
	defaultBranch: string | null,
	current: CurrentHead,
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
): HeadRow[] => [
	...worktreeRows(worktrees, defaultBranch, current),
	...branchRows(refs, defaultBranch, current),
];

export const filterPickerRows = (
	rows: readonly HeadRow[],
	query: string,
): HeadRow[] => {
	const needle = query.trim().toLowerCase();
	if (needle === "") return [...rows];
	return rows.filter((r) => r.label.toLowerCase().includes(needle));
};

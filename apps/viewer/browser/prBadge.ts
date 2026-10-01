import type { PrRecord, PrState, PrsByBranch } from "../server/prs.ts";
import type { RefRecord } from "../server/refs.ts";

export const PR_STATE_LABEL: Record<PrState, string> = {
	open: "Open pull request",
	draft: "Draft pull request",
	merged: "Merged pull request",
	closed: "Closed pull request",
};

// 모양이 상태마다 달라야 한다 — 색을 못 가려도 구별된다.
const PR_ICON_PATHS: Record<PrState, string> = {
	open: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>',
	draft:
		'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6v2"/><path d="M18 11v1"/><line x1="6" y1="9" x2="6" y2="21"/>',
	merged:
		'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
	closed:
		'<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
};

// 입력이 열거값과 숫자뿐이라 innerHTML로 넣어도 안전하다.
export const prIconSvg = (state: PrState, size: number): string =>
	`<svg class="pr-icon" data-state="${state}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${PR_STATE_LABEL[state]}">${PR_ICON_PATHS[state]}</svg>`;

// 원격 이름에 `/`가 없다고 가정한다 — 있으면 대개 PR을 못 찾는다(틀린 PR을
// 달지는 않는다).
export const prBranchOf = (name: string, kind: RefRecord["kind"]): string =>
	kind === "remote" ? name.slice(name.indexOf("/") + 1) : name;

// head가 원격인지는 이름이 아니라 refs 목록으로 판정한다 — 첫 세그먼트를
// 무조건 벗기면 로컬 `fix/foo`가 `foo`의 PR을 단다.
export const viewedPrBranch = (
	head: string | null,
	worktreeBranch: string | null,
	refs: readonly RefRecord[],
): string | null => {
	// `HEAD`는 브랜치 이름이 아니라 이 워크트리의 커밋된 HEAD다.
	if (head === null || head === "HEAD") return worktreeBranch;
	const ref = refs.find((r) => r.name === head);
	return ref ? prBranchOf(ref.name, ref.kind) : head;
};

export const prFor = (
	prs: PrsByBranch,
	branch: string | null,
): PrRecord | null =>
	// `hasOwn` — 브랜치 이름이 `constructor`·`__proto__`여도 프로토타입을 줍지 않는다.
	branch !== null && Object.hasOwn(prs, branch) ? (prs[branch] ?? null) : null;

export interface PrChipView {
	href: string;
	state: PrState;
	number: string;
	title: string;
	tooltip: string;
	// 조각을 이어 붙인 이름은 브라우저마다 공백 처리가 달라 붙어 읽힐 수 있어
	// 한 문장으로 못 박는다.
	ariaLabel: string;
}

export interface ChipParts {
	icon: number;
	number: number;
	gap: number;
	padding: number;
	border: number;
}

// 칩이 줄어들 바닥(제목은 0까지 양보한다). 번호 길이가 PR마다 달라 CSS
// 상수로 못 적고 재서 건다.
export const chipMinWidth = (p: ChipParts): number =>
	Math.ceil(p.icon + p.gap + p.number + p.padding + p.border);

export const prChipView = (pr: PrRecord | null): PrChipView | null =>
	pr === null
		? null
		: {
				href: pr.url,
				state: pr.state,
				number: `#${pr.number}`,
				title: pr.title,
				tooltip: `#${pr.number} ${pr.title} — Open on GitHub`,
				ariaLabel: `${PR_STATE_LABEL[pr.state]} #${pr.number}: ${pr.title}`,
			};

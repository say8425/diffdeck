/**
 * PR 표시의 순수 로직 — 툴바 칩과 피커 행이 같은 어휘를 쓰게 한 곳에 둔다.
 *
 * 상태는 **아이콘 모양과 색 둘 다로** 가른다(Open·Draft·Merged·Closed가 전부
 * 다른 모양이다). 글자로 `Draft ·`를 덧붙이지 않는 대신 아이콘이 `role="img"`와
 * `aria-label`을 가져 보조기술에는 상태가 말로 전해진다.
 */
import type { PrRecord, PrState, PrsByBranch } from "../server/prs.ts";
import type { RefRecord } from "../server/refs.ts";

export const PR_STATE_LABEL: Record<PrState, string> = {
	open: "Open pull request",
	draft: "Draft pull request",
	merged: "Merged pull request",
	closed: "Closed pull request",
};

// 24×24 stroke 아이콘의 본체. 모양이 상태마다 달라서 색을 못 가려도 구별된다.
const PR_ICON_PATHS: Record<PrState, string> = {
	open: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" y1="9" x2="6" y2="21"/>',
	draft:
		'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M18 6v2"/><path d="M18 11v1"/><line x1="6" y1="9" x2="6" y2="21"/>',
	merged:
		'<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M6 21V9a9 9 0 0 0 9 9"/>',
	closed:
		'<circle cx="6" cy="6" r="3"/><path d="M6 9v12"/><path d="m21 3-6 6"/><path d="m21 9-6-6"/><path d="M18 11.5V15"/><circle cx="18" cy="18" r="3"/>',
};

/**
 * 상태 아이콘 마크업. 색은 CSS가 `data-state`로 입힌다(`currentColor`).
 * 입력이 열거값뿐이라 innerHTML로 넣어도 안전하다.
 */
export const prIconSvg = (state: PrState, size: number): string =>
	`<svg class="pr-icon" data-state="${state}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${PR_STATE_LABEL[state]}">${PR_ICON_PATHS[state]}</svg>`;

/**
 * 참조 이름에서 PR의 head 브랜치 이름을 얻는다. PR은 원격 접두 없는 이름으로
 * 오므로 `origin/feat/x`는 `feat/x`로 맞춘다. **원격 이름에 `/`가 없다고
 * 가정한다** — git은 `team/x` 같은 원격 이름을 허용하지만 드물고, 그 경우
 * `team/x/feat`가 `x/feat`의 PR을 찾아 대개 아무것도 못 찾는다(틀린 PR을 다는
 * 쪽이 아니라 못 다는 쪽으로 어긋난다).
 */
export const prBranchOf = (name: string, kind: RefRecord["kind"]): string =>
	kind === "remote" ? name.slice(name.indexOf("/") + 1) : name;

/**
 * 지금 보고 있는 브랜치. head를 골랐으면 그것(원격이면 접두를 벗긴다),
 * 아니면 이 워크트리가 물고 있는 브랜치다. detached면 null.
 *
 * head가 원격인지는 **목록으로** 판정한다 — 이름만 보고 첫 세그먼트를 벗기면
 * 로컬 `fix/foo`가 남의 브랜치 `foo`의 PR을 달게 된다.
 */
export const viewedPrBranch = (
	head: string | null,
	worktreeBranch: string | null,
	refs: readonly RefRecord[],
): string | null => {
	// `head=HEAD`는 "이 워크트리의 커밋된 HEAD"다 — 브랜치 이름이 아니라서
	// 그대로 찾으면 아무 PR도 없다. 가리키는 브랜치는 워크트리의 것이다.
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

/** 툴바 칩에 그대로 들어가는 값. null이면 칩을 숨긴다. */
export interface PrChipView {
	href: string;
	state: PrState;
	number: string;
	title: string;
	/** hover 툴팁. 제목이 말줄임돼도 여기서 전부 읽힌다. */
	tooltip: string;
	/**
	 * 링크의 접근 가능한 이름. 조각(아이콘·번호·제목)을 이어 붙인 이름은
	 * 브라우저마다 공백 처리가 달라 `#85feat:`처럼 붙어 읽힐 수 있어서 한
	 * 문장으로 못 박는다. 상태가 맨 앞이다 — 글자로는 보이지 않는 정보라서.
	 */
	ariaLabel: string;
}

/** `chipMinWidth`가 더하는 칩의 치수(px). main.ts가 실측해 넘긴다. */
export interface ChipParts {
	icon: number;
	number: number;
	gap: number;
	padding: number;
	border: number;
}

/**
 * 칩이 줄어들 수 있는 바닥 — 아이콘과 번호, 그 사이 간격과 상자 가장자리.
 * 제목은 여기서 빠진다(말줄임으로 0까지 양보한다). 번호 길이가 PR마다 달라
 * CSS 상수로는 못 적는다(index.html의 `#pr-chip` 주석).
 */
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

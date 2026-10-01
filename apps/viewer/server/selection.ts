/**
 * diff 선택(무엇을 무엇과 견주는가)의 단일 파서. /api/diff·/api/blob·/api/summary가
 * 각자 해석하면 텍스트 diff와 이미지가 다른 기준을 보게 된다.
 */

/** 무엇을 기준으로 견줄 것인가. */
export type BaseSelector =
	/** HEAD 대비 — 아직 커밋하지 않은 변경만 (레거시 `mode=working`). */
	| { kind: "head" }
	/** 서버가 해석한 base 브랜치 대비 (레거시 `mode=base`, 또는 `base=@auto`). */
	| { kind: "auto" }
	/** 사용자가 고른 참조 대비. */
	| { kind: "ref"; ref: string };

/** "서버가 골라라" 표식. 그냥 `auto`면 실제 `auto` 브랜치와 구별되지 않는다. */
export const AUTO_BASE = "@auto";

const parseBase = (params: URLSearchParams): BaseSelector => {
	const raw = params.get("base") ?? "";
	if (raw === AUTO_BASE) return { kind: "auto" };
	// HEAD는 ref가 아니라 head 종류로 정규화한다(중복처럼 보여도 지우지 않는다):
	// 커밋이 없는 리포에서는 `rev-parse --verify HEAD`가 실패해 첫 화면이 실패 카드가
	// 되고, `ref:HEAD`는 prewarm이 데운 것과 다른 캐시 슬롯이다.
	if (raw === "HEAD") return { kind: "head" };
	// base가 있으면 mode는 무시한다 — 새 파라미터가 이긴다는 규칙 하나로
	// `mode=working&base=main` 같은 모순을 없앤다.
	if (raw !== "") return { kind: "ref", ref: raw };
	// 알 수 없는 mode는 400이 아니라 working이다 — 밖에서 만든 오래된 링크가 깨지지 않게.
	return params.get("mode") === "base" ? { kind: "auto" } : { kind: "head" };
};

/** 무엇을 볼 것인가 — diff의 오른쪽(new) 항. base와 독립이다. */
export type HeadSelector =
	/** 워킹트리(기본값) — 커밋 안 한 변경이 보인다. */
	| { kind: "worktree" }
	/** 사용자가 고른 참조 — 커밋된 것만 보인다. */
	| { kind: "ref"; ref: string };

/**
 * `head=HEAD`는 base와 달리 정규화하지 않는다 — 커밋된 HEAD를 보는 것이라 워킹트리
 * 뷰와 달리 미커밋 변경이 빠진다.
 */
const parseHead = (params: URLSearchParams): HeadSelector => {
	const raw = params.get("head") ?? "";
	return raw === "" ? { kind: "worktree" } : { kind: "ref", ref: raw };
};

export interface Selection {
	repo: string;
	untracked: boolean;
	base: BaseSelector;
	head: HeadSelector;
}

/**
 * 커밋된 rev를 보는데 base가 워킹트리(HEAD)면 `git diff <rev> <rev>`가 되어 에러 없이
 * 빈 화면이 되므로 base를 auto로 올린다(사용자가 고른 진짜 base는 그대로 둔다).
 * 브라우저 `applyPick`에도 같은 규칙이 있으니 바꿀 때 함께 바꾼다.
 */
const normalize = (base: BaseSelector, head: HeadSelector): BaseSelector =>
	head.kind === "ref" && base.kind === "head" ? { kind: "auto" } : base;

export const parseSelection = (params: URLSearchParams): Selection => {
	const head = parseHead(params);
	return {
		repo: params.get("repo") ?? "",
		untracked: params.get("untracked") === "1",
		base: normalize(parseBase(params), head),
		head,
	};
};

const baseIdentity = (
	base: BaseSelector,
	resolvedBaseRef: string | null,
): string => {
	if (base.kind === "auto") return resolvedBaseRef ?? "";
	if (base.kind === "ref") return base.ref;
	return "";
};

/**
 * payload 캐시와 single-flight가 공유하는 키. flight 클로저가 읽는 입력을 빠짐없이
 * 넣는다 — 빠지면 다른 선택의 요청이 같은 flight에 합류해 남의 diff를 받는다.
 * ref는 이름으로 넣는다(OID면 커밋마다 슬롯이 늘어 LRU가 헛돈다 — 내용 변화는 지문의 몫).
 */
export const selectionCacheKey = (
	sel: Selection,
	resolvedBaseRef: string | null,
): string =>
	[
		sel.repo,
		String(sel.untracked),
		sel.base.kind,
		// 해석값은 auto에만 넣는다 — head 기준에 넣으면 origin/HEAD가 움직일 때마다
		// 워킹트리 뷰의 캐시가 날아간다.
		baseIdentity(sel.base, resolvedBaseRef),
		sel.head.kind === "ref" ? `head:${sel.head.ref}` : "head:worktree",
	].join("\0");

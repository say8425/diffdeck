/**
 * diff 선택(무엇을 무엇과 견주는가)의 단일 파서.
 *
 * /api/diff·/api/blob·/api/summary가 각자 `mode` 삼항을 복제해 갖고 있으면
 * 셋이 조용히 갈라질 수 있다 — 텍스트 diff는 base를 보는데 이미지 blob은
 * 워킹트리를 보는 식으로. 그 삼항을 여기 한 곳으로 모은다.
 */

/** 무엇을 기준으로 견줄 것인가. */
export type BaseSelector =
	/** HEAD 대비 — 아직 커밋하지 않은 변경만 (레거시 `mode=working`). */
	| { kind: "head" }
	/** 서버가 해석한 base 브랜치 대비 (레거시 `mode=base`, 또는 `base=@auto`). */
	| { kind: "auto" }
	/** 사용자가 고른 참조 대비. `base=HEAD`면 head와 같은 뷰가 된다. */
	| { kind: "ref"; ref: string };

/**
 * `base`에 실린 "서버가 알아서 골라라" 표식. 그냥 `auto`로 하면 실제로
 * `auto`라는 이름의 브랜치와 구별되지 않는다.
 */
export const AUTO_BASE = "@auto";

const parseBase = (params: URLSearchParams): BaseSelector => {
	const raw = params.get("base") ?? "";
	if (raw === AUTO_BASE) return { kind: "auto" };
	// HEAD는 참조로 취급하지 않고 head 종류로 **정규화**한다. 겉보기엔
	// merge-base(HEAD, HEAD) === HEAD라 같지만 두 가지가 다르다.
	// ① 커밋이 하나도 없는 리포(unborn HEAD)에서는 `rev-parse --verify HEAD`가
	//    실패해 참조 검증이 400을 내고, 새 프로젝트에서 처음 켠 화면이 통째로
	//    실패 카드가 된다.
	// ② 정규화해야 prewarm이 데운 슬롯과 브라우저 첫 요청의 캐시 키가 같아진다
	//    (`head` vs `ref:HEAD`는 서로 다른 슬롯이다).
	if (raw === "HEAD") return { kind: "head" };
	// base가 있으면 mode는 무시한다. 한 축을 두 파라미터가 인코딩하면
	// `mode=working&base=main` 같은 모순 상태가 생기고 우선순위 규칙이
	// 필요해진다 — 새 파라미터가 이긴다는 규칙 하나로 그 상태를 없앤다.
	if (raw !== "") return { kind: "ref", ref: raw };
	// 알 수 없는 mode 값은 400이 아니라 working으로 떨어진다 — 오늘의
	// 관용이고, 밖에서 만들어진 오래된 링크가 깨지지 않는 쪽이다.
	return params.get("mode") === "base" ? { kind: "auto" } : { kind: "head" };
};

export interface Selection {
	repo: string;
	untracked: boolean;
	base: BaseSelector;
}

export const parseSelection = (params: URLSearchParams): Selection => ({
	repo: params.get("repo") ?? "",
	untracked: params.get("untracked") === "1",
	base: parseBase(params),
});

/**
 * payload 캐시와 single-flight가 공유하는 키.
 *
 * **계약: 이 키는 flight 클로저가 읽는 모든 입력의 전함수여야 한다.**
 * 클로저는 repo·untracked·base 종류·해석된 base ref를 읽으므로 넷이 전부
 * 들어간다. 예전에는 해석된 ref가 키에 없었는데, createSingleFlight는 키가
 * 같으면 fn을 다시 읽지 않고 기존 프라미스를 돌려주므로(singleFlight.ts),
 * base가 다르게 해석된 두 요청 중 한쪽이 남의 ref로 만든 diff를 받을 수
 * 있었다(baseCache TTL 만료나 `gh pr view` 결과 변화로 도달한다).
 *
 * ref는 **이름**으로 넣는다. 커밋 OID를 넣으면 커밋마다 새 슬롯이 생겨
 * 8칸짜리 LRU가 헛돈다 — OID는 지문(fingerprint)이 볼 몫이다.
 */
const baseIdentity = (
	base: BaseSelector,
	resolvedBaseRef: string | null,
): string => {
	if (base.kind === "auto") return resolvedBaseRef ?? "";
	if (base.kind === "ref") return base.ref;
	return "";
};

export const selectionCacheKey = (
	sel: Selection,
	resolvedBaseRef: string | null,
): string =>
	[
		sel.repo,
		String(sel.untracked),
		sel.base.kind,
		// auto만 해석값에 의존한다. 사용자가 고른 ref는 서버가 해석할 것이
		// 없고, head 기준에 해석값을 넣으면 origin/HEAD가 움직일 때마다
		// 워킹트리 뷰의 캐시가 이유 없이 날아간다.
		baseIdentity(sel.base, resolvedBaseRef),
	].join("\0");

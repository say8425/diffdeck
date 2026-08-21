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
	/** 서버가 해석한 base 브랜치 대비 (레거시 `mode=base`). */
	| { kind: "auto" };

export interface Selection {
	repo: string;
	untracked: boolean;
	base: BaseSelector;
}

export const parseSelection = (params: URLSearchParams): Selection => ({
	repo: params.get("repo") ?? "",
	untracked: params.get("untracked") === "1",
	// 알 수 없는 값은 400이 아니라 working으로 떨어진다 — 오늘의 관용이고,
	// 밖에서 만들어진 오래된 링크가 깨지지 않는 쪽이다.
	base: params.get("mode") === "base" ? { kind: "auto" } : { kind: "head" },
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
export const selectionCacheKey = (
	sel: Selection,
	resolvedBaseRef: string | null,
): string =>
	[
		sel.repo,
		String(sel.untracked),
		sel.base.kind,
		// head 기준은 해석된 ref를 쓰지 않는다. 넣으면 origin/HEAD가 움직일
		// 때마다 워킹트리 뷰의 캐시가 이유 없이 날아간다.
		sel.base.kind === "auto" ? (resolvedBaseRef ?? "") : "",
	].join("\0");

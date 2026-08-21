/**
 * 응답 헤더로 실려 온 git 식별자(브랜치명 등)를 사람이 읽는 문자열로 되돌린다.
 *
 * HTTP 헤더 값은 latin1이라 비ASCII를 그대로 담을 수 없다 — 담으면 Bun의
 * Response 생성 자체가 throw해서 응답 전체가 500이 된다(실측: Bun 1.3.12,
 * `Header 'x-diff-base' has invalid value: '기능'`). git은 refname에 비ASCII를
 * 허용하므로 서버가 percent-encode해 보내고, 여기서 되돌린다.
 */
export const decodeHeaderValue = (raw: string | null): string => {
	if (raw == null) return "";
	try {
		return decodeURIComponent(raw);
	} catch {
		// 인코딩하지 않는 옛 서버가 "%"를 품은 브랜치명을 그대로 보내면
		// decodeURIComponent가 URIError를 던진다. 라벨 하나 때문에 diff 전체를
		// 잃는 것보다 원문을 쓰는 편이 낫다.
		return raw;
	}
};

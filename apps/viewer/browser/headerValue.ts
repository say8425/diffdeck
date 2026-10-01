// 헤더 값은 latin1이라 서버가 비ASCII 브랜치명을 percent-encode해 보낸다.
export const decodeHeaderValue = (raw: string | null): string => {
	if (raw == null) return "";
	try {
		return decodeURIComponent(raw);
	} catch {
		// 디코드할 수 없으면 원문을 쓴다 — 라벨 하나 때문에 diff 전체를 잃지 않는다.
		return raw;
	}
};

/**
 * /api/diff 응답 캐시. 선택(`selectionCacheKey`)마다 마지막 응답을 두고 지문이 같은
 * 동안 재사용한다. etag는 파일 식별자와 contentVersion으로만 계산한다 — 수십 MB body를
 * 해싱하지 않는다.
 */
import type { DiffFile } from "./diff.ts";

export interface PayloadCacheEntry {
	fingerprint: string;
	etag: string;
	body: string;
}

export interface PayloadCache {
	get(key: string, fingerprint: string): PayloadCacheEntry | null;
	set(key: string, entry: PayloadCacheEntry): void;
}

export const payloadEtag = (files: readonly DiffFile[]): string =>
	Bun.hash(
		files
			.map(
				(f) =>
					`${f.name}\0${f.oldName ?? ""}\0${f.status}\0${f.contentVersion}`,
			)
			.join("\x01"),
	).toString(36);

// body가 수십 MB일 수 있어 엔트리 수를 작게 묶는다(LRU: Map 삽입 순서).
export const createPayloadCache = (maxEntries = 8): PayloadCache => {
	const entries = new Map<string, PayloadCacheEntry>();
	return {
		get(key, fingerprint) {
			const hit = entries.get(key);
			if (!hit || hit.fingerprint !== fingerprint) return null;
			entries.delete(key);
			entries.set(key, hit);
			return hit;
		},
		set(key, entry) {
			entries.delete(key);
			entries.set(key, entry);
			if (entries.size > maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest !== undefined) entries.delete(oldest);
			}
		},
	};
};

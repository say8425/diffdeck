/**
 * /api/diff 응답 payload 캐시. (repo, untracked, mode) 키마다 마지막 응답의
 * {fingerprint, etag, body}를 보관하고, 지문이 일치하는 동안 diff 파이프라인
 * 없이 재사용한다. etag는 파일 식별자(name/oldName/status/contentVersion)만으로
 * 계산해 수십 MB짜리 body 해싱을 피한다 — contentVersion이 내용을 대변한다.
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

// body가 수십 MB일 수 있으므로 엔트리 수를 작게 캡한다 (LRU: Map 삽입 순서).
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

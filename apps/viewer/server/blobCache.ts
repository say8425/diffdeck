/**
 * blob OID → 바이트 캐시. 키가 내용의 해시(전체 OID)라 무효화가 없고, 상한을 넘으면
 * 오래된 것부터 버린다. 돌려주는 배열은 저장본 그대로다 — 호출자가 고치면 캐시가 오염된다.
 */

export interface BlobCacheStats {
	hits: number;
	misses: number;
	bytes: number;
	entries: number;
}

export interface BlobCache {
	get(oid: string): Uint8Array<ArrayBuffer> | undefined;
	/** 들어 있는지만 본다 — 선읽기의 확인이 hit/miss 통계와 LRU 순서를 흔들지 않게. */
	has(oid: string): boolean;
	set(oid: string, bytes: Uint8Array<ArrayBuffer>): void;
	/** 서버 배선이 실제로 쓰이는지 테스트가 확인하는 용도. */
	stats(): BlobCacheStats;
}

// 넘치면 miss가 늘 뿐 결과는 같다.
export const DEFAULT_BLOB_CACHE_BYTES = 64 * 1024 * 1024;

export const createBlobCache = ({
	maxBytes = DEFAULT_BLOB_CACHE_BYTES,
}: { maxBytes?: number } = {}): BlobCache => {
	const entries = new Map<string, Uint8Array<ArrayBuffer>>();
	let bytes = 0;
	let hits = 0;
	let misses = 0;
	return {
		get(oid) {
			const hit = entries.get(oid);
			if (hit === undefined) {
				misses++;
				return undefined;
			}
			hits++;
			// Map 삽입 순서가 LRU 순서다.
			entries.delete(oid);
			entries.set(oid, hit);
			return hit;
		},
		has: (oid) => entries.has(oid),
		set(oid, value) {
			// 한 항목 때문에 나머지를 다 비우지 않는다.
			if (value.byteLength > maxBytes) return;
			const prev = entries.get(oid);
			if (prev !== undefined) {
				bytes -= prev.byteLength;
				entries.delete(oid);
			}
			entries.set(oid, value);
			bytes += value.byteLength;
			// 방금 넣은 것은 맨 뒤이고 상한 이하라 살아남는다.
			for (const [key, old] of entries) {
				if (bytes <= maxBytes) break;
				entries.delete(key);
				bytes -= old.byteLength;
			}
		},
		stats: () => ({ hits, misses, bytes, entries: entries.size }),
	};
};

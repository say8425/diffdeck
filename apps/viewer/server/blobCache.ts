/**
 * blob OID → 바이트 캐시. 키가 내용의 해시(전체 OID)라 같은 키는 영원히 같은
 * 바이트다 — 그래서 무효화가 없고 상한을 넘을 때 오래된 것부터 버리기만 한다.
 * 리포·워크트리·경로가 달라도 같은 내용이면 공유된다(`git show <rev>:<path>`의
 * 출력은 blob OID만의 함수다 — textconv·eol·필터가 걸린 경로에서도 실측 동일).
 *
 * 돌려주는 배열은 저장된 것 그대로다. 호출자가 고치면 캐시가 오염되므로 읽기만
 * 한다(`buildFile`은 해시·디코드·`includes(0)`만 한다).
 */

export interface BlobCacheStats {
	hits: number;
	misses: number;
	bytes: number;
	entries: number;
}

export interface BlobCache {
	get(oid: string): Uint8Array<ArrayBuffer> | undefined;
	set(oid: string, bytes: Uint8Array<ArrayBuffer>): void;
	/** 서버 배선이 실제로 쓰이는지 테스트가 확인하는 용도. */
	stats(): BlobCacheStats;
}

// 45초 503이 나던 556파일 diff에서 old 쪽이 10.0MB, 양쪽을 다 담아도 44.5MB였다
// (실측). 넘치면 miss가 늘 뿐 결과는 같다.
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
			// Map 삽입 순서가 LRU 순서다 — 다시 넣어 맨 뒤(최근)로 옮긴다.
			entries.delete(oid);
			entries.set(oid, hit);
			return hit;
		},
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
			// 방금 넣은 것은 맨 뒤라 가장 늦게 버려지고, 상한 이하이므로 살아남는다.
			for (const [key, old] of entries) {
				if (bytes <= maxBytes) break;
				entries.delete(key);
				bytes -= old.byteLength;
			}
		},
		stats: () => ({ hits, misses, bytes, entries: entries.size }),
	};
};

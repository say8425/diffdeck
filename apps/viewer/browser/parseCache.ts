// contentVersion이 같으면 파싱 결과와 함께 CodeView 아이템 version도 재사용한다 —
// version이 그대로여야 reconcile이 바뀐 아이템만 dirty로 본다.
export interface ParseCacheEntry<T> {
	value: T;
	version: number;
}

export interface ParseCache<T> {
	resolve(
		name: string,
		contentVersion: string,
		produce: () => T,
	): ParseCacheEntry<T>;
	/** 폴드처럼 내용은 같은데 다시 렌더해야 할 때 새 version을 발급한다. */
	bump(name: string): number;
	prune(live: Iterable<string>): void;
}

interface StoredEntry<T> {
	contentVersion: string;
	value: T;
	version: number;
}

export const createParseCache = <T>(): ParseCache<T> => {
	const entries = new Map<string, StoredEntry<T>>();
	// 인스턴스 전역 단조 카운터 — CodeView는 version 불일치만 보므로 값이
	// 되돌아가거나 겹치지 않게 한다.
	let counter = 0;
	return {
		resolve(name, contentVersion, produce) {
			const hit = entries.get(name);
			if (hit && hit.contentVersion === contentVersion) {
				return { value: hit.value, version: hit.version };
			}
			const entry: StoredEntry<T> = {
				contentVersion,
				value: produce(),
				version: ++counter,
			};
			entries.set(name, entry);
			return { value: entry.value, version: entry.version };
		},
		bump(name) {
			const version = ++counter;
			const hit = entries.get(name);
			if (hit) hit.version = version;
			return version;
		},
		prune(live) {
			const keep = new Set(live);
			for (const name of entries.keys()) {
				if (!keep.has(name)) entries.delete(name);
			}
		},
	};
};

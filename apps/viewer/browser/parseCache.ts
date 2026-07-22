/**
 * 파일별 diff 파싱 캐시. renderPatch가 매번 전 파일을 Myers-diff 재파싱하는
 * 대신, 서버가 내려준 contentVersion이 같은 파일은 이전 파싱 결과(와 CodeView
 * 아이템 version 번호)를 그대로 재사용한다 — 바뀐 파일만 O(변경)으로 파싱되고,
 * CodeView reconcile도 바뀐 아이템만 dirty가 된다.
 */

export interface ParseCacheEntry<T> {
	value: T;
	version: number;
}

export interface ParseCache<T> {
	/** name의 contentVersion이 같으면 캐시된 {value, version}을, 다르면 produce()로 재파싱한 새 엔트리를 돌려준다. */
	resolve(
		name: string,
		contentVersion: string,
		produce: () => T,
	): ParseCacheEntry<T>;
	/** 상호작용(폴드 등)으로 아이템을 강제 재렌더할 때 새 version을 발급한다. */
	bump(name: string): number;
	/** 현재 diff에 없는 파일의 엔트리를 버린다. */
	prune(live: Iterable<string>): void;
}

interface StoredEntry<T> {
	contentVersion: string;
	value: T;
	version: number;
}

export const createParseCache = <T>(): ParseCache<T> => {
	const entries = new Map<string, StoredEntry<T>>();
	// 캐시 인스턴스 전역 단조 증가 카운터: CodeView는 version "불일치"만 보므로
	// 값 자체는 임의지만, 폴드 bump 뒤의 resolve가 과거 값으로 되돌아가면
	// 불필요한 dirty가 나므로 항상 앞으로만 간다.
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

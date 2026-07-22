import { describe, expect, test } from "bun:test";
import { createParseCache } from "../browser/parseCache.ts";

describe("createParseCache", () => {
	test("parses once per contentVersion and reuses the same value", () => {
		const cache = createParseCache<object>();
		let calls = 0;
		const produce = (): object => {
			calls++;
			return { parsed: calls };
		};
		const first = cache.resolve("a.ts", "v1", produce);
		const second = cache.resolve("a.ts", "v1", produce);
		expect(calls).toBe(1);
		expect(second.value).toBe(first.value);
		expect(second.version).toBe(first.version);
	});

	test("re-parses when the contentVersion changes and bumps the version", () => {
		const cache = createParseCache<object>();
		let calls = 0;
		const produce = (): object => {
			calls++;
			return { parsed: calls };
		};
		const v1 = cache.resolve("a.ts", "v1", produce);
		const v2 = cache.resolve("a.ts", "v2", produce);
		expect(calls).toBe(2);
		expect(v2.value).not.toBe(v1.value);
		expect(v2.version).toBeGreaterThan(v1.version);
	});

	test("tracks files independently", () => {
		const cache = createParseCache<string>();
		const a = cache.resolve("a.ts", "v1", () => "A");
		const b = cache.resolve("b.ts", "v1", () => "B");
		expect(a.value).toBe("A");
		expect(b.value).toBe("B");
		expect(a.version).not.toBe(b.version);
	});

	test("bump issues a fresh version the next resolve keeps", () => {
		const cache = createParseCache<string>();
		const before = cache.resolve("a.ts", "v1", () => "A");
		const bumped = cache.bump("a.ts");
		expect(bumped).toBeGreaterThan(before.version);
		// 같은 contentVersion의 다음 resolve는 재파싱 없이 bump된 version을 유지
		// 해야 한다 — 아니면 CodeView가 폴드 직후 poll에서 아이템을 되돌린다.
		let calls = 0;
		const after = cache.resolve("a.ts", "v1", () => {
			calls++;
			return "A2";
		});
		expect(calls).toBe(0);
		expect(after.version).toBe(bumped);
	});

	test("bump on an unknown name still returns a usable fresh version", () => {
		const cache = createParseCache<string>();
		const known = cache.resolve("a.ts", "v1", () => "A");
		expect(cache.bump("ghost.ts")).toBeGreaterThan(known.version);
	});

	test("prune drops entries not in the live set", () => {
		const cache = createParseCache<string>();
		cache.resolve("a.ts", "v1", () => "A");
		cache.resolve("b.ts", "v1", () => "B");
		cache.prune(["a.ts"]);
		let calls = 0;
		cache.resolve("b.ts", "v1", () => {
			calls++;
			return "B2";
		});
		expect(calls).toBe(1);
		let aCalls = 0;
		cache.resolve("a.ts", "v1", () => {
			aCalls++;
			return "A2";
		});
		expect(aCalls).toBe(0);
	});
});

import { describe, expect, test } from "bun:test";
import {
	type Getter,
	DEFAULT_TREE_WIDTH,
	FLATTEN_KEY,
	MAX_TREE_WIDTH,
	MIN_TREE_WIDTH,
	TREE_SIDE_KEY,
	TREE_WIDTH_KEY,
	clampTreeWidth,
	compareBaseKey,
	readFlatten,
	readTreeSide,
	readTreeWidth,
	resolveCompareBase,
	resolveDiffStyle,
	resolveFlatten,
	resolveFoldWithTree,
	resolveTreeHidden,
	resolveTreeSide,
	resolveUntracked,
	resolveWatch,
} from "../browser/prefs.ts";

const fake =
	(store: Record<string, string>) =>
	(key: string): string | null =>
		store[key] ?? null;

describe("readTreeSide", () => {
	test("defaults to left when unset", () => {
		expect(readTreeSide(fake({}))).toBe("left");
	});
	test("returns right when stored right", () => {
		expect(readTreeSide(fake({ [TREE_SIDE_KEY]: "right" }))).toBe("right");
	});
	test("falls back to left for unknown value", () => {
		expect(readTreeSide(fake({ [TREE_SIDE_KEY]: "bogus" }))).toBe("left");
	});
});

describe("readFlatten", () => {
	test("defaults to on when unset", () => {
		expect(readFlatten(fake({}))).toBe(true);
	});
	test("off only when stored 0", () => {
		expect(readFlatten(fake({ [FLATTEN_KEY]: "0" }))).toBe(false);
	});
	test("on when stored 1", () => {
		expect(readFlatten(fake({ [FLATTEN_KEY]: "1" }))).toBe(true);
	});
});

describe("launch-flag resolvers (URL param → localStorage → default)", () => {
	const empty = (_k: string) => null;
	const get =
		(store: Record<string, string>) =>
		(k: string): string | null =>
			store[k] ?? null;

	test("resolveUntracked: URL only, default false", () => {
		expect(resolveUntracked(null)).toBe(false);
		expect(resolveUntracked("1")).toBe(true);
		expect(resolveUntracked("0")).toBe(false);
	});
	test("resolveTreeHidden: URL only, default false (visible)", () => {
		expect(resolveTreeHidden(null)).toBe(false);
		expect(resolveTreeHidden("0")).toBe(true);
		expect(resolveTreeHidden("1")).toBe(false);
	});
	test("resolveDiffStyle: URL only, default unified", () => {
		expect(resolveDiffStyle(null)).toBe("unified");
		expect(resolveDiffStyle("split")).toBe("split");
		expect(resolveDiffStyle("unified")).toBe("unified");
	});
	test("resolveFlatten: URL wins, else localStorage, else default on", () => {
		expect(resolveFlatten("0", empty)).toBe(false);
		expect(resolveFlatten("1", get({ "cc-statusline:flatten": "0" }))).toBe(
			true,
		);
		expect(resolveFlatten(null, get({ "cc-statusline:flatten": "0" }))).toBe(
			false,
		);
		expect(resolveFlatten(null, empty)).toBe(true);
	});
	test("resolveTreeSide: URL wins, else localStorage, else default left", () => {
		expect(resolveTreeSide("right", empty)).toBe("right");
		expect(
			resolveTreeSide("left", get({ "cc-statusline:tree-side": "right" })),
		).toBe("left");
		expect(
			resolveTreeSide(null, get({ "cc-statusline:tree-side": "right" })),
		).toBe("right");
		expect(resolveTreeSide(null, empty)).toBe("left");
	});
	test("resolveWatch: URL wins, else localStorage, else default off", () => {
		expect(resolveWatch("1", empty)).toBe(true);
		expect(resolveWatch("0", get({ "cc-statusline:diff-watch": "1" }))).toBe(
			false,
		);
		expect(resolveWatch(null, get({ "cc-statusline:diff-watch": "1" }))).toBe(
			true,
		);
		expect(resolveWatch(null, empty)).toBe(false);
	});
	test("resolveFoldWithTree: URL wins, else localStorage, else default off", () => {
		expect(resolveFoldWithTree("1", empty)).toBe(true);
		expect(
			resolveFoldWithTree("0", get({ "cc-statusline:fold-with-tree": "1" })),
		).toBe(false);
		expect(
			resolveFoldWithTree(null, get({ "cc-statusline:fold-with-tree": "1" })),
		).toBe(true);
		expect(resolveFoldWithTree(null, empty)).toBe(false);
	});
});

describe("clampTreeWidth", () => {
	test("passes through values inside the 180-600 range", () => {
		expect(clampTreeWidth(300)).toBe(300);
		expect(clampTreeWidth(MIN_TREE_WIDTH)).toBe(MIN_TREE_WIDTH);
		expect(clampTreeWidth(MAX_TREE_WIDTH)).toBe(MAX_TREE_WIDTH);
	});
	test("clamps values below the minimum", () => {
		expect(clampTreeWidth(50)).toBe(MIN_TREE_WIDTH);
	});
	test("clamps values above the maximum", () => {
		expect(clampTreeWidth(9999)).toBe(MAX_TREE_WIDTH);
	});
	test("falls back to the default for non-finite input", () => {
		expect(clampTreeWidth(Number.NaN)).toBe(DEFAULT_TREE_WIDTH);
	});
});

describe("readTreeWidth", () => {
	test("defaults to 300 when unset", () => {
		expect(readTreeWidth(fake({}))).toBe(DEFAULT_TREE_WIDTH);
	});
	test("returns the stored value when inside range", () => {
		expect(readTreeWidth(fake({ [TREE_WIDTH_KEY]: "420" }))).toBe(420);
	});
	test("clamps a stored value outside range", () => {
		expect(readTreeWidth(fake({ [TREE_WIDTH_KEY]: "50" }))).toBe(
			MIN_TREE_WIDTH,
		);
		expect(readTreeWidth(fake({ [TREE_WIDTH_KEY]: "9999" }))).toBe(
			MAX_TREE_WIDTH,
		);
	});
	test("falls back to default for an unparseable stored value", () => {
		expect(readTreeWidth(fake({ [TREE_WIDTH_KEY]: "bogus" }))).toBe(
			DEFAULT_TREE_WIDTH,
		);
	});
});

describe("compare base preference", () => {
	const store =
		(entries: Record<string, string>): Getter =>
		(k) =>
			entries[k] ?? null;

	test("the URL parameter wins over the stored choice", () => {
		expect(
			resolveCompareBase(
				"develop",
				store({ [compareBaseKey("/r")]: "main" }),
				"/r",
			),
		).toBe("develop");
	});

	test("falls back to the stored choice when the URL is silent", () => {
		expect(
			resolveCompareBase(null, store({ [compareBaseKey("/r")]: "main" }), "/r"),
		).toBe("main");
	});

	// null이면 base 파라미터를 아예 보내지 않고 서버가 자동 해석한다 —
	// 오늘의 기본 동작이 그대로 유지된다.
	test("resolves to null when neither layer has a value", () => {
		expect(resolveCompareBase(null, store({}), "/r")).toBeNull();
	});

	test("an empty URL parameter behaves as absent", () => {
		expect(
			resolveCompareBase("", store({ [compareBaseKey("/r")]: "main" }), "/r"),
		).toBe("main");
	});

	// 워크트리마다 견주는 기준이 다르다. 네임스페이스가 없으면 한 워크트리의
	// 선택이 다른 워크트리로 새어 나간다(기존 여섯 키가 그 상태다).
	test("keeps each repository's choice separate", () => {
		const get = store({ [compareBaseKey("/a")]: "main" });
		expect(resolveCompareBase(null, get, "/a")).toBe("main");
		expect(resolveCompareBase(null, get, "/b")).toBeNull();
	});
});

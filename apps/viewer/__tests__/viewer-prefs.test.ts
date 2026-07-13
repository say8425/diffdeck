import { describe, expect, test } from "bun:test";
import {
	FLATTEN_KEY,
	readFlatten,
	readTreeSide,
	resolveDiffStyle,
	resolveFlatten,
	resolveTreeSide,
	resolveUntracked,
	resolveWatch,
	TREE_SIDE_KEY,
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
});

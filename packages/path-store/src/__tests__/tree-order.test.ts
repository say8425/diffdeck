import { describe, expect, test } from "bun:test";
import { comparePathsInTreeOrder } from "../index";

const sorted = (paths: string[]): string[] =>
	paths.toSorted(comparePathsInTreeOrder);

describe("comparePathsInTreeOrder", () => {
	test("directories sort before files at every level", () => {
		expect(
			sorted([
				"README.md",
				"src/index.ts",
				"biome.json",
				"docs/a.png",
				"src/viewer/main.ts",
			]),
		).toEqual([
			"docs/a.png",
			"src/viewer/main.ts",
			"src/index.ts",
			"biome.json",
			"README.md",
		]);
	});

	test("case-insensitive alphabetical within a level", () => {
		expect(
			sorted(["README.md", "biome.json", "bun.lock", "package.json"]),
		).toEqual(["biome.json", "bun.lock", "package.json", "README.md"]);
	});

	test("natural sort for numbered names", () => {
		expect(
			sorted(["shots/img10.png", "shots/img2.png", "shots/img1.png"]),
		).toEqual(["shots/img1.png", "shots/img2.png", "shots/img10.png"]);
	});

	test("case-only difference falls back to raw comparison", () => {
		expect(sorted(["a.txt", "A.txt"])).toEqual(["A.txt", "a.txt"]);
	});

	test("input order does not matter", () => {
		expect(
			sorted(["zz.txt", "docs/new.png", "aa.txt", "docs/old.png"]),
		).toEqual(["docs/new.png", "docs/old.png", "aa.txt", "zz.txt"]);
	});

	test("deeper hierarchy compared segment by segment", () => {
		expect(comparePathsInTreeOrder("src/a/b.ts", "src/a/b.ts")).toBe(0);
		expect(
			comparePathsInTreeOrder("src/__tests__/x.ts", "src/diff-server/y.ts"),
		).toBeLessThan(0);
		expect(
			comparePathsInTreeOrder("src/viewer/z.ts", "src/index.ts"),
		).toBeLessThan(0);
	});
});

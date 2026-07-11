import { describe, expect, test } from "bun:test";
import { comparePathsInTreeOrder } from "@diffdeck/path-store";

// Mirrors renderPatch's sort: DiffFile[] ordered by `.name` in tree order.
const names = (paths: string[]): string[] =>
	paths
		.map((name) => ({ name }))
		.toSorted((a, b) => comparePathsInTreeOrder(a.name, b.name))
		.map((f) => f.name);

describe("viewer file ordering (unified with path-store)", () => {
	test("directories sort before files at every level (like the file tree)", () => {
		expect(
			names([
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
			names(["README.md", "biome.json", "bun.lock", "package.json"]),
		).toEqual(["biome.json", "bun.lock", "package.json", "README.md"]);
	});

	test("natural sort for numbered names", () => {
		expect(
			names(["shots/img10.png", "shots/img2.png", "shots/img1.png"]),
		).toEqual(["shots/img1.png", "shots/img2.png", "shots/img10.png"]);
	});

	test("same lowercase falls back to raw comparison (stable, deterministic)", () => {
		expect(names(["a.txt", "A.txt"])).toEqual(["A.txt", "a.txt"]);
	});

	test("input order does not matter (untracked appended last still interleaves)", () => {
		expect(names(["zz.txt", "docs/new.png", "aa.txt", "docs/old.png"])).toEqual(
			["docs/new.png", "docs/old.png", "aa.txt", "zz.txt"],
		);
	});
});

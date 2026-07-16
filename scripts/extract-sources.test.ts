import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSources } from "./extract-sources.ts";

// Hermetic fixture. This used to read a sibling checkout's
// `~/dev/cc-statusline/node_modules/@pierre/trees/dist`, which fails in CI (the
// path doesn't exist) and would break locally too once cc-statusline drops its
// @pierre dependency. The real Pierre maps only ever exercised the logic below,
// so we synthesize maps of the same shape instead.
const OWN = "export const getFlattenedChildDirectoryId = () => 1;\n";
const OTHER = "export const toHex = () => '#fff';\n";

let dir: string;

const makeMapDir = (): string => {
	const root = mkdtempSync(join(tmpdir(), "extract-sources-"));
	// Sources are emitted relative to the bundle, hence the leading `../`.
	// Index 3 repeats index 0 to pin the first-wins dedupe.
	writeFileSync(
		join(root, "index.js.map"),
		JSON.stringify({
			sources: [
				"../../path-store/src/flatten.ts",
				"../../node_modules/lru_map/lru.ts",
				"./contentless.ts",
				"../../path-store/src/flatten.ts",
			],
			sourcesContent: [OWN, "export const lru = 1;\n", null, "MUST NOT WIN\n"],
		}),
	);
	// A map in a subdirectory pins the recursive `**/*.js.map` scan.
	mkdirSync(join(root, "nested"), { recursive: true });
	writeFileSync(
		join(root, "nested", "other.js.map"),
		JSON.stringify({
			sources: ["../../theming/src/color.ts"],
			sourcesContent: [OTHER],
		}),
	);
	return root;
};

afterEach(() => {
	if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("extractSources", () => {
	test("recovers own sources and strips the leading ../ from their paths", () => {
		dir = makeMapDir();
		const map = extractSources(dir, {});
		expect(map.get("path-store/src/flatten.ts")).toBe(OWN);
	});

	test("scans nested map files too", () => {
		dir = makeMapDir();
		const map = extractSources(dir, {});
		expect(map.get("theming/src/color.ts")).toBe(OTHER);
	});

	test("skips third-party sources under node_modules by default", () => {
		dir = makeMapDir();
		const map = extractSources(dir, {});
		expect([...map.keys()].some((k) => k.includes("/node_modules/"))).toBe(
			false,
		);
	});

	test("keepNodeModules keeps the third-party sources", () => {
		dir = makeMapDir();
		const map = extractSources(dir, { keepNodeModules: true });
		expect(
			[...map.keys()].some((k) => k.includes("node_modules/lru_map")),
		).toBe(true);
	});

	test("skips entries with no sourcesContent", () => {
		dir = makeMapDir();
		const map = extractSources(dir, {});
		expect(map.has("contentless.ts")).toBe(false);
	});

	test("first occurrence of a duplicated source wins", () => {
		dir = makeMapDir();
		const map = extractSources(dir, {});
		expect(map.get("path-store/src/flatten.ts")).not.toContain("MUST NOT WIN");
	});
});

import { describe, expect, test } from "bun:test";
import { extractSources } from "./extract-sources.ts";

describe("extractSources", () => {
	test("recovers own TS sources from real pierre trees maps, skipping node_modules", () => {
		const dir = `${process.env.HOME}/dev/cc-statusline/node_modules/@pierre/trees/dist`;
		const map = extractSources(dir, {});
		// path-store/src/flatten.ts is a known own-source file recovered earlier
		const key = [...map.keys()].find((k) =>
			k.endsWith("path-store/src/flatten.ts"),
		);
		expect(key).toBeDefined();
		expect(map.get(key!)).toContain("getFlattenedChildDirectoryId");
		// no third-party deps leak in
		expect([...map.keys()].some((k) => k.includes("/node_modules/"))).toBe(
			false,
		);
	});
});

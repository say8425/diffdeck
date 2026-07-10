import { describe, expect, test } from "bun:test";
import { CodeView, parseDiffFromFile } from "@diffdeck/diffs";
import { FileTree } from "@diffdeck/trees";

describe("forked packages construct", () => {
	test("CodeView + parseDiffFromFile are callable", () => {
		expect(typeof CodeView).toBe("function");
		expect(typeof parseDiffFromFile).toBe("function");
	});
	test("FileTree is constructable", () => {
		expect(typeof FileTree).toBe("function");
	});
});

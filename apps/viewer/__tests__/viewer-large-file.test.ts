import { describe, expect, test } from "bun:test";
import {
	countChangedLines,
	isLargeFile,
	LARGE_FILE_LINE_THRESHOLD,
} from "../browser/largeFile.ts";

describe("isLargeFile", () => {
	test("known lockfile (by basename) is large regardless of size", () => {
		expect(isLargeFile("frontend/pnpm-lock.yaml", 0)).toBe(true);
		expect(isLargeFile("yarn.lock", 3)).toBe(true);
		expect(isLargeFile("go.sum", 1)).toBe(true);
	});
	test("non-lockfile under threshold is not large", () => {
		expect(isLargeFile("src/app.ts", 100)).toBe(false);
	});
	test("threshold is strict: exactly the threshold is not large", () => {
		expect(isLargeFile("src/app.ts", LARGE_FILE_LINE_THRESHOLD)).toBe(false);
	});
	test("non-lockfile over threshold is large", () => {
		expect(isLargeFile("src/generated.ts", LARGE_FILE_LINE_THRESHOLD + 1)).toBe(
			true,
		);
	});
	test("a name that merely contains a lockfile substring is not matched", () => {
		expect(isLargeFile("src/yarn.lock.ts", 5)).toBe(false);
	});
});

describe("countChangedLines", () => {
	// FileDiffMetadata의 동명 필드(string[])는 파일 전량이라 hunk의 숫자 필드를 센다(viewer.md).
	test("sums the +/- line counts across hunks", () => {
		expect(
			countChangedLines([
				{ additionLines: 28, deletionLines: 2 },
				{ additionLines: 5, deletionLines: 11 },
			]),
		).toBe(46);
	});
	test("a diff with no hunks counts as zero", () => {
		expect(countChangedLines([])).toBe(0);
	});
	test("a long file with a small edit is not large", () => {
		expect(
			isLargeFile(
				"CLAUDE.md",
				countChangedLines([{ additionLines: 28, deletionLines: 2 }]),
			),
		).toBe(false);
	});
	test("a huge rewrite of the same file is still large", () => {
		expect(
			isLargeFile(
				"CLAUDE.md",
				countChangedLines([
					{ additionLines: LARGE_FILE_LINE_THRESHOLD, deletionLines: 1 },
				]),
			),
		).toBe(true);
	});
});

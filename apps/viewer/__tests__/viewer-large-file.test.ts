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
	// FileDiffMetadata.additionLines/deletionLines(string[])는 이름과 달리
	// "변경된 줄"이 아니다: parseDiffFromFile로 만든 diff는 isPartial === false라
	// 그 둘이 각각 새/옛 파일의 **전량**이다. 실제 +/- 줄 수는 hunk 쪽 동명
	// 숫자 필드에만 있다.
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
		// headerlab의 CLAUDE.md 실측: 1166줄 파일에 +28/-2.
		// 파일 전량(1166 + 1140 = 2306)을 세면 임계값을 넘어 접혔다.
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

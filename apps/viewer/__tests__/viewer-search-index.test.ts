import { describe, expect, test } from "bun:test";
import type { FileDiffMetadata } from "@diffdeck/diffs";
import { buildRows, findMatches } from "../browser/search/searchIndex.ts";

// buildRows가 읽는 필드만 채운다. 1번째 줄(hunk 앞 collapsed)과 5번째 줄(trailing)이
// hunk 밖에 있어야 그 두 경로를 탄다.
const fixture = (): FileDiffMetadata => {
	const additionLines = [
		"import a",
		"const x = 1",
		"ADDED foo",
		"const y = 2",
		"tail foo",
	];
	const deletionLines = [
		"import a",
		"const x = 1",
		"REMOVED foo",
		"const y = 2",
		"tail foo",
	];
	const hunks = [
		{
			additionStart: 2, // 1부터 센 줄 번호(= additionLineIndex 1)
			hunkContent: [
				{
					type: "context",
					additionLineIndex: 1,
					deletionLineIndex: 1,
					lines: 1,
				},
				{
					type: "change",
					deletionLineIndex: 2,
					deletions: 1,
					additionLineIndex: 2,
					additions: 1,
				},
				{
					type: "context",
					additionLineIndex: 3,
					deletionLineIndex: 3,
					lines: 1,
				},
			],
		},
	];
	return { additionLines, deletionLines, hunks } as unknown as FileDiffMetadata;
};

describe("buildRows", () => {
	test("unified 순서로 재구성 (collapsed 앞/삭제/추가/trailing, context 1회)", () => {
		expect(buildRows(fixture())).toEqual([
			{ side: "additions", lineNumber: 1, text: "import a" },
			{ side: "additions", lineNumber: 2, text: "const x = 1" },
			{ side: "deletions", lineNumber: 3, text: "REMOVED foo" },
			{ side: "additions", lineNumber: 3, text: "ADDED foo" },
			{ side: "additions", lineNumber: 4, text: "const y = 2" },
			{ side: "additions", lineNumber: 5, text: "tail foo" },
		]);
	});
});

describe("findMatches", () => {
	test("삭제 줄 포함, 방출 순서, 정확한 열/줄번호/side", () => {
		const files = [{ fileId: "f.ts", fileDiff: fixture() }];
		expect(findMatches(files, "foo")).toEqual([
			{
				fileId: "f.ts",
				side: "deletions",
				lineNumber: 3,
				column: 8,
				length: 3,
			},
			{
				fileId: "f.ts",
				side: "additions",
				lineNumber: 3,
				column: 6,
				length: 3,
			},
			{
				fileId: "f.ts",
				side: "additions",
				lineNumber: 5,
				column: 5,
				length: 3,
			},
		]);
	});
	test("대소문자 무시", () => {
		const files = [{ fileId: "f.ts", fileDiff: fixture() }];
		expect(findMatches(files, "FOO").length).toBe(3);
	});
	test("빈 검색어 → []", () => {
		expect(findMatches([{ fileId: "f.ts", fileDiff: fixture() }], "")).toEqual(
			[],
		);
	});
	test("무매치 → []", () => {
		expect(
			findMatches([{ fileId: "f.ts", fileDiff: fixture() }], "zzz"),
		).toEqual([]);
	});
	test("여러 파일은 files 순서대로", () => {
		const files = [
			{ fileId: "a.ts", fileDiff: fixture() },
			{ fileId: "b.ts", fileDiff: fixture() },
		];
		const ids = findMatches(files, "foo").map((m) => m.fileId);
		expect(ids).toEqual(["a.ts", "a.ts", "a.ts", "b.ts", "b.ts", "b.ts"]);
	});
});

import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@diffdeck/diffs";
import { buildGrabRows, extractSnippet } from "../browser/grab/snippet.ts";

const fd = (oldText: string, newText: string) =>
	parseDiffFromFile(
		{ name: "a.ts", contents: oldText },
		{ name: "a.ts", contents: newText },
	);

// 두 군데 떨어진 편집 → hunk 2개 + 사이 gap (per-gap 델타 검증용).
// 사이 unchanged 12줄(l3~l14)이 있어야 diff lib 기본 context(4줄) 병합 임계(2*4=8)를
// 넘어서 hunk가 분리된다 — 실측: fd(OLD, NEW).hunks.length === 2 확인됨.
const OLD = [
	"l1",
	"l2-old",
	"l3",
	"l4",
	"l5",
	"l6",
	"l7",
	"l8",
	"l9",
	"l10",
	"l11",
	"l12",
	"l13",
	"l14",
	"l15-old",
	"l16",
].join("\n");
const NEW = [
	"l1",
	"l2-new",
	"extra",
	"l3",
	"l4",
	"l5",
	"l6",
	"l7",
	"l8",
	"l9",
	"l10",
	"l11",
	"l12",
	"l13",
	"l14",
	"l15-new",
	"l16",
].join("\n");

describe("buildGrabRows", () => {
	test("unified 순서 + 양측 번호: 삭제행 oldNo만, 추가행 newNo만, context 둘 다", () => {
		const rows = buildGrabRows(fd(OLD, NEW));
		expect(rows[0]).toEqual({ marker: " ", text: "l1", oldNo: 1, newNo: 1 });
		const del = rows.find((r) => r.marker === "-" && r.text === "l2-old");
		expect(del).toEqual({ marker: "-", text: "l2-old", oldNo: 2, newNo: null });
		const add = rows.find((r) => r.marker === "+" && r.text === "extra");
		expect(add).toEqual({ marker: "+", text: "extra", oldNo: null, newNo: 3 });
	});
	test("hunk 사이 gap: 두 번째 hunk 구간의 old/new 번호가 per-gap 델타(+1)로 맞다", () => {
		const rows = buildGrabRows(fd(OLD, NEW));
		const l10 = rows.find((r) => r.text === "l10");
		expect(l10).toEqual({ marker: " ", text: "l10", oldNo: 10, newNo: 11 });
		const del2 = rows.find((r) => r.text === "l15-old");
		expect(del2?.oldNo).toBe(15);
	});
	test("전체 행 수 = old 삭제행 + 전체 new 행", () => {
		const rows = buildGrabRows(fd(OLD, NEW));
		expect(rows.length).toBe(2 /*deletions*/ + 17 /*new file lines*/);
	});
	test("범위 밖 인덱스의 malformed hunk 행은 건너뛴다", () => {
		const meta = fd(OLD, NEW);
		meta.hunks[0].hunkContent.push({
			type: "change",
			deletions: 1,
			deletionLineIndex: 9999,
			additions: 1,
			additionLineIndex: 9999,
		});
		expect(() => buildGrabRows(meta)).not.toThrow();
	});
});

describe("extractSnippet — side", () => {
	test("new side 슬라이스, 트레일링 개행 제거", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "side",
			side: "new",
			startLine: 2,
			endLine: 4,
		});
		expect(snip).toEqual({
			kind: "side",
			side: "new",
			startLine: 2,
			endLine: 4,
			lines: ["l2-new", "extra", "l3"],
		});
	});
	test("old side 슬라이스", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "side",
			side: "old",
			startLine: 15,
			endLine: 16,
		});
		expect(snip?.kind === "side" && snip.lines).toEqual(["l15-old", "l16"]);
	});
	test("범위가 파일 밖이면 클램프되고 클램프된 경계를 반환", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "side",
			side: "new",
			startLine: 12,
			endLine: 999,
		});
		expect(snip?.kind === "side" && snip.endLine).toBe(17);
	});
	test("added 파일의 old side → null (빈 배열 가드)", () => {
		const snip = extractSnippet(fd("", "only-new\n"), {
			kind: "side",
			side: "old",
			startLine: 1,
			endLine: 1,
		});
		expect(snip).toBeNull();
	});
});

describe("extractSnippet — mixed", () => {
	test("old 끝점→new 끝점 사이 행 slice + 양측 경계", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "mixed",
			start: { side: "old", line: 2 },
			end: { side: "new", line: 4 },
		});
		if (snip?.kind !== "mixed") throw new Error("expected mixed");
		expect(snip.rows.map((r) => r.marker + r.text)).toEqual([
			"-l2-old",
			"+l2-new",
			"+extra",
			" l3",
		]);
		expect([snip.oldStart, snip.oldEnd, snip.newStart, snip.newEnd]).toEqual([
			2, 3, 2, 4,
		]);
	});
	test("역방향(문서 아래→위) 끝점도 slice 순서는 표시 순서", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "mixed",
			start: { side: "new", line: 4 },
			end: { side: "old", line: 2 },
		});
		expect(snip?.kind === "mixed" && snip.rows[0].marker).toBe("-");
	});
	test("존재하지 않는 라인 끝점 → null", () => {
		const snip = extractSnippet(fd(OLD, NEW), {
			kind: "mixed",
			start: { side: "old", line: 999 },
			end: { side: "new", line: 1 },
		});
		expect(snip).toBeNull();
	});
});

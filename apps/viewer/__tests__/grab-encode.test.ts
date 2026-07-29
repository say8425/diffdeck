import { describe, expect, test } from "bun:test";
import { encodeGrab, grabLabel } from "../browser/grab/encode.ts";
import type { Snippet } from "../browser/grab/snippet.ts";

const sideSnip: Snippet = {
	kind: "side",
	side: "new",
	startLine: 84,
	endLine: 98,
	lines: ["if (a) return;", "const b = 1;"],
};
const base = {
	path: "apps/viewer/browser/main.ts",
	status: "modified" as const,
	mode: "working" as const,
	baseName: "",
	snippet: sideSnip,
	prompt: "여기 클릭 핸들러를 분리해줘",
};

describe("encodeGrab", () => {
	test("기본 포맷: 펜스 안 헤더+본문, 펜스 뒤 프롬프트", () => {
		expect(encodeGrab(base)).toBe(
			"```\n" +
				"diffdeck selection\n" +
				"File: apps/viewer/browser/main.ts\n" +
				"Lines: 84-98 (new side, working diff)\n" +
				"\n" +
				"if (a) return;\n" +
				"const b = 1;\n" +
				"```\n" +
				"여기 클릭 핸들러를 분리해줘",
		);
	});
	test("old side + 단일 라인 + base 모드(베이스명)", () => {
		const out = encodeGrab({
			...base,
			mode: "base",
			baseName: "origin/main",
			snippet: {
				kind: "side",
				side: "old",
				startLine: 7,
				endLine: 7,
				lines: ["x"],
			},
			prompt: "",
		});
		expect(out).toContain("Lines: 7 (old side, base diff vs origin/main)");
		expect(out.endsWith("```")).toBe(true); // 빈 프롬프트 생략
	});
	test("base 모드 + 베이스명 없음 → 'base diff'", () => {
		expect(encodeGrab({ ...base, mode: "base", baseName: "" })).toContain(
			"(new side, base diff)",
		);
	});
	test("untracked 상태 주석", () => {
		expect(encodeGrab({ ...base, status: "untracked" })).toContain(
			"(new side, working diff, untracked)",
		);
	});
	test("renamed → File 행에 prevPath, Lines에 주석 없음", () => {
		const out = encodeGrab({
			...base,
			status: "renamed",
			prevPath: "old/main.ts",
		});
		expect(out).toContain(
			"File: apps/viewer/browser/main.ts (renamed from old/main.ts)",
		);
		expect(out).toContain("Lines: 84-98 (new side, working diff)\n");
	});
	test("mixed: old/new 범위 헤더 + 마커 본문", () => {
		const out = encodeGrab({
			...base,
			snippet: {
				kind: "mixed",
				oldStart: 2,
				oldEnd: 2,
				newStart: 2,
				newEnd: 3,
				rows: [
					{ marker: "-", text: "l2-old", oldNo: 2, newNo: null },
					{ marker: "+", text: "l2-new", oldNo: null, newNo: 2 },
					{ marker: " ", text: "l3", oldNo: 3, newNo: 3 },
				],
			},
		});
		expect(out).toContain("Lines: old 2 / new 2-3 (working diff)");
		expect(out).toContain("\n-l2-old\n+l2-new\n l3\n");
	});
	test("본문에 백틱 3연속 포함 → 펜스가 4개로 승격", () => {
		const out = encodeGrab({
			...base,
			snippet: {
				kind: "side",
				side: "new",
				startLine: 1,
				endLine: 1,
				lines: ["```json"],
			},
		});
		expect(out.startsWith("````\n")).toBe(true);
		expect(out).toContain("\n````\n여기");
	});
	test("공백뿐인 프롬프트는 생략", () => {
		expect(encodeGrab({ ...base, prompt: "   " }).endsWith("```")).toBe(true);
	});
});

describe("grabLabel", () => {
	test("side", () =>
		expect(grabLabel(base.path, sideSnip)).toBe("main.ts:84-98 · new side"));
	test("mixed", () => {
		expect(
			grabLabel("a/b.ts", {
				kind: "mixed",
				oldStart: 2,
				oldEnd: 2,
				newStart: 2,
				newEnd: 3,
				rows: [],
			}),
		).toBe("b.ts: old 2 / new 2-3");
	});
});

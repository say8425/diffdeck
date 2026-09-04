import { describe, expect, test } from "bun:test";
import {
	encodeGrab,
	grabLabel,
	grabLabelParts,
	plainSnippet,
} from "../browser/grab/encode.ts";
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
	// 브랜치를 head로 보는 화면에서 잡은 줄은 그 브랜치의 **커밋된** 내용이다.
	// 참조가 그걸 말하지 않으면 붙여넣기를 받은 에이전트가 자기 워킹트리의
	// 같은 경로(다른 브랜치일 수 있다)를 열어 엉뚱한 줄을 고친다.
	test("head를 보고 있으면 어느 리비전인지 말한다", () => {
		expect(
			encodeGrab({ ...base, mode: "base", baseName: "main", head: "develop" }),
		).toContain("Lines: 84-98 (new side, base diff vs main on develop)");
	});

	test("head 없으면 예전 문구 그대로 — 워킹트리를 보고 있다는 뜻이다", () => {
		expect(encodeGrab({ ...base, mode: "base", baseName: "main" })).toContain(
			"Lines: 84-98 (new side, base diff vs main)",
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

describe("plainSnippet", () => {
	// ⌥⏎ 단순 복사 — 편집기에 바로 붙여넣을 수 있어야 하므로 펜스·헤더가
	// 없고, 문자 슬라이스가 이미 적용된 lines가 그대로 나간다.
	test("side: 코드 줄만, 펜스·헤더 없음", () => {
		expect(plainSnippet(sideSnip)).toBe("if (a) return;\nconst b = 1;");
	});

	// mixed의 +/- 마커도 제외 — 맥락(헤더)이 빠진 텍스트에 마커는 노이즈다.
	test("mixed: 마커 없이 텍스트만", () => {
		expect(
			plainSnippet({
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
			}),
		).toBe("l2-old\nl2-new\nl3");
	});
});

describe("grabLabelParts", () => {
	// 조각의 kind가 곧 색이다 — 여기가 틀리면 팝오버가 엉뚱한 색을 칠한다.
	test("side: 파일 / 범위 / 구분자 / side 네 조각", () => {
		expect(grabLabelParts(base.path, sideSnip).map((p) => p.kind)).toEqual([
			"file",
			"range",
			"sep",
			"side",
		]);
	});

	test("old side는 side-old kind로 — new와 다른 색을 받는다", () => {
		const parts = grabLabelParts("a/b.ts", { ...sideSnip, side: "old" });
		expect(parts.at(-1)).toEqual({ text: "old side", kind: "side-old" });
	});

	test("mixed: old·new가 각각 제 색을 받는다", () => {
		const parts = grabLabelParts("a/b.ts", {
			kind: "mixed",
			oldStart: 2,
			oldEnd: 2,
			newStart: 2,
			newEnd: 3,
			rows: [],
		});
		expect(parts.map((p) => p.kind)).toEqual([
			"file",
			"sep",
			"side-old",
			"sep",
			"side",
		]);
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

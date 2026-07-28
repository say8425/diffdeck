import "./happydom.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { resolveTextTarget } from "../browser/grab/textSelection.ts";

interface RowSpec {
	line: number;
	type: string;
	index: string;
	text?: string;
}

const makeFile = (id: string): { host: HTMLElement; root: ShadowRoot } => {
	const host = document.createElement("diffs-container");
	const fold = document.createElement("button");
	fold.dataset.fold = id;
	host.append(fold);
	const root = host.attachShadow({ mode: "open" });
	document.body.append(host);
	return { host, root };
};

// pre[data-diff-type] > code(...cols) > div[data-line] 최소 재현
const addColumn = (
	root: ShadowRoot,
	diffType: "single" | "split",
	colAttr: "" | "data-deletions" | "data-additions",
	rows: RowSpec[],
): HTMLElement[] => {
	let pre = root.querySelector(
		`pre[data-diff-type="${diffType}"]`,
	) as HTMLElement | null;
	if (!pre) {
		pre = document.createElement("pre");
		pre.setAttribute("data-diff-type", diffType);
		root.append(pre);
	}
	const code = document.createElement("code");
	code.setAttribute("data-code", "");
	if (colAttr) code.setAttribute(colAttr, "");
	pre.append(code);
	return rows.map((r) => {
		const div = document.createElement("div");
		div.setAttribute("data-line", String(r.line));
		div.setAttribute("data-line-type", r.type);
		div.setAttribute("data-line-index", r.index);
		div.append(document.createTextNode(r.text ?? `line-${r.line}\n`));
		code.append(div);
		return div;
	});
};

const endpointsOf = (a: Node, b: Node) => ({
	range: {
		startContainer: a.firstChild ?? a,
		startOffset: 0,
		endContainer: b.firstChild ?? b,
		endOffset: 1,
	},
	backward: false,
});

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("resolveTextTarget — unified", () => {
	test("같은 side(new) 두 행 → side kind + 포커스 행 앵커", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "change-addition", index: "1,1" },
			{ line: 3, type: "change-addition", index: "2,2" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[1], rows[2]), "unified");
		expect(target).toEqual({
			fileId: "src/a.ts",
			range: { kind: "side", side: "new", startLine: 2, endLine: 3 },
			anchorRowEl: rows[2],
		});
	});
	test("삭제행은 data-line이 old 번호 → old side", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 5, type: "change-deletion", index: "4,4" },
			{ line: 6, type: "change-deletion", index: "5,5" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[0], rows[1]), "unified");
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 5,
			endLine: 6,
		});
	});
	test("삭제→추가 크로스 사이드 → mixed(끝점 보존)", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 5, type: "change-deletion", index: "4,4" },
			{ line: 5, type: "change-addition", index: "5,5" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[0], rows[1]), "unified");
		expect(target?.range).toEqual({
			kind: "mixed",
			start: { side: "old", line: 5 },
			end: { side: "new", line: 5 },
		});
	});
	test("backward 드래그 → anchorRowEl은 문서상 첫 행(포커스 쪽)", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
		]);
		const target = resolveTextTarget(
			{ ...endpointsOf(rows[0], rows[1]), backward: true },
			"unified",
		);
		expect(target?.anchorRowEl).toBe(rows[0]);
	});
});

describe("resolveTextTarget — 클램프/무효 끝점", () => {
	test("행 밖(헤더 등) 끝점은 intersectsNode로 첫/끝 행 클램프", () => {
		const { root } = makeFile("src/a.ts");
		const header = document.createElement("div");
		header.setAttribute("data-diffs-header", "");
		header.append(document.createTextNode("src/a.ts"));
		root.prepend(header);
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
		]);
		const target = resolveTextTarget(endpointsOf(header, rows[1]), "unified");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 2,
		});
	});
	test("거터 끝점은 같은 컬럼의 data-line-index로 행 복구", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 3, type: "context", index: "2,2" },
		]);
		const code = rows[0].closest("code") as HTMLElement;
		const gutter = document.createElement("div");
		gutter.setAttribute("data-line-index", "2,2");
		gutter.setAttribute("data-column-number", "3");
		code.prepend(gutter);
		const target = resolveTextTarget(endpointsOf(gutter, rows[0]), "unified");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 3,
			endLine: 3,
		});
	});
	test("양쪽 끝점 다 shadow root 밖(light DOM) → null", () => {
		const div = document.createElement("div");
		div.append(document.createTextNode("plain"));
		document.body.append(div);
		expect(resolveTextTarget(endpointsOf(div, div), "unified")).toBeNull();
	});
	test("한쪽만 유효(다른 쪽 light DOM) → 그 파일 마지막 행까지 클램프", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
			{ line: 3, type: "context", index: "2,2" },
		]);
		const outside = document.createElement("div");
		outside.append(document.createTextNode("below"));
		document.body.append(outside);
		const target = resolveTextTarget(endpointsOf(rows[0], outside), "unified");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 3,
		});
	});
	test("크로스 파일: anchor 파일로 클램프", () => {
		const a = makeFile("src/a.ts");
		const b = makeFile("src/b.ts");
		const rowsA = addColumn(a.root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
		]);
		const rowsB = addColumn(b.root, "single", "", [
			{ line: 9, type: "context", index: "0,0" },
		]);
		const target = resolveTextTarget(
			endpointsOf(rowsA[0], rowsB[0]),
			"unified",
		);
		expect(target?.fileId).toBe("src/a.ts");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 2,
		});
	});
	test("크로스 파일 backward: anchor는 end 쪽 파일 + 첫 행 클램프", () => {
		const a = makeFile("src/a.ts");
		const b = makeFile("src/b.ts");
		const rowsA = addColumn(a.root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
		]);
		const rowsB = addColumn(b.root, "single", "", [
			{ line: 9, type: "context", index: "0,0" },
			{ line: 10, type: "context", index: "1,1" },
		]);
		const target = resolveTextTarget(
			{ ...endpointsOf(rowsA[0], rowsB[1]), backward: true },
			"unified",
		);
		expect(target?.fileId).toBe("src/b.ts");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 9,
			endLine: 10,
		});
		expect(target?.anchorRowEl).toBe(rowsB[0]);
	});
	test("한쪽만 유효(END만 유효, START는 light DOM) → 그 파일 첫 행까지 클램프", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
			{ line: 3, type: "context", index: "2,2" },
		]);
		const outside = document.createElement("div");
		outside.append(document.createTextNode("above"));
		document.body.append(outside);
		const target = resolveTextTarget(endpointsOf(outside, rows[2]), "unified");
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 3,
		});
		expect(target?.anchorRowEl).toBe(rows[2]);
	});
	test("한쪽만 유효하지만 그 행 자체가 없음(헤더) → null(안전 저하)", () => {
		const { root } = makeFile("src/a.ts");
		const header = document.createElement("div");
		header.setAttribute("data-diffs-header", "");
		header.append(document.createTextNode("src/a.ts"));
		root.append(header);
		const outside = document.createElement("div");
		outside.append(document.createTextNode("outside"));
		document.body.append(outside);
		expect(
			resolveTextTarget(endpointsOf(header, outside), "unified"),
		).toBeNull();
	});
	test("같은 root, 두 끝점 모두 행 밖 + 사이 구간에 행 미교차 → null", () => {
		const { root } = makeFile("src/a.ts");
		const headerA = document.createElement("div");
		headerA.append(document.createTextNode("A"));
		const headerB = document.createElement("div");
		headerB.append(document.createTextNode("B"));
		root.append(headerA, headerB);
		addColumn(root, "single", "", [{ line: 1, type: "context", index: "0,0" }]);
		expect(
			resolveTextTarget(endpointsOf(headerA, headerB), "unified"),
		).toBeNull();
	});
	test("컨테이너가 섀도우 루트 바로 밑 텍스트 노드(엘리먼트 아님) → 그 끝점은 무효", () => {
		const { root } = makeFile("src/a.ts");
		const text = document.createTextNode("plain");
		root.append(text);
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
		]);
		const target = resolveTextTarget(
			{
				range: {
					startContainer: text,
					startOffset: 0,
					endContainer: rows[0].firstChild ?? rows[0],
					endOffset: 1,
				},
				backward: false,
			},
			"unified",
		);
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 1,
		});
	});
});

describe("resolveTextTarget — split", () => {
	test("split context 행 side는 컬럼(data-deletions)으로 판정", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "split", "data-deletions", [
			{ line: 4, type: "context", index: "3,3" },
			{ line: 5, type: "context", index: "4,4" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[0], rows[1]), "split");
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 4,
			endLine: 5,
		});
	});
	test("split 크로스 컬럼 → anchor 컬럼으로 클램프(단일 side), mixed 금지", () => {
		const { root } = makeFile("src/a.ts");
		const delRows = addColumn(root, "split", "data-deletions", [
			{ line: 4, type: "change-deletion", index: "3,3" },
			{ line: 5, type: "change-deletion", index: "4,4" },
		]);
		const addRows = addColumn(root, "split", "data-additions", [
			{ line: 4, type: "change-addition", index: "3,3" },
		]);
		const target = resolveTextTarget(
			endpointsOf(delRows[0], addRows[0]),
			"split",
		);
		expect(target?.range.kind).toBe("side");
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 4,
			endLine: 5,
		});
	});
	test("split 크로스 컬럼 클램프는 실제 교집합을 쓴다(두 번째 삭제행부터 시작하면 첫 행은 제외)", () => {
		const { root } = makeFile("src/a.ts");
		const delRows = addColumn(root, "split", "data-deletions", [
			{ line: 4, type: "change-deletion", index: "3,3" },
			{ line: 5, type: "change-deletion", index: "4,4" },
		]);
		const addRows = addColumn(root, "split", "data-additions", [
			{ line: 4, type: "change-addition", index: "3,3" },
		]);
		const target = resolveTextTarget(
			endpointsOf(delRows[1], addRows[0]),
			"split",
		);
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 5,
			endLine: 5,
		});
	});
});

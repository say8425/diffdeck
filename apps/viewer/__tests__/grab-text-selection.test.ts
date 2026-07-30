import "./happydom.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import {
	charOffsetInRow,
	resolveTextTarget,
} from "../browser/grab/textSelection.ts";

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
		// endpointsOf가 만드는 끝점은 행의 텍스트 노드 안(offset 0/1)이라 실제
		// 텍스트 드래그와 구분 불가능하다 — direct && 클램프 없음이므로 chars가 붙는다.
		expect(target).toEqual({
			fileId: "src/a.ts",
			range: {
				kind: "side",
				side: "new",
				startLine: 2,
				endLine: 3,
				chars: { start: 0, end: 1 },
			},
		});
	});
	test("삭제행은 data-line이 old 번호 → old side", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 5, type: "change-deletion", index: "4,4" },
			{ line: 6, type: "change-deletion", index: "5,5" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[0], rows[1]), "unified");
		// endpointsOf 끝점이 행 텍스트 노드 안이라 chars가 붙는다(위 주석 참고).
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 5,
			endLine: 6,
			chars: { start: 0, end: 1 },
		});
	});
	test("삭제→추가 크로스 사이드 → mixed(끝점 보존)", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 5, type: "change-deletion", index: "4,4" },
			{ line: 5, type: "change-addition", index: "5,5" },
		]);
		const target = resolveTextTarget(endpointsOf(rows[0], rows[1]), "unified");
		// endpointsOf 끝점이 행 텍스트 노드 안이라 mixed에도 chars가 붙는다.
		expect(target?.range).toEqual({
			kind: "mixed",
			start: { side: "old", line: 5 },
			end: { side: "new", line: 5 },
			chars: { start: 0, end: 1 },
		});
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
		// 두 끝점 다 같은 컬럼 안 → 클램프 없음 → chars가 붙는다.
		expect(target?.range).toEqual({
			kind: "side",
			side: "old",
			startLine: 4,
			endLine: 5,
			chars: { start: 0, end: 1 },
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

describe("charOffsetInRow", () => {
	const rowWithTokens = (): Element => {
		const div = document.createElement("div");
		div.setAttribute("data-line", "1");
		const a = document.createElement("span");
		a.append(document.createTextNode("const"));
		const b = document.createElement("span");
		b.append(document.createTextNode(" store"));
		div.append(a, b, document.createTextNode(" = 1;"));
		document.body.append(div);
		return div;
	};

	test("첫 텍스트 노드 안의 오프셋", () => {
		const row = rowWithTokens();
		const first = row.firstChild?.firstChild as Text;
		expect(charOffsetInRow(row, first, 2)).toBe(2);
	});

	test("두 번째 토큰 안의 오프셋은 앞 토큰 길이를 누적한다", () => {
		const row = rowWithTokens();
		const second = row.childNodes[1].firstChild as Text;
		expect(charOffsetInRow(row, second, 3)).toBe(5 + 3);
	});

	test("행의 마지막 텍스트 노드 끝", () => {
		const row = rowWithTokens();
		const last = row.childNodes[2] as Text;
		expect(charOffsetInRow(row, last, last.data.length)).toBe(
			(row.textContent ?? "").length,
		);
	});

	test("끝점이 행 요소 자체면 자식 인덱스까지의 길이", () => {
		const row = rowWithTokens();
		expect(charOffsetInRow(row, row, 0)).toBe(0);
		expect(charOffsetInRow(row, row, 2)).toBe(5 + 6);
	});

	test("행 밖 노드는 null", () => {
		const row = rowWithTokens();
		const outside = document.createElement("div");
		outside.append(document.createTextNode("nope"));
		document.body.append(outside);
		expect(charOffsetInRow(row, outside.firstChild as Text, 1)).toBeNull();
	});

	test("행 안이지만 텍스트 노드 워크에서 못 찾는 끝점(엘리먼트 자체)은 null", () => {
		// node가 행에 포함돼 있어도(contains) 텍스트 노드가 아니면 TreeWalker가
		// 절대 만나지 못한다 — 워커가 끝까지 순회한 뒤 정상 종료하는 경로.
		const row = rowWithTokens();
		const span = row.firstChild as Element;
		expect(charOffsetInRow(row, span, 0)).toBeNull();
	});

	test("빈 행(개행만)", () => {
		const div = document.createElement("div");
		div.setAttribute("data-line", "2");
		div.append(document.createTextNode("\n"));
		document.body.append(div);
		expect(charOffsetInRow(div, div.firstChild as Text, 1)).toBe(1);
	});
});

describe("resolveTextTarget — chars 게이팅", () => {
	test("양 끝점이 행 안에 직접 떨어지면 chars를 세운다", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0", text: "alpha beta\n" },
			{ line: 2, type: "context", index: "1,1", text: "gamma delta\n" },
		]);
		const target = resolveTextTarget(
			{
				range: {
					startContainer: rows[0].firstChild as Text,
					startOffset: 2,
					endContainer: rows[1].firstChild as Text,
					endOffset: 5,
				},
				backward: false,
			},
			"unified",
		);
		expect(target?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 2,
			chars: { start: 2, end: 5 },
		});
	});

	test("한 행 안의 부분 선택", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 7, type: "context", index: "6,6", text: "const store = 1;\n" },
		]);
		const t = resolveTextTarget(
			{
				range: {
					startContainer: rows[0].firstChild as Text,
					startOffset: 6,
					endContainer: rows[0].firstChild as Text,
					endOffset: 11,
				},
				backward: false,
			},
			"unified",
		);
		expect(t?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 7,
			endLine: 7,
			chars: { start: 6, end: 11 },
		});
	});

	// 클램프가 일어난 경우 chars는 의미가 없다 → 생략해 줄 전체로 떨어진다
	test("한쪽 끝점이 행 밖(클램프)이면 chars가 없다", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0" },
			{ line: 2, type: "context", index: "1,1" },
			{ line: 3, type: "context", index: "2,2" },
		]);
		const outside = document.createElement("div");
		outside.append(document.createTextNode("above"));
		document.body.append(outside);
		const t = resolveTextTarget(endpointsOf(outside, rows[2]), "unified");
		expect(t?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 3,
		});
		expect("chars" in (t?.range ?? {})).toBe(false);
	});

	test("split 크로스 컬럼 클램프는 chars가 없다", () => {
		const { root } = makeFile("src/a.ts");
		const del = addColumn(root, "split", "data-deletions", [
			{ line: 5, type: "change-deletion", index: "4,4", text: "old line\n" },
		]);
		const add = addColumn(root, "split", "data-additions", [
			{ line: 5, type: "change-addition", index: "4,4", text: "new line\n" },
		]);
		const t = resolveTextTarget(
			{
				range: {
					startContainer: del[0].firstChild as Text,
					startOffset: 1,
					endContainer: add[0].firstChild as Text,
					endOffset: 3,
				},
				backward: false,
			},
			"split",
		);
		expect(t?.range.kind).toBe("side");
		expect("chars" in t!.range).toBe(false);
	});

	test("unified 크로스 사이드(mixed)도 chars를 세운다", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 5, type: "change-deletion", index: "4,4", text: "minus one\n" },
			{ line: 5, type: "change-addition", index: "5,5", text: "plus one\n" },
		]);
		const t = resolveTextTarget(
			{
				range: {
					startContainer: rows[0].firstChild as Text,
					startOffset: 2,
					endContainer: rows[1].firstChild as Text,
					endOffset: 4,
				},
				backward: false,
			},
			"unified",
		);
		expect(t?.range).toEqual({
			kind: "mixed",
			start: { side: "old", line: 5 },
			end: { side: "new", line: 5 },
			chars: { start: 2, end: 4 },
		});
	});

	// direct(own !== null)는 "[data-line] 조상이 있다"만 보장하지, 끝점이 텍스트
	// 노드 안이라는 것까지는 보장하지 않는다 — 토큰 <span> 경계 자체를 가리키는
	// 끝점도 direct다. charOffsetInRow가 그런 Element 끝점에서 null을 반환하므로
	// (텍스트 워커가 절대 못 찾는다) chars는 조용히 생략되고 줄 전체로 떨어진다.
	// Task 3가 이 안전망에 의존하므로 end-to-end로 고정해 둔다.
	test("direct하지만 끝점이 텍스트 노드가 아닌 토큰 엘리먼트면 chars가 없다", () => {
		const { root } = makeFile("src/a.ts");
		const rows = addColumn(root, "single", "", [
			{ line: 1, type: "context", index: "0,0", text: "alpha\n" },
			{ line: 2, type: "context", index: "1,1", text: "beta\n" },
		]);
		const span0 = document.createElement("span");
		span0.append(rows[0].firstChild as Text);
		rows[0].append(span0);
		const span1 = document.createElement("span");
		span1.append(rows[1].firstChild as Text);
		rows[1].append(span1);
		const t = resolveTextTarget(
			{
				range: {
					startContainer: span0,
					startOffset: 0,
					endContainer: span1,
					endOffset: 0,
				},
				backward: false,
			},
			"unified",
		);
		expect(t?.range).toEqual({
			kind: "side",
			side: "new",
			startLine: 1,
			endLine: 2,
		});
		expect("chars" in (t?.range ?? {})).toBe(false);
	});
});

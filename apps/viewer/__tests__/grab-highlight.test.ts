import "./happydom.ts";
import { describe, expect, test } from "bun:test";
import { parseDiffFromFile } from "@diffdeck/diffs";
import {
	createGrabHighlighter,
	GRAB_HIGHLIGHT_NAME,
	type GrabRow,
	type HighlightRegistryLike,
	lineFor,
	type RangeLike,
	rowsInRange,
} from "../browser/grab/highlight.ts";
import { extractSnippet } from "../browser/grab/snippet.ts";

// GrabRow 팩토리. el은 신원 비교용이라 빈 div면 충분하다.
const row = (
	side: "old" | "new",
	line: number,
	altLine: number | null = null,
): GrabRow => ({
	el: document.createElement("div"),
	side,
	line,
	altLine,
});

// createGrabHighlighter 테스트용 fake registry/range. 캡처하는 외부 변수가
// 없어(unicorn/consistent-function-scoping) describe 밖 모듈 스코프에 둔다.
const fakeRegistry = () => {
	const store = new Map<string, unknown>();
	return {
		store,
		registry: {
			set: (name: string, value: unknown) => {
				store.set(name, value);
			},
			delete: (name: string) => {
				store.delete(name);
			},
		} satisfies HighlightRegistryLike,
	};
};

const fakeRange = (): RangeLike & {
	selected: Node | null;
	startArgs: [Node, number] | null;
	endArgs: [Node, number] | null;
} => {
	const r = {
		selected: null as Node | null,
		startArgs: null as [Node, number] | null,
		endArgs: null as [Node, number] | null,
		selectNodeContents(node: Node) {
			r.selected = node;
		},
		setStart(node: Node, offset: number) {
			r.startArgs = [node, offset];
		},
		setEnd(node: Node, offset: number) {
			r.endArgs = [node, offset];
		},
	};
	return r;
};

describe("lineFor", () => {
	test("자기 side면 data-line 번호를 대표한다", () => {
		expect(lineFor(row("old", 5), "old", "unified")).toBe(5);
		expect(lineFor(row("new", 7), "new", "split")).toBe(7);
	});

	test("unified context 행은 old·new 양 스트림을 모두 대표한다", () => {
		// unified context: data-line = new 번호(2), data-alt-line = old 번호(3)
		const ctx = row("new", 2, 3);
		expect(lineFor(ctx, "new", "unified")).toBe(2);
		expect(lineFor(ctx, "old", "unified")).toBe(3);
	});

	test("split context 행은 자기 컬럼 side만 대표한다 — 반대 side는 null", () => {
		// split additions 컬럼의 context 행: 반대편 번호가 alt에 있어도
		// old 범위가 이 컬럼을 물들이면 안 된다.
		const ctx = row("new", 2, 3);
		expect(lineFor(ctx, "new", "split")).toBe(2);
		expect(lineFor(ctx, "old", "split")).toBeNull();
	});

	test("change 행은 altLine이 없어 반대 side를 대표하지 않는다", () => {
		expect(lineFor(row("old", 5), "new", "unified")).toBeNull();
		expect(lineFor(row("new", 5), "old", "unified")).toBeNull();
	});
});

describe("rowsInRange — side kind", () => {
	test("범위 안 같은 side만, 경계 포함", () => {
		const rows = [row("new", 1), row("new", 2), row("new", 3), row("new", 4)];
		const got = rowsInRange(
			rows,
			{ kind: "side", side: "new", startLine: 2, endLine: 3 },
			"unified",
		);
		expect(got).toEqual([{ el: rows[1].el }, { el: rows[2].el }]);
	});

	test("다른 side 행은 제외한다", () => {
		const rows = [row("old", 2), row("new", 2)];
		const got = rowsInRange(
			rows,
			{ kind: "side", side: "new", startLine: 1, endLine: 9 },
			"unified",
		);
		expect(got).toEqual([{ el: rows[1].el }]);
	});

	test("범위 밖만 있으면 빈 배열", () => {
		const rows = [row("new", 10), row("new", 11)];
		expect(
			rowsInRange(
				rows,
				{ kind: "side", side: "new", startLine: 1, endLine: 2 },
				"unified",
			),
		).toEqual([]);
	});

	// 핵심 회귀 케이스: 이게 없으면 순진한 side 비교 구현이 그대로 통과한다.
	test("unified old-side 범위는 사이의 context 행을 포함한다", () => {
		// old: keep-a(1) drop-1(2) keep-b(3) keep-c(4) drop-2(5) keep-d(6)
		// new: keep-a(1)           keep-b(2) keep-c(3)           keep-d(4)
		const rows = [
			row("new", 1, 1), // keep-a  (old 1)
			row("old", 2), // -drop-1
			row("new", 2, 3), // keep-b  (old 3)
			row("new", 3, 4), // keep-c  (old 4)
			row("old", 5), // -drop-2
			row("new", 4, 6), // keep-d  (old 6)
		];
		const got = rowsInRange(
			rows,
			{ kind: "side", side: "old", startLine: 2, endLine: 5 },
			"unified",
		);
		// drop-1, keep-b, keep-c, drop-2 — 클립보드에 들어가는 4줄과 같다.
		expect(got).toEqual([
			{ el: rows[1].el },
			{ el: rows[2].el },
			{ el: rows[3].el },
			{ el: rows[4].el },
		]);
	});

	test("split old-side 범위는 additions 컬럼 context 행을 칠하지 않는다", () => {
		const delCtx = row("old", 3, 2); // deletions 컬럼 context
		const addCtx = row("new", 2, 3); // additions 컬럼 context (같은 줄)
		const got = rowsInRange(
			[delCtx, addCtx],
			{ kind: "side", side: "old", startLine: 1, endLine: 9 },
			"split",
		);
		expect(got).toEqual([{ el: delCtx.el }]);
	});
});

describe("rowsInRange — mixed kind", () => {
	const rows = [row("old", 5), row("new", 5), row("new", 6), row("new", 7)];

	test("양끝을 찾으면 그 사이 문서순 슬라이스", () => {
		const got = rowsInRange(
			rows,
			{
				kind: "mixed",
				start: { side: "old", line: 5 },
				end: { side: "new", line: 6 },
			},
			"unified",
		);
		expect(got).toEqual([
			{ el: rows[0].el },
			{ el: rows[1].el },
			{ el: rows[2].el },
		]);
	});

	test("start만 찾으면 그 행부터 끝까지 (아래쪽 잘림)", () => {
		const got = rowsInRange(
			rows,
			{
				kind: "mixed",
				start: { side: "old", line: 5 },
				end: { side: "new", line: 99 },
			},
			"unified",
		);
		expect(got).toEqual([
			{ el: rows[0].el },
			{ el: rows[1].el },
			{ el: rows[2].el },
			{ el: rows[3].el },
		]);
	});

	test("end만 찾으면 처음부터 그 행까지 (위쪽 잘림)", () => {
		const got = rowsInRange(
			rows,
			{
				kind: "mixed",
				start: { side: "old", line: 99 },
				end: { side: "new", line: 6 },
			},
			"unified",
		);
		expect(got).toEqual([
			{ el: rows[0].el },
			{ el: rows[1].el },
			{ el: rows[2].el },
		]);
	});

	test("둘 다 못 찾으면 빈 배열", () => {
		const got = rowsInRange(
			rows,
			{
				kind: "mixed",
				start: { side: "old", line: 98 },
				end: { side: "new", line: 99 },
			},
			"unified",
		);
		expect(got).toEqual([]);
	});

	test("빈 행 목록", () => {
		expect(
			rowsInRange(
				[],
				{
					kind: "mixed",
					start: { side: "old", line: 1 },
					end: { side: "new", line: 1 },
				},
				"unified",
			),
		).toEqual([]);
	});

	// split의 행 목록은 컬럼별로 묶여 있어(deletions 컬럼 전부 → additions 컬럼
	// 전부) mixed(크로스사이드)의 문서순 슬라이스가 컬럼 경계를 넘으면 반대
	// 컬럼의 무관한 구간까지 그럴듯하게 칠한다 — 같은 rows·같은 끝점으로 위
	// "양끝을 찾으면…" 테스트는 3행을 돌려주는데, diffStyle만 split으로 바꾸면
	// 무조건 빈 배열이어야 한다.
	test("split이면 mixed 조합은 무조건 빈 배열이다", () => {
		const got = rowsInRange(
			rows,
			{
				kind: "mixed",
				start: { side: "old", line: 5 },
				end: { side: "new", line: 6 },
			},
			"split",
		);
		expect(got).toEqual([]);
	});
});

// 교차 검증: rowsInRange 단독 테스트는 기대값을 구현과 같은 오해로 적게
// 되므로 이 불일치를 원리적으로 못 잡는다. extractSnippet에 같은 range를
// 먹여 "복사되는 라인 수 == 하이라이트되는 행 수"를 대조한다.
// 전제: ① 범위가 파일 길이 안(extractSnippet은 arr.length로 클램프하지만
// 행 목록엔 클램프 개념이 없다), ② 모든 대상 행이 렌더된 상태(가상화 잘림 없음).
describe("extractSnippet과의 교차 검증", () => {
	const OLD = ["keep-a", "drop-1", "keep-b", "keep-c", "drop-2", "keep-d"].join(
		"\n",
	);
	const NEW = ["keep-a", "keep-b", "keep-c", "keep-d"].join("\n");

	test("unified old-side가 context를 가로지를 때 행 수가 일치한다", () => {
		const fileDiff = parseDiffFromFile(
			{ name: "ctx.ts", contents: OLD },
			{ name: "ctx.ts", contents: NEW },
		);
		const range = {
			kind: "side" as const,
			side: "old" as const,
			startLine: 2,
			endLine: 5,
		};
		const snippet = extractSnippet(fileDiff, range);
		expect(snippet?.kind).toBe("side");
		if (snippet?.kind !== "side") throw new Error("expected side snippet");

		// unified 렌더 마크업의 행 모델 (data-line = 자기 side, data-alt-line = 반대편)
		const rows = [
			row("new", 1, 1),
			row("old", 2),
			row("new", 2, 3),
			row("new", 3, 4),
			row("old", 5),
			row("new", 4, 6),
		];
		expect(rowsInRange(rows, range, "unified")).toHaveLength(
			snippet.lines.length,
		);
	});
});

describe("createGrabHighlighter", () => {
	test("paint는 행마다 Range를 만들어 레지스트리에 등록한다", () => {
		const { store, registry } = fakeRegistry();
		const made: (RangeLike & { selected: Node | null })[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const a = document.createElement("div");
		const b = document.createElement("div");
		hl.paint([{ el: a }, { el: b }]);

		expect(made).toHaveLength(2);
		expect(made[0].selected).toBe(a);
		expect(made[1].selected).toBe(b);
		expect(store.get(GRAB_HIGHLIGHT_NAME)).toEqual({ ranges: made });
	});

	test("행이 0개면 clear와 같이 동작한다", () => {
		const { store, registry } = fakeRegistry();
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: fakeRange,
		});
		hl.paint([{ el: document.createElement("div") }]);
		expect(store.has(GRAB_HIGHLIGHT_NAME)).toBe(true);
		hl.paint([]);
		expect(store.has(GRAB_HIGHLIGHT_NAME)).toBe(false);
	});

	test("clear는 멱등이다", () => {
		const { store, registry } = fakeRegistry();
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: fakeRange,
		});
		hl.paint([{ el: document.createElement("div") }]);
		hl.clear();
		hl.clear();
		expect(store.has(GRAB_HIGHLIGHT_NAME)).toBe(false);
	});

	test("registry가 null이면 paint/clear 모두 무해하다 (미지원 브라우저)", () => {
		let created = 0;
		const hl = createGrabHighlighter({
			registry: null,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				created += 1;
				return fakeRange();
			},
		});
		expect(() => {
			hl.paint([{ el: document.createElement("div") }]);
			hl.clear();
		}).not.toThrow();
		// Range조차 만들지 않는다 — 미지원 브라우저에서 낭비 없음.
		expect(created).toBe(0);
	});
});

describe("rowsInRange — chars", () => {
	test("한 행 부분 선택은 그 행에 오프셋이 실린다", () => {
		const r = row("new", 3);
		const got = rowsInRange(
			[r],
			{
				kind: "side",
				side: "new",
				startLine: 3,
				endLine: 3,
				chars: { start: 2, end: 7 },
			},
			"unified",
		);
		expect(got).toEqual([{ el: r.el, start: 2, end: 7 }]);
	});

	test("여러 행이면 첫/끝만 오프셋을 갖고 가운데는 전체다", () => {
		const rows = [row("new", 1), row("new", 2), row("new", 3)];
		const got = rowsInRange(
			rows,
			{
				kind: "side",
				side: "new",
				startLine: 1,
				endLine: 3,
				chars: { start: 4, end: 6 },
			},
			"unified",
		);
		expect(got).toEqual([
			{ el: rows[0].el, start: 4 },
			{ el: rows[1].el },
			{ el: rows[2].el, end: 6 },
		]);
	});

	test("chars가 없으면 전 행이 오프셋 없이 나온다", () => {
		const rows = [row("new", 1), row("new", 2)];
		const got = rowsInRange(
			rows,
			{ kind: "side", side: "new", startLine: 1, endLine: 2 },
			"unified",
		);
		expect(got).toEqual([{ el: rows[0].el }, { el: rows[1].el }]);
	});
});

describe("paint — 부분 범위", () => {
	// 실제 텍스트를 가진 행이 필요하다 — 오프셋을 노드 좌표로 변환하기 때문
	const textRow = (text: string): Element => {
		const div = document.createElement("div");
		div.setAttribute("data-line", "1");
		div.append(document.createTextNode(text));
		document.body.append(div);
		return div;
	};

	test("오프셋이 없으면 selectNodeContents", () => {
		const { registry } = fakeRegistry();
		const made: ReturnType<typeof fakeRange>[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const el = textRow("const store = 1;");
		hl.paint([{ el }]);
		expect(made[0].selected).toBe(el);
		expect(made[0].startArgs).toBeNull();
	});

	test("오프셋이 있으면 setStart/setEnd를 텍스트 노드 좌표로 호출", () => {
		const { registry } = fakeRegistry();
		const made: ReturnType<typeof fakeRange>[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const el = textRow("const store = 1;");
		hl.paint([{ el, start: 6, end: 11 }]);
		expect(made[0].selected).toBeNull();
		expect(made[0].startArgs).toEqual([el.firstChild, 6]);
		expect(made[0].endArgs).toEqual([el.firstChild, 11]);
	});

	test("start만 있으면 끝은 행 끝까지", () => {
		const { registry } = fakeRegistry();
		const made: ReturnType<typeof fakeRange>[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const el = textRow("abcdef");
		hl.paint([{ el, start: 2 }]);
		expect(made[0].startArgs).toEqual([el.firstChild, 2]);
		expect(made[0].endArgs).toEqual([el.firstChild, 6]);
	});

	test("오프셋을 노드로 못 찾으면 selectNodeContents로 폴백", () => {
		const { registry } = fakeRegistry();
		const made: ReturnType<typeof fakeRange>[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const empty = document.createElement("div");
		document.body.append(empty);
		hl.paint([{ el: empty, start: 3, end: 5 }]);
		expect(made[0].selected).toBe(empty);
	});

	// 실제 행은 토큰별 <span>으로 쪼개져 텍스트 노드가 여러 개다 — locateOffset이
	// 첫 노드를 건너뛰고 두 번째 노드에서 오프셋을 찾는 경로를 덮는다.
	test("여러 텍스트 노드에 걸친 오프셋은 두 번째 노드에서 찾는다", () => {
		const { registry } = fakeRegistry();
		const made: ReturnType<typeof fakeRange>[] = [];
		const hl = createGrabHighlighter({
			registry,
			createHighlight: (ranges) => ({ ranges }),
			createRange: () => {
				const r = fakeRange();
				made.push(r);
				return r;
			},
		});
		const el = document.createElement("div");
		const first = document.createTextNode("const ");
		const second = document.createTextNode("store");
		el.append(first, second);
		document.body.append(el);
		hl.paint([{ el, start: 8, end: 10 }]);
		expect(made[0].startArgs).toEqual([second, 2]);
		expect(made[0].endArgs).toEqual([second, 4]);
	});
});

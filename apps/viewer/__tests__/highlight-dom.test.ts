import "./happydom.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { highlightDom } from "../browser/search/highlightDom.ts";
import type { SearchMatch } from "../browser/search/searchIndex.ts";

const makeLine = (n: number, text: string, type = "addition"): HTMLElement => {
	const el = document.createElement("div");
	el.setAttribute("data-line", String(n));
	el.setAttribute("data-line-type", type);
	el.textContent = text;
	return el;
};

// 실제 렌더 줄처럼 텍스트가 여러 span(신택스 토큰·intraline word-diff)으로
// 쪼개진 줄: 각 segment가 별도 텍스트 노드가 된다.
const makeTokenizedLine = (
	n: number,
	segments: readonly string[],
	type = "addition",
): HTMLElement => {
	const el = document.createElement("div");
	el.setAttribute("data-line", String(n));
	el.setAttribute("data-line-type", type);
	for (const segment of segments) {
		const span = document.createElement("span");
		span.textContent = segment;
		el.appendChild(span);
	}
	return el;
};

let root: HTMLElement;

beforeEach(() => {
	root = document.createElement("div");
	document.body.appendChild(root);
});

describe("highlightDom", () => {
	test("empty query unwraps any existing marks and restores the text", () => {
		const line = makeLine(1, "foo bar foo", "addition");
		root.appendChild(line);
		// Pre-existing marks, as if a previous non-empty query had run.
		highlightDom(root, "foo", null, "f1");
		expect(root.querySelectorAll("mark.cc-find-hit").length).toBe(2);

		highlightDom(root, "", null, "f1");

		expect(root.querySelectorAll("mark.cc-find-hit").length).toBe(0);
		expect(line.textContent).toBe("foo bar foo");
	});

	test("a query matching twice in one line produces two marks and preserves surrounding text", () => {
		const line = makeLine(1, "foo bar foo", "addition");
		root.appendChild(line);

		highlightDom(root, "foo", null, "f1");

		const marks = root.querySelectorAll("mark.cc-find-hit");
		expect(marks.length).toBe(2);
		expect(marks[0]?.textContent).toBe("foo");
		expect(marks[1]?.textContent).toBe("foo");
		expect(line.textContent).toBe("foo bar foo");
	});

	test("only the occurrence at the active column gets cc-find-hit--active", () => {
		const line = makeLine(1, "foo bar foo", "addition");
		root.appendChild(line);
		const active: SearchMatch = {
			fileId: "f1",
			side: "additions",
			lineNumber: 1,
			column: 8,
			length: 3,
		};

		highlightDom(root, "foo", active, "f1");

		const marks = root.querySelectorAll("mark.cc-find-hit");
		expect(marks.length).toBe(2);
		expect(marks[0]?.classList.contains("cc-find-hit--active")).toBe(false);
		expect(marks[1]?.classList.contains("cc-find-hit--active")).toBe(true);
	});

	test("a deletion line maps to side deletions, and an active deletions match marks it", () => {
		const line = makeLine(2, "foo bar foo", "deletion");
		root.appendChild(line);
		const active: SearchMatch = {
			fileId: "f1",
			side: "deletions",
			lineNumber: 2,
			column: 0,
			length: 3,
		};

		highlightDom(root, "foo", active, "f1");

		const marks = root.querySelectorAll("mark.cc-find-hit");
		expect(marks.length).toBe(2);
		expect(marks[0]?.classList.contains("cc-find-hit--active")).toBe(true);
		expect(marks[1]?.classList.contains("cc-find-hit--active")).toBe(false);
	});

	test("an active match on the wrong side does not mark any occurrence", () => {
		const line = makeLine(1, "foo bar foo", "addition");
		root.appendChild(line);
		const active: SearchMatch = {
			fileId: "f1",
			side: "deletions",
			lineNumber: 1,
			column: 0,
			length: 3,
		};

		highlightDom(root, "foo", active, "f1");

		const marks = root.querySelectorAll("mark.cc-find-hit");
		expect(marks.length).toBe(2);
		for (const mark of marks) {
			expect(mark.classList.contains("cc-find-hit--active")).toBe(false);
		}
	});

	test("a row with a non-numeric data-line is skipped", () => {
		const badLine = document.createElement("div");
		badLine.setAttribute("data-line", "abc");
		badLine.setAttribute("data-line-type", "addition");
		badLine.textContent = "foo bar foo";
		root.appendChild(badLine);

		highlightDom(root, "foo", null, "f1");

		expect(root.querySelectorAll("mark.cc-find-hit").length).toBe(0);
		expect(badLine.textContent).toBe("foo bar foo");
	});

	// 실환경 회귀: 렌더된 diff 줄은 intraline word-diff span과 (하이라이트
	// 완료 후) 신택스 토큰 span으로 텍스트 노드가 쪼개진다. 검색 인덱스는
	// 전체 줄 텍스트로 매치를 세므로, 노드 경계를 가로지르는 매치도 DOM에서
	// 동일하게 마킹되어야 한다 — 안 그러면 카운트는 "1/1"인데 화면 하이라이트가
	// 0개가 된다 (2026-07-28 재현: "export const answer = 43;"에서 "= 43").
	describe("matches spanning multiple text nodes", () => {
		test("a match crossing a token boundary is marked across both nodes", () => {
			// `export const answer = ` | `43` | `;` — intraline diff가 "43"만
			// 감싼 실측 형태. "= 43"은 1번째/2번째 노드에 걸친다.
			const line = makeTokenizedLine(6, ["export const answer = ", "43", ";"]);
			root.appendChild(line);

			highlightDom(root, "= 43", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.length).toBeGreaterThan(0);
			expect(marks.map((m) => m.textContent).join("")).toBe("= 43");
			expect(line.textContent).toBe("export const answer = 43;");
		});

		test("a match spanning three nodes marks every covered segment", () => {
			// 신택스 토큰 렌더 형태: `const` `_` `greeting` … — "const greeting"이
			// 키워드·공백·식별자 세 노드에 걸친다.
			const line = makeTokenizedLine(1, [
				"const",
				" ",
				"greeting",
				" = ",
				'"hello"',
				";",
			]);
			root.appendChild(line);

			highlightDom(root, "const greeting", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.map((m) => m.textContent).join("")).toBe("const greeting");
			expect(line.textContent).toBe('const greeting = "hello";');
		});

		test("the active occurrence spanning nodes gets --active on all its segments", () => {
			const line = makeTokenizedLine(6, ["export const answer = ", "43", ";"]);
			root.appendChild(line);
			const active: SearchMatch = {
				fileId: "f1",
				side: "additions",
				lineNumber: 6,
				column: 20, // "= 43"의 전체 줄 기준 시작 컬럼
				length: 4,
			};

			highlightDom(root, "= 43", active, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.length).toBeGreaterThan(0);
			for (const mark of marks) {
				expect(mark.classList.contains("cc-find-hit--active")).toBe(true);
			}
		});

		test("only the active occurrence is --active when the same query also matches within a single node", () => {
			// 1행: "foo" 단일 노드 매치, 2행: "fo"+"o" 노드 경계 매치(활성).
			const single = makeTokenizedLine(1, ["foo bar"]);
			const crossing = makeTokenizedLine(2, ["fo", "o baz"]);
			root.appendChild(single);
			root.appendChild(crossing);
			const active: SearchMatch = {
				fileId: "f1",
				side: "additions",
				lineNumber: 2,
				column: 0,
				length: 3,
			};

			highlightDom(root, "foo", active, "f1");

			const singleMarks = [...single.querySelectorAll("mark.cc-find-hit")];
			const crossingMarks = [...crossing.querySelectorAll("mark.cc-find-hit")];
			expect(singleMarks.length).toBe(1);
			expect(singleMarks[0]?.classList.contains("cc-find-hit--active")).toBe(
				false,
			);
			expect(crossingMarks.map((m) => m.textContent).join("")).toBe("foo");
			for (const mark of crossingMarks) {
				expect(mark.classList.contains("cc-find-hit--active")).toBe(true);
			}
		});

		test("adjacent same-line occurrences across node boundaries each get their own contiguous marks", () => {
			// "ab" 가 노드 경계에 걸쳐 두 번: "a"+"ba"+"b" → [0,2) 와 [2,4).
			const line = makeTokenizedLine(1, ["a", "ba", "b"]);
			root.appendChild(line);

			highlightDom(root, "ab", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.map((m) => m.textContent).join("")).toBe("abab");
			expect(line.textContent).toBe("abab");
		});

		test("a case-insensitive query crossing nodes marks the original-case text", () => {
			// findRanges는 소문자화한 전체 줄에서 인덱스를 계산하고, mark는 원문
			// 텍스트를 그대로 감싼다 — 교차-노드 경로에서도 정렬이 어긋나면 안
			// 된다.
			const line = makeTokenizedLine(1, ["const", " ", "greeting"]);
			root.appendChild(line);

			highlightDom(root, "CONST GREETING", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.map((m) => m.textContent).join("")).toBe("const greeting");
			expect(line.textContent).toBe("const greeting");
		});

		test("unwrap restores a tokenized line's structure text intact", () => {
			const line = makeTokenizedLine(1, ["const", " ", "greeting"]);
			root.appendChild(line);

			highlightDom(root, "const greeting", null, "f1");
			highlightDom(root, "", null, "f1");

			expect(root.querySelectorAll("mark.cc-find-hit").length).toBe(0);
			expect(line.textContent).toBe("const greeting");
			// span 구조 자체는 보존된다 (토큰 색상 span이 깨지면 안 된다).
			expect(line.querySelectorAll("span").length).toBe(3);
		});
	});

	test("calling highlightDom twice with the same args is idempotent (unwrap-first)", () => {
		const line = makeLine(1, "foo bar foo", "addition");
		root.appendChild(line);
		const active: SearchMatch = {
			fileId: "f1",
			side: "additions",
			lineNumber: 1,
			column: 8,
			length: 3,
		};

		highlightDom(root, "foo", active, "f1");
		const firstRunCount = root.querySelectorAll("mark.cc-find-hit").length;
		highlightDom(root, "foo", active, "f1");

		const marks = root.querySelectorAll("mark.cc-find-hit");
		expect(marks.length).toBe(firstRunCount);
		expect(marks.length).toBe(2);
		expect(marks[0]?.classList.contains("cc-find-hit--active")).toBe(false);
		expect(marks[1]?.classList.contains("cc-find-hit--active")).toBe(true);
		expect(line.textContent).toBe("foo bar foo");
	});
});

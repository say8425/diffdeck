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

	// 렌더된 줄은 토큰·intraline diff span으로 텍스트 노드가 쪼개지는데, 검색 인덱스는 줄 전체로
	// 매치를 센다 — 경계를 넘는 매치도 마킹해야 개수와 화면 하이라이트가 맞는다.
	describe("matches spanning multiple text nodes", () => {
		test("a match crossing a token boundary is marked across both nodes", () => {
			const line = makeTokenizedLine(6, ["export const answer = ", "43", ";"]);
			root.appendChild(line);

			highlightDom(root, "= 43", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.length).toBeGreaterThan(0);
			expect(marks.map((m) => m.textContent).join("")).toBe("= 43");
			expect(line.textContent).toBe("export const answer = 43;");
		});

		test("a match spanning three nodes marks every covered segment", () => {
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
			const line = makeTokenizedLine(1, ["a", "ba", "b"]);
			root.appendChild(line);

			highlightDom(root, "ab", null, "f1");

			const marks = [...root.querySelectorAll("mark.cc-find-hit")];
			expect(marks.map((m) => m.textContent).join("")).toBe("abab");
			expect(line.textContent).toBe("abab");
		});

		test("a case-insensitive query crossing nodes marks the original-case text", () => {
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

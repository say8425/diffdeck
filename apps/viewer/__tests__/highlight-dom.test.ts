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

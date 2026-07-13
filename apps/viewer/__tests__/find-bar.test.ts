import "./happydom.ts";
import { afterEach, describe, expect, jest, mock, test } from "bun:test";
import type { FileDiffMetadata } from "@diffdeck/diffs";
import { createFindBar, type FindBarDeps } from "../browser/search/findBar.ts";
import type { SearchFile, SearchMatch } from "../browser/search/searchIndex.ts";

const DEBOUNCE_MS = 120;

// Same fixture shape as viewer-search-index.test.ts: 3 matches for "foo"
// ordered deletions(line3) -> additions(line3) -> additions(line5).
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
			additionStart: 2,
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

const makeElements = () => {
	const bar = document.createElement("div");
	bar.hidden = true;
	const input = document.createElement("input");
	const count = document.createElement("div");
	const prev = document.createElement("button");
	const next = document.createElement("button");
	const close = document.createElement("button");
	document.body.append(bar, input, count, prev, next, close);
	return { bar, input, count, prev, next, close };
};

const makeDeps = (
	files: SearchFile[] = [{ fileId: "f.ts", fileDiff: fixture() }],
): { deps: FindBarDeps; elements: ReturnType<typeof makeElements> } => {
	const elements = makeElements();
	const deps: FindBarDeps = {
		elements,
		getFiles: mock(() => files),
		revealMatch: mock((_match: SearchMatch) => {}),
		selectMatch: mock((_match: SearchMatch) => {}),
		clearSelection: mock(() => {}),
		ensureVisible: mock((_match: SearchMatch) => {}),
		setExpandAll: mock((_on: boolean) => {}),
		reapplyHighlights: mock(() => {}),
	};
	return { deps, elements };
};

const typeQuery = (
	elements: ReturnType<typeof makeElements>,
	value: string,
): void => {
	elements.input.value = value;
	elements.input.dispatchEvent(new Event("input", { bubbles: true }));
};

const keydown = (target: EventTarget, init: KeyboardEventInit): boolean =>
	target.dispatchEvent(
		new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
	);

afterEach(() => {
	jest.useRealTimers();
});

describe("createFindBar", () => {
	describe("open()", () => {
		test("shows the bar, focuses+selects input, expands nothing for an empty query, and blanks the count", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);

			fb.open();

			expect(elements.bar.hidden).toBe(false);
			expect(fb.isOpen()).toBe(true);
			expect(document.activeElement).toBe(elements.input);
			expect(deps.setExpandAll).toHaveBeenCalledWith(false);
			expect(deps.getFiles).toHaveBeenCalledTimes(1);
			expect(deps.revealMatch).not.toHaveBeenCalled();
			expect(deps.reapplyHighlights).toHaveBeenCalledTimes(1);
			expect(elements.count.textContent).toBe("");
			expect(elements.prev.disabled).toBe(true);
			expect(elements.next.disabled).toBe(true);
		});

		test("reopening after a search replays the last query and reveals the current match", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);

			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);
			expect(elements.count.textContent).toBe("1/3");

			keydown(elements.input, { key: "Escape" });
			expect(elements.bar.hidden).toBe(true);

			deps.setExpandAll.mockClear();
			deps.getFiles.mockClear();
			deps.revealMatch.mockClear();
			deps.ensureVisible.mockClear();
			deps.reapplyHighlights.mockClear();

			fb.open();

			expect(elements.bar.hidden).toBe(false);
			expect(deps.setExpandAll).toHaveBeenCalledWith(true);
			expect(deps.getFiles).toHaveBeenCalledTimes(1);
			expect(deps.ensureVisible).toHaveBeenCalledTimes(1);
			expect(deps.revealMatch).toHaveBeenCalledTimes(1);
			// once inside goTo(), once again at the end of open()
			expect(deps.reapplyHighlights).toHaveBeenCalledTimes(2);
			expect(elements.count.textContent).toBe("1/3");
		});
	});

	describe("typing (debounced input)", () => {
		test("applies the query only after the 120ms debounce elapses", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			deps.getFiles.mockClear();
			deps.revealMatch.mockClear();

			typeQuery(elements, "foo");
			expect(fb.getQuery()).toBe("");
			jest.advanceTimersByTime(DEBOUNCE_MS - 1);
			expect(fb.getQuery()).toBe("");
			expect(deps.getFiles).not.toHaveBeenCalled();

			jest.advanceTimersByTime(1);
			expect(fb.getQuery()).toBe("foo");
			expect(deps.getFiles).toHaveBeenCalledTimes(1);
			expect(deps.revealMatch).toHaveBeenCalledTimes(1);
			expect(elements.count.textContent).toBe("1/3");
		});

		test("rapid keystrokes reset the debounce timer so only the final value is applied", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			deps.getFiles.mockClear();

			typeQuery(elements, "f");
			jest.advanceTimersByTime(DEBOUNCE_MS - 1);
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS - 1);
			expect(fb.getQuery()).toBe("");

			jest.advanceTimersByTime(1);
			expect(fb.getQuery()).toBe("foo");
			expect(deps.getFiles).toHaveBeenCalledTimes(1);
		});

		test("clearing the query back to empty clears the selection and blanks the count", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();

			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);
			expect(elements.count.textContent).toBe("1/3");

			deps.clearSelection.mockClear();
			deps.reapplyHighlights.mockClear();
			typeQuery(elements, "");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			expect(fb.getQuery()).toBe("");
			expect(deps.clearSelection).toHaveBeenCalledTimes(1);
			expect(deps.reapplyHighlights).toHaveBeenCalledTimes(1);
			expect(elements.count.textContent).toBe("");
			expect(elements.prev.disabled).toBe(true);
			expect(elements.next.disabled).toBe(true);
		});

		test("a query with no matches shows 0/0, disables prev/next, and clears the selection", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();

			deps.clearSelection.mockClear();
			typeQuery(elements, "zzz");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			expect(elements.count.textContent).toBe("0/0");
			expect(elements.prev.disabled).toBe(true);
			expect(elements.next.disabled).toBe(true);
			expect(deps.clearSelection).toHaveBeenCalledTimes(1);
			expect(fb.getActiveMatch()).toBeNull();
		});
	});

	describe("Enter / Shift+Enter navigation", () => {
		test("Enter advances to the next match, wrapping back to the first", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);
			expect(elements.count.textContent).toBe("1/3");

			deps.revealMatch.mockClear();
			const result = keydown(elements.input, { key: "Enter" });
			expect(result).toBe(false); // preventDefault() was called
			expect(elements.count.textContent).toBe("2/3");
			expect(deps.revealMatch).toHaveBeenCalledTimes(1);

			keydown(elements.input, { key: "Enter" });
			expect(elements.count.textContent).toBe("3/3");

			keydown(elements.input, { key: "Enter" });
			expect(elements.count.textContent).toBe("1/3");
		});

		test("Shift+Enter moves to the previous match, wrapping back to the last", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);
			expect(elements.count.textContent).toBe("1/3");

			keydown(elements.input, { key: "Enter", shiftKey: true });
			expect(elements.count.textContent).toBe("3/3");

			keydown(elements.input, { key: "Enter", shiftKey: true });
			expect(elements.count.textContent).toBe("2/3");
		});

		test("Enter with no matches does nothing", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open(); // empty query -> no matches

			deps.revealMatch.mockClear();
			keydown(elements.input, { key: "Enter" });

			expect(deps.revealMatch).not.toHaveBeenCalled();
			expect(elements.count.textContent).toBe("");
		});
	});

	describe("close()", () => {
		test("Escape closes the bar and resets expand/selection", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			deps.setExpandAll.mockClear();
			deps.clearSelection.mockClear();
			deps.reapplyHighlights.mockClear();

			keydown(elements.input, { key: "Escape" });

			expect(elements.bar.hidden).toBe(true);
			expect(fb.isOpen()).toBe(false);
			expect(deps.setExpandAll).toHaveBeenCalledWith(false);
			expect(deps.clearSelection).toHaveBeenCalledTimes(1);
			expect(deps.reapplyHighlights).toHaveBeenCalledTimes(1);
		});

		test("the close button closes the bar", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();

			elements.close.click();

			expect(elements.bar.hidden).toBe(true);
			expect(fb.isOpen()).toBe(false);
			expect(deps.clearSelection).toHaveBeenCalled();
		});

		test("closing cancels a pending debounce timer so the stale query never applies", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");

			fb.close();
			deps.getFiles.mockClear();
			jest.advanceTimersByTime(DEBOUNCE_MS);

			expect(deps.getFiles).not.toHaveBeenCalled();
			expect(fb.getQuery()).toBe("");
		});
	});

	describe("prev/next buttons", () => {
		test("next button moves forward one match", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			deps.revealMatch.mockClear();
			elements.next.click();

			expect(elements.count.textContent).toBe("2/3");
			expect(deps.revealMatch).toHaveBeenCalledTimes(1);
		});

		test("prev button moves backward, wrapping to the last match", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			elements.prev.click();

			expect(elements.count.textContent).toBe("3/3");
		});
	});

	describe("window Cmd/Ctrl+F shortcut", () => {
		test("opens the bar when closed (metaKey)", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);

			expect(fb.isOpen()).toBe(false);
			const result = keydown(window, { key: "f", metaKey: true });

			expect(result).toBe(false);
			expect(fb.isOpen()).toBe(true);
			expect(elements.bar.hidden).toBe(false);
			expect(deps.setExpandAll).toHaveBeenCalledWith(false);
		});

		test("opens the bar when closed (ctrlKey, uppercase F)", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);

			keydown(window, { key: "F", ctrlKey: true });

			expect(fb.isOpen()).toBe(true);
			expect(elements.bar.hidden).toBe(false);
			expect(deps).toBeTruthy();
		});

		test("when already open, refocuses/reselects the input instead of reopening", () => {
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			deps.setExpandAll.mockClear();
			deps.getFiles.mockClear();
			elements.input.blur();
			expect(document.activeElement).not.toBe(elements.input);

			keydown(window, { key: "f", metaKey: true });

			expect(fb.isOpen()).toBe(true);
			expect(document.activeElement).toBe(elements.input);
			// open() was not called again
			expect(deps.setExpandAll).not.toHaveBeenCalled();
			expect(deps.getFiles).not.toHaveBeenCalled();
		});

		test("plain 'f' without a modifier does not open the bar", () => {
			const { elements, deps } = makeDeps();
			const fb = createFindBar(deps);

			keydown(window, { key: "f" });

			expect(fb.isOpen()).toBe(false);
			expect(elements.bar.hidden).toBe(true);
		});
	});

	describe("getQuery() / getActiveMatch()", () => {
		test("return '' / null when closed", () => {
			const { deps } = makeDeps();
			const fb = createFindBar(deps);

			expect(fb.getQuery()).toBe("");
			expect(fb.getActiveMatch()).toBeNull();
		});

		test("return the real query and match once opened with results", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			expect(fb.getQuery()).toBe("foo");
			expect(fb.getActiveMatch()).toEqual({
				fileId: "f.ts",
				side: "deletions",
				lineNumber: 3,
				column: 8,
				length: 3,
			});
		});
	});

	describe("setData()", () => {
		test("no-ops when closed", () => {
			const { deps } = makeDeps();
			const fb = createFindBar(deps);

			fb.setData();

			expect(deps.getFiles).not.toHaveBeenCalled();
			expect(deps.reapplyHighlights).not.toHaveBeenCalled();
		});

		test("rebuilds and selects the current match when open", () => {
			jest.useFakeTimers();
			const { deps, elements } = makeDeps();
			const fb = createFindBar(deps);
			fb.open();
			typeQuery(elements, "foo");
			jest.advanceTimersByTime(DEBOUNCE_MS);

			deps.getFiles.mockClear();
			deps.selectMatch.mockClear();
			deps.reapplyHighlights.mockClear();

			fb.setData();

			expect(deps.getFiles).toHaveBeenCalledTimes(1);
			expect(deps.selectMatch).toHaveBeenCalledWith({
				fileId: "f.ts",
				side: "deletions",
				lineNumber: 3,
				column: 8,
				length: 3,
			});
			expect(deps.reapplyHighlights).toHaveBeenCalledTimes(1);
		});
	});
});

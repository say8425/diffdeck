import { expect, test } from "bun:test";
import { computeFileTreeRowClickPlan } from "../render/rowClickPlan";

const ev = (
	o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {},
) => ({
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	...o,
});

test("plain click on file: single selection, no toggleDirectory", () => {
	const p = computeFileTreeRowClickPlan({
		event: ev(),
		mode: "flow",
		isSearchOpen: false,
		isDirectory: false,
	});
	expect(p.selection).toEqual({ kind: "single" });
	expect(p.toggleDirectory).toBe(false);
	expect(p.revealCanonical).toBe(false);
});

test("plain click on directory: toggleDirectory true", () => {
	const p = computeFileTreeRowClickPlan({
		event: ev(),
		mode: "flow",
		isSearchOpen: false,
		isDirectory: true,
	});
	expect(p.toggleDirectory).toBe(true);
});

test("meta click: toggle selection, no directory toggle", () => {
	const p = computeFileTreeRowClickPlan({
		event: ev({ metaKey: true }),
		mode: "flow",
		isSearchOpen: false,
		isDirectory: true,
	});
	expect(p.selection).toEqual({ kind: "toggle" });
	expect(p.toggleDirectory).toBe(false);
});

test("shift click: range selection (additive false without ctrl/meta)", () => {
	const p = computeFileTreeRowClickPlan({
		event: ev({ shiftKey: true }),
		mode: "flow",
		isSearchOpen: false,
		isDirectory: false,
	});
	expect(p.selection).toEqual({ kind: "range", additive: false });
});

test("search open: closeSearch true", () => {
	const p = computeFileTreeRowClickPlan({
		event: ev(),
		mode: "flow",
		isSearchOpen: true,
		isDirectory: false,
	});
	expect(p.closeSearch).toBe(true);
});

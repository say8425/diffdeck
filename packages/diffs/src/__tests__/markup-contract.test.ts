import { describe, expect, test } from "bun:test";
import {
	DIFFS_CHANGE_ICON_ATTR,
	DIFFS_HEADER_ATTR,
	DIFFS_TAG_NAME,
	DIFFS_TITLE_ATTR,
} from "../index";
import { createFileHeaderElement } from "../utils/createFileHeaderElement";
import type { Element as HASTElement } from "hast";

// Contract values the viewer (apps/viewer/browser) hard-depends on. If the
// engine renames any of these, the viewer breaks silently — this pins them.
describe("diffs markup contract constants", () => {
	test("constants hold the exact attribute/tag strings", () => {
		expect(DIFFS_TAG_NAME).toBe("diffs-container");
		expect(DIFFS_HEADER_ATTR).toBe("data-diffs-header");
		expect(DIFFS_TITLE_ATTR).toBe("data-title");
		expect(DIFFS_CHANGE_ICON_ATTR).toBe("data-change-icon");
	});
});

// Walk a HAST subtree collecting every node whose properties carry `attr`.
const nodesWithAttr = (root: HASTElement, attr: string): HASTElement[] => {
	const found: HASTElement[] = [];
	const visit = (node: HASTElement): void => {
		if (node.properties && attr in node.properties) found.push(node);
		for (const child of node.children ?? []) {
			if ((child as HASTElement).type === "element") {
				visit(child as HASTElement);
			}
		}
	};
	visit(root);
	return found;
};

describe("createFileHeaderElement emits the contracted attributes", () => {
	const header = createFileHeaderElement({
		fileOrDiff: {
			name: "src/example.ts",
			// NOTE: brief used "modified", but ChangeTypes (packages/diffs/src/types.ts)
			// has no "modified" member — that value falls through getIconForType's
			// switch and crashes createIconElement on `name.replace`. "change" is a
			// real ChangeTypes member and legitimately exercises the icon path.
			type: "change",
			hunks: [],
		} as never,
		mode: "default",
		stickyHeader: false,
	});

	test("root header node carries DIFFS_HEADER_ATTR", () => {
		expect(header.properties?.[DIFFS_HEADER_ATTR]).toBe("default");
	});

	test("a title node carries DIFFS_TITLE_ATTR", () => {
		expect(nodesWithAttr(header, DIFFS_TITLE_ATTR).length).toBeGreaterThan(0);
	});

	test("a change-icon node carries DIFFS_CHANGE_ICON_ATTR", () => {
		expect(
			nodesWithAttr(header, DIFFS_CHANGE_ICON_ATTR).length,
		).toBeGreaterThan(0);
	});
});

// NOTE: "data-prev-name" is not exported from packages/diffs/src/constants.ts
// (unlike DIFFS_TITLE_ATTR), so apps/viewer/browser/main.ts reads it via a
// local literal (PREV_NAME_ATTR). Pin it here so a rename in
// createFileHeaderElement.ts is caught even without a shared constant.
describe("createFileHeaderElement emits data-prev-name for renames", () => {
	const header = createFileHeaderElement({
		fileOrDiff: {
			name: "src/renamed.ts",
			prevName: "src/old-name.ts",
			type: "change",
			hunks: [],
		} as never,
		mode: "default",
		stickyHeader: false,
	});

	test("a node carries data-prev-name", () => {
		expect(nodesWithAttr(header, "data-prev-name").length).toBeGreaterThan(0);
	});
});

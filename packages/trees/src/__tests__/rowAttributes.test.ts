import { expect, test } from "bun:test";
import { computeFileTreeRowElementAttributes } from "../render/rowAttributes";
import type { FileTreeVisibleRow } from "../model/publicTypes";

const baseRow = (over: Partial<FileTreeVisibleRow>): FileTreeVisibleRow => ({
	ancestorPaths: [],
	depth: 0,
	hasChildren: false,
	index: 0,
	isFocused: false,
	isSelected: false,
	isExpanded: false,
	isFlattened: false,
	kind: "file",
	level: 0,
	name: "a.ts",
	path: "a.ts",
	posInSet: 0,
	setSize: 1,
	...over,
});

const readOnlyFeatures = {
	contextMenuEnabled: false,
	actionLaneEnabled: false,
	contextMenuButtonVisibility: null,
	contextMenuTriggerMode: null,
	gitLaneActive: true,
};
const cleanState = {
	isFocusRinged: false,
	isContextHovered: false,
	isDragTarget: false,
	isDragging: false,
	effectiveGitStatus: null,
	containsGitChange: false,
};

test("file row: treeitem role, aria, data-item-type=file", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({}),
		mode: "flow",
		targetPath: "a.ts",
		ariaLabel: "a.ts",
		domId: "id-a",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: cleanState,
	});
	expect(a.role).toBe("treeitem");
	expect(a["data-item-type"]).toBe("file");
	expect(a["data-item-path"]).toBe("a.ts");
	expect(a["aria-level"]).toBe(1);
	expect(a["aria-selected"]).toBe("false");
	expect(a["aria-expanded"]).toBeUndefined();
	expect(a.tabIndex).toBe(-1);
});

test("directory row: aria-expanded reflects isExpanded, data-item-type=folder", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({
			kind: "directory",
			isExpanded: true,
			name: "src",
			path: "src",
		}),
		mode: "flow",
		targetPath: "src",
		ariaLabel: "src",
		domId: "id-src",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: cleanState,
	});
	expect(a["data-item-type"]).toBe("folder");
	expect(a["aria-expanded"]).toBe(true);
});

test("selected + git status + focused emit their data attributes", () => {
	const a = computeFileTreeRowElementAttributes({
		row: baseRow({ isSelected: true, isFocused: true }),
		mode: "flow",
		targetPath: "a.ts",
		ariaLabel: "a.ts",
		domId: "id-a",
		isParked: false,
		itemHeight: 30,
		features: readOnlyFeatures,
		state: {
			...cleanState,
			isFocusRinged: true,
			effectiveGitStatus: "modified",
		},
	});
	expect(a["data-item-selected"]).toBe(true);
	expect(a["data-item-focused"]).toBe(true);
	expect(a["data-item-git-status"]).toBe("modified");
	expect(a["aria-selected"]).toBe("true");
	expect(a.tabIndex).toBe(0);
});

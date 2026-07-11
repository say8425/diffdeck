import { expect, test } from "bun:test";
import "./happydom";
import { createFileTreeIconResolver } from "../render/iconResolver";
import {
	buildRow,
	buildRowContent,
	type FileTreeRowVanillaContext,
} from "../render/renderRowVanilla";
import type { FileTreeVisibleRow } from "../model/publicTypes";

// Expected structure verified against the REAL preact source:
// renderFileTreeRowContent (FileTreeView.tsx:832-913) + the read-only branch
// of renderStyledRow (FileTreeView.tsx:987-1193). See task-3-report.md.

// `set: "none"` disables the built-in-icon-set-by-extension lookup so
// `resolveIcon("file-tree-icon-file", "a.ts")` passes the generic sprite name
// straight through instead of resolving to a language-specific builtin icon
// (e.g. a TypeScript icon) -- keeps these assertions about section/lane
// structure decoupled from icon-set resolution, which iconResolver.test.ts
// already covers.
const iconResolver = createFileTreeIconResolver({ set: "none" });

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

const baseCtx = (
	over: Partial<FileTreeRowVanillaContext> = {},
): FileTreeRowVanillaContext => ({
	iconResolver,
	itemHeight: 30,
	ariaLabel: "a.ts",
	domId: undefined,
	features: { gitLaneActive: false },
	state: { effectiveGitStatus: null, containsGitChange: false },
	...over,
});

test("file row: button role=treeitem, data-item-path/type, aria-level, file icon use href", () => {
	const row = baseRow({});
	const button = buildRow(row, baseCtx());

	expect(button.tagName.toLowerCase()).toBe("button");
	expect(button.getAttribute("role")).toBe("treeitem");
	expect(button.getAttribute("data-item-path")).toBe("a.ts");
	expect(button.getAttribute("data-item-type")).toBe("file");
	expect(button.getAttribute("aria-level")).toBe("1");

	const iconUse = button.querySelector('[data-item-section="icon"] use');
	expect(iconUse?.getAttribute("href")).toBe("#file-tree-icon-file");
});

test("directory row: chevron icon, data-item-type=folder, aria-expanded reflects isExpanded", () => {
	const row = baseRow({
		kind: "directory",
		name: "src",
		path: "src",
		isExpanded: true,
	});
	const button = buildRow(row, baseCtx({ ariaLabel: "src" }));

	expect(button.getAttribute("data-item-type")).toBe("folder");
	expect(button.getAttribute("aria-expanded")).toBe("true");

	const iconUse = button.querySelector('[data-item-section="icon"] use');
	expect(iconUse?.getAttribute("href")).toBe("#file-tree-icon-chevron");
});

test("depth spacing: one spacing-item per row.depth, carrying data-ancestor-path", () => {
	const row = baseRow({
		depth: 2,
		ancestorPaths: ["a", "a/b"],
		name: "c.ts",
		path: "a/b/c.ts",
	});
	const fragment = buildRowContent(row, baseCtx({ ariaLabel: "c.ts" }));
	const container = document.createElement("div");
	container.appendChild(fragment);

	const spacingItems = container.querySelectorAll(
		'[data-item-section="spacing-item"]',
	);
	expect(spacingItems.length).toBe(2);
	expect(spacingItems[0]?.getAttribute("data-ancestor-path")).toBe("a");
	expect(spacingItems[1]?.getAttribute("data-ancestor-path")).toBe("a/b");
});

test("depth 0: no spacing section is rendered at all", () => {
	const row = baseRow({});
	const fragment = buildRowContent(row, baseCtx());
	const container = document.createElement("div");
	container.appendChild(fragment);

	expect(container.querySelector('[data-item-section="spacing"]')).toBeNull();
});

test('aria-expanded and data-item-selected are stringified "true"/"false", not empty-string presence attributes', () => {
	// rowAttributes.ts hands `aria-expanded`/`data-item-selected` through as
	// raw booleans. Real preact's setProperty (diff/props.js) special-cases
	// `aria-*`/`data-*` names to always `setAttribute(name, String(value))`
	// (never the HTML-boolean-attribute "true -> empty string, false -> omit"
	// convention used for every other attribute) -- verified by rendering the
	// real preact source into happy-dom, and now handled directly by `el()`
	// itself (see el.ts).
	const collapsedDir = baseRow({
		kind: "directory",
		name: "src",
		path: "src",
		isExpanded: false,
	});
	const collapsedButton = buildRow(collapsedDir, baseCtx({ ariaLabel: "src" }));
	expect(collapsedButton.getAttribute("aria-expanded")).toBe("false");

	const selectedFile = baseRow({ isSelected: true });
	const selectedButton = buildRow(selectedFile, baseCtx());
	expect(selectedButton.getAttribute("data-item-selected")).toBe("true");
});

test("git lane: renders the GIT_STATUS_LABEL letter + title, and the row carries data-item-git-status", () => {
	const row = baseRow({});
	const button = buildRow(
		row,
		baseCtx({
			features: { gitLaneActive: true },
			state: { effectiveGitStatus: "modified", containsGitChange: false },
		}),
	);

	expect(button.getAttribute("data-item-git-status")).toBe("modified");
	const gitSection = button.querySelector('[data-item-section="git"]');
	expect(gitSection?.textContent).toBe("M");
	expect(gitSection?.querySelector("span")?.getAttribute("title")).toBe(
		"Git status: modified",
	);
});

test("git lane active but no status on this row: section renders empty (no badge)", () => {
	const row = baseRow({});
	const button = buildRow(row, baseCtx({ features: { gitLaneActive: true } }));

	const gitSection = button.querySelector('[data-item-section="git"]');
	expect(gitSection).not.toBeNull();
	expect(gitSection?.textContent).toBe("");
	expect(button.hasAttribute("data-item-git-status")).toBe(false);
});

test("gitLaneActive=false: no git section at all", () => {
	const row = baseRow({});
	const button = buildRow(row, baseCtx());
	expect(button.querySelector('[data-item-section="git"]')).toBeNull();
});

test('git lane active: an empty decoration lane is re-emitted immediately before the git lane (grow-spacer that right-aligns the git badge, per style.css\'s [data-item-section="decoration"] { flex: 1 1 0 })', () => {
	const row = baseRow({});
	const button = buildRow(
		row,
		baseCtx({
			features: { gitLaneActive: true },
			state: { effectiveGitStatus: "modified", containsGitChange: false },
		}),
	);

	const decorationSection = button.querySelector(
		'[data-item-section="decoration"]',
	);
	const gitSection = button.querySelector('[data-item-section="git"]');
	expect(decorationSection).not.toBeNull();
	expect(gitSection).not.toBeNull();

	// Decoration lane is empty -- it's a pure flex spacer, not a content lane.
	expect(decorationSection?.children.length).toBe(0);

	// Order: decoration lane comes immediately before the git lane, matching
	// the original's `decoration -> git` lane order.
	expect(decorationSection?.nextElementSibling).toBe(gitSection);
});

test("flattened row: content wraps segments in data-item-flattened-subitems with ' / ' separators", () => {
	const row = baseRow({
		isFlattened: true,
		flattenedSegments: [
			{ name: "src", path: "src", isTerminal: false },
			{ name: "deep.ts", path: "src/deep.ts", isTerminal: true },
		],
		name: "deep.ts",
		path: "src/deep.ts",
	});
	const button = buildRow(row, baseCtx({ ariaLabel: "src / deep.ts" }));

	const content = button.querySelector('[data-item-section="content"]');
	const wrapper = content?.querySelector("[data-item-flattened-subitems]");
	expect(wrapper).not.toBeNull();
	// Boolean `true` on a `data-*` key is stringified by `el()`, not rendered
	// as an empty-string presence attribute.
	expect(wrapper?.getAttribute("data-item-flattened-subitems")).toBe("true");

	const subitems = wrapper?.querySelectorAll("[data-item-flattened-subitem]");
	expect(subitems?.length).toBe(2);
	expect(subitems?.[0]?.getAttribute("data-item-flattened-subitem")).toBe(
		"src",
	);
	expect(subitems?.[1]?.getAttribute("data-item-flattened-subitem")).toBe(
		"src/deep.ts",
	);
	// data-item-path uses the terminal flattened segment's path, not row.path.
	expect(button.getAttribute("data-item-path")).toBe("src/deep.ts");
});

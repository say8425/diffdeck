// Task 6 of Plan 3 (de-preact): the viewer-contract acceptance gate. Drives
// the PUBLIC `FileTree` API (not `FileTreeVanillaView` directly, unlike
// fileTreeVanillaView.test.ts -- see that file's WIRING NOTE) through the
// exact sequence the real viewer uses (apps/viewer/browser/main.ts:290-305):
// `new FileTree(...)` -> `render({containerWrapper})` -> `resetPaths(...)` ->
// `setGitStatus(...)` -> `cleanUp()`.
//
// Adaptation note: the task brief's reference test queries
// `mount.querySelectorAll("[data-item-path]")` directly on the light-DOM
// `containerWrapper`. That does not work here -- `FileTree` renders into a
// real closed-over shadow root (`file-tree-container`'s `attachShadow({mode:
// "open"})`, see `FileTree.ts#prepareHost`/`components/web-components.ts`),
// and `querySelectorAll` does not pierce shadow boundaries (verified
// empirically against this repo's happy-dom version: a `[data-x]` element
// placed in an open shadow root is invisible to the host's own
// `querySelectorAll`, only `shadowRoot.querySelectorAll` finds it -- matching
// real browsers, and matching how `apps/viewer/browser/main.ts` itself always
// queries via `container.shadowRoot ?? container`). Every assertion below
// goes through `getRenderedShadowRoot(mount)` for that reason.
import { expect, test } from "bun:test";
import "./happydom";
import { FILE_TREE_TAG_NAME } from "../constants";
import { FileTree } from "../index";

function getRenderedShadowRoot(mount: HTMLElement): ShadowRoot {
	const host = mount.querySelector(FILE_TREE_TAG_NAME);
	if (!(host instanceof HTMLElement) || host.shadowRoot == null) {
		throw new Error(
			"expected a mounted file-tree-container with a shadow root",
		);
	}
	return host.shadowRoot;
}

test("viewer contract: construct -> render -> resetPaths+setGitStatus -> cleanUp", () => {
	const selections: (readonly string[])[] = [];
	const tree = new FileTree({
		paths: ["src/a.ts", "src/b.ts", "README.md"],
		gitStatus: [{ path: "src/a.ts", status: "modified" }],
		initialExpansion: "open",
		flattenEmptyDirectories: false,
		search: true,
		onSelectionChange: (s) => selections.push(s),
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });

	const shadowRoot = getRenderedShadowRoot(mount);
	expect(
		shadowRoot.querySelectorAll("[data-item-path]").length,
	).toBeGreaterThan(0);
	expect(
		shadowRoot.querySelector(
			'[data-item-path="src/a.ts"][data-item-git-status="modified"]',
		),
	).not.toBeNull();

	// in-place update must not throw and must reflect new paths/status
	tree.resetPaths(["src/a.ts", "src/c.ts"]);
	tree.setGitStatus([{ path: "src/c.ts", status: "added" }]);
	expect(
		shadowRoot.querySelector('[data-item-path="src/c.ts"]'),
	).not.toBeNull();
	expect(
		shadowRoot.querySelector(
			'[data-item-path="src/c.ts"][data-item-git-status="added"]',
		),
	).not.toBeNull();

	tree.cleanUp();
	expect(shadowRoot.querySelectorAll("[data-item-path]").length).toBe(0);
});

test("in-place update: resetPaths+setGitStatus do not reset the scroll container's scrollTop", () => {
	const paths = Array.from({ length: 20 }, (_, index) => `file-${index}.ts`);
	const tree = new FileTree({
		paths,
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });

	const shadowRoot = getRenderedShadowRoot(mount);
	const scrollContainer = shadowRoot.querySelector(
		"[data-file-tree-virtualized-scroll]",
	);
	expect(scrollContainer).not.toBeNull();
	(scrollContainer as HTMLElement).scrollTop = 123;

	tree.resetPaths(paths.map((path) => `renamed-${path}`));
	tree.setGitStatus([{ path: `renamed-${paths[0]}`, status: "added" }]);

	// Same scroll-container DOM node must survive both updates (only the inner
	// list's children are ever replaced -- see FileTreeVanillaView.renderRows),
	// so its scrollTop is untouched.
	expect(shadowRoot.querySelector("[data-file-tree-virtualized-scroll]")).toBe(
		scrollContainer,
	);
	expect((scrollContainer as HTMLElement).scrollTop).toBe(123);

	tree.cleanUp();
});

// setIcons/setComposition/applyGitStatusPatch were rewired the same way as
// resetPaths+setGitStatus (FileTree.ts's #view?.renderRows() calls) but are
// not part of the viewer's own call sequence -- covered separately here so
// the swap away from `renderFileTreeRoot` is verified for every runtime
// setter that used to trigger a preact re-render, not only the two the
// viewer happens to call.
test("setIcons updates rendered icons in place", () => {
	const tree = new FileTree({
		paths: ["a.ts"],
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });

	const shadowRoot = getRenderedShadowRoot(mount);
	const useHref = (): string | null | undefined =>
		shadowRoot
			.querySelector('[data-item-path="a.ts"]')
			?.querySelector("use")
			?.getAttribute("href");
	expect(useHref()).not.toBe("#custom-file-icon");

	tree.setIcons({ remap: { "file-tree-icon-file": "custom-file-icon" } });

	expect(useHref()).toBe("#custom-file-icon");

	tree.cleanUp();
});

test("applyGitStatusPatch updates the rendered git-status attribute in place", () => {
	const tree = new FileTree({
		paths: ["a.ts"],
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });

	const shadowRoot = getRenderedShadowRoot(mount);
	expect(
		shadowRoot.querySelector('[data-item-path="a.ts"][data-item-git-status]'),
	).toBeNull();

	tree.applyGitStatusPatch({ set: [{ path: "a.ts", status: "added" }] });

	expect(
		shadowRoot.querySelector(
			'[data-item-path="a.ts"][data-item-git-status="added"]',
		),
	).not.toBeNull();

	tree.cleanUp();
});

test("setComposition does not throw against the mounted vanilla view", () => {
	const tree = new FileTree({
		paths: ["a.ts"],
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
	const mount = document.createElement("div");
	document.body.append(mount);
	tree.render({ containerWrapper: mount });

	expect(() => {
		tree.setComposition({ header: { html: "<div>header</div>" } });
	}).not.toThrow();

	const shadowRoot = getRenderedShadowRoot(mount);
	expect(shadowRoot.querySelectorAll("[data-item-path]").length).toBe(1);

	tree.cleanUp();
});

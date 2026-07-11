import { expect, test } from "bun:test";
import "./happydom";
import { FileTreeController } from "../model/FileTreeController";
import { FileTreeVanillaView } from "../render/FileTreeVanillaView";

// WIRING NOTE (Task 4 of Plan 3, de-preact): `FileTree.render` is not yet
// swapped to `FileTreeVanillaView` -- that lands in Task 6 -- so it still
// mounts through preact and can't be used to exercise this view. Per the
// task brief, this test drives `FileTreeVanillaView` directly against a
// `FileTreeController` built the same way `FileTree`'s constructor does
// (FileTree.ts:211-263), using only the controller options this fixture
// needs. This is the smallest wiring that exercises mount -> renderRows ->
// update without touching `FileTree`/preact; `fileTree.contract.test.ts`
// (Task 6) covers the same behavior end to end through the public API once
// the swap lands.
function createController(paths: readonly string[]): FileTreeController {
	return new FileTreeController({
		paths,
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
}

test("mount renders one [data-item-path] per visible row", () => {
	const controller = createController(["src/a.ts", "src/b.ts", "README.md"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = document.createElement("div");

	view.mount(host);

	// initialExpansion:"open" -> src (dir) + src/a.ts + src/b.ts + README.md
	expect(controller.getVisibleCount()).toBe(4);
	const rendered = host.querySelectorAll("[data-item-path]");
	expect(rendered.length).toBe(4);
	const paths = new Set(
		Array.from(rendered, (element) => element.getAttribute("data-item-path")),
	);
	// Directory paths carry a trailing slash by convention (see
	// model/pathHelpers.ts).
	expect(paths).toEqual(new Set(["src/", "src/a.ts", "src/b.ts", "README.md"]));
});

test("resetPaths with a changed path set updates the rendered [data-item-path] set", () => {
	const controller = createController(["src/a.ts", "src/b.ts", "README.md"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = document.createElement("div");
	view.mount(host);

	controller.resetPaths(["one.ts", "two.ts"]);

	const paths = new Set(
		Array.from(host.querySelectorAll("[data-item-path]"), (element) =>
			element.getAttribute("data-item-path"),
		),
	);
	expect(paths).toEqual(new Set(["one.ts", "two.ts"]));
});

test("scroll preservation: a row rebuild does not reset the scroll container's scrollTop", () => {
	const paths = Array.from({ length: 20 }, (_, index) => `file-${index}.ts`);
	const controller = createController(paths);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = document.createElement("div");
	view.mount(host);

	const scrollContainer = host.querySelector(
		"[data-file-tree-virtualized-scroll]",
	);
	expect(scrollContainer).not.toBeNull();
	(scrollContainer as HTMLElement).scrollTop = 123;

	controller.resetPaths(
		Array.from({ length: 20 }, (_, index) => `renamed-${index}.ts`),
	);

	// Same scroll-container DOM node must survive the rebuild (only the inner
	// list's children are replaced), so its scrollTop is untouched.
	expect(host.querySelector("[data-file-tree-virtualized-scroll]")).toBe(
		scrollContainer,
	);
	expect((scrollContainer as HTMLElement).scrollTop).toBe(123);
});

test("unmount unsubscribes from the controller and clears the mounted host", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = document.createElement("div");
	view.mount(host);
	expect(host.querySelectorAll("[data-item-path]").length).toBeGreaterThan(0);

	view.unmount();
	expect(host.children.length).toBe(0);

	// A later controller emit must not repopulate the (now unmounted) host.
	controller.resetPaths(["c.ts"]);
	expect(host.children.length).toBe(0);
});

test("searchEnabled builds an (unwired) search input inside the mounted tree", () => {
	const controller = createController(["a.ts"]);
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		searchEnabled: true,
	});
	const host = document.createElement("div");

	view.mount(host);

	expect(host.querySelector("[data-file-tree-search-input]")).not.toBeNull();
});

test("searchEnabled defaults to false: no search input is built", () => {
	const controller = createController(["a.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = document.createElement("div");

	view.mount(host);

	expect(host.querySelector("[data-file-tree-search-input]")).toBeNull();
});

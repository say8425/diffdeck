import { expect, test } from "bun:test";
import "./happydom";
import { FileTreeController } from "../model/FileTreeController";
import { FileTreeVanillaView } from "../render/FileTreeVanillaView";

// WIRING NOTE (mirrors fileTreeVanillaView.test.ts's own note): `FileTree.render`
// isn't swapped to `FileTreeVanillaView` until Task 6, so this drives the view
// directly against a `FileTreeController` built the same way `FileTree`'s
// constructor does (FileTree.ts:211-263) -- the brief's "build the input
// fixture through FileTree public options `{ search:true, onSelectionChange }`"
// becomes "pass the equivalent `FileTreeVanillaViewProps`" until that swap lands.
function createController(paths: readonly string[]): FileTreeController {
	return new FileTreeController({
		paths,
		initialExpansion: "open",
		flattenEmptyDirectories: false,
	});
}

// `focusElement` (render/focusHelpers.ts) no-ops on a disconnected element
// (`!element.isConnected`), and happy-dom's own `HTMLElement.focus()` is a
// no-op under the same condition -- so every interaction test needs the host
// attached under `document.body`, not just a detached `document.createElement`.
function mountConnected(view: FileTreeVanillaView): HTMLElement {
	const host = document.createElement("div");
	document.body.appendChild(host);
	view.mount(host);
	return host;
}

function getRow(host: HTMLElement, path: string): HTMLElement {
	const row = host.querySelector(`[data-item-path="${path}"]`);
	if (!(row instanceof HTMLElement)) {
		throw new Error(`row not found for path: ${path}`);
	}
	return row;
}

test("plain click on a file row selects only that path and fires onSelectionChange with it", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const selectionChanges: (readonly string[])[] = [];
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		onSelectionChange: (paths) => {
			selectionChanges.push(paths);
		},
	});
	const host = mountConnected(view);

	getRow(host, "a.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true }),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts"]);
	expect(selectionChanges).toEqual([["a.ts"]]);
});

test("click on a directory row toggles expansion and the visible row set", () => {
	const controller = createController(["src/a.ts", "top.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	expect(getRow(host, "src/").getAttribute("aria-expanded")).toBe("true");
	expect(host.querySelector('[data-item-path="src/a.ts"]')).not.toBeNull();

	getRow(host, "src/").dispatchEvent(
		new MouseEvent("click", { bubbles: true }),
	);

	expect(getRow(host, "src/").getAttribute("aria-expanded")).toBe("false");
	expect(host.querySelector('[data-item-path="src/a.ts"]')).toBeNull();
});

test("meta-click toggles a path in the selection without clearing the rest (multi-select)", () => {
	const controller = createController(["a.ts", "b.ts", "c.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	getRow(host, "a.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true }),
	);
	getRow(host, "b.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true, metaKey: true }),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts", "b.ts"]);

	// Meta-clicking the already-selected path toggles it back off.
	getRow(host, "b.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true, metaKey: true }),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts"]);
});

test("shift-click range-selects between the anchor and the clicked path", () => {
	const controller = createController(["a.ts", "b.ts", "c.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	getRow(host, "a.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true }),
	);
	getRow(host, "c.ts").dispatchEvent(
		new MouseEvent("click", { bubbles: true, shiftKey: true }),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts", "b.ts", "c.ts"]);
});

test("ArrowDown/ArrowUp moves controller focus, tabIndex, and DOM focus", () => {
	const controller = createController(["a.ts", "b.ts", "c.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	// A fresh controller focuses the first visible row by default.
	expect(controller.getFocusedPath()).toBe("a.ts");
	expect(getRow(host, "a.ts").tabIndex).toBe(0);

	getRow(host, "a.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);

	expect(controller.getFocusedPath()).toBe("b.ts");
	expect(getRow(host, "b.ts").tabIndex).toBe(0);
	expect(getRow(host, "a.ts").tabIndex).toBe(-1);
	expect(document.activeElement).toBe(getRow(host, "b.ts"));

	getRow(host, "b.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
	);

	expect(controller.getFocusedPath()).toBe("a.ts");
	expect(document.activeElement).toBe(getRow(host, "a.ts"));
});

test("ArrowRight expands a collapsed focused directory; ArrowLeft collapses it back", () => {
	const controller = createController(["src/a.ts", "top.ts"]);
	controller.focusPath("src/");
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	getRow(host, "src/").dispatchEvent(
		new MouseEvent("click", { bubbles: true }),
	);
	expect(getRow(host, "src/").getAttribute("aria-expanded")).toBe("false");

	getRow(host, "src/").dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
	);
	expect(getRow(host, "src/").getAttribute("aria-expanded")).toBe("true");

	getRow(host, "src/").dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
	);
	expect(getRow(host, "src/").getAttribute("aria-expanded")).toBe("false");
});

test("shift+ArrowDown extends the selection from the focused row", () => {
	const controller = createController(["a.ts", "b.ts", "c.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);
	controller.selectOnlyPath("a.ts");

	getRow(host, "a.ts").dispatchEvent(
		new KeyboardEvent("keydown", {
			key: "ArrowDown",
			shiftKey: true,
			bubbles: true,
		}),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts", "b.ts"]);
});

test("typing in the search input filters the rendered rows via controller.setSearch", () => {
	const controller = createController(["apple.ts", "banana.ts", "cherry.ts"]);
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		searchEnabled: true,
	});
	const host = mountConnected(view);

	const input = host.querySelector(
		"[data-file-tree-search-input]",
	) as HTMLInputElement;
	input.value = "banana";
	input.dispatchEvent(new Event("input", { bubbles: true }));

	expect(controller.getSearchValue()).toBe("banana");
	const paths = Array.from(host.querySelectorAll("[data-item-path]"), (el) =>
		el.getAttribute("data-item-path"),
	);
	expect(paths).toEqual(["banana.ts"]);
});

test("Escape in the search input closes search", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		searchEnabled: true,
	});
	const host = mountConnected(view);

	const input = host.querySelector(
		"[data-file-tree-search-input]",
	) as HTMLInputElement;
	input.value = "a";
	input.dispatchEvent(new Event("input", { bubbles: true }));
	expect(controller.isSearchOpen()).toBe(true);

	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
	);

	expect(controller.isSearchOpen()).toBe(false);
});

test("focusin on a row syncs controller focus to that row", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	expect(controller.getFocusedPath()).toBe("a.ts");
	getRow(host, "b.ts").focus();

	expect(controller.getFocusedPath()).toBe("b.ts");
});

test("a pointer press suppresses focusin's focus sync so a click is not swallowed", () => {
	// Regression: in the browser, a row's focusin fires mid-click (between
	// mousedown and mouseup). Syncing controller focus there rebuilds every row
	// (renderRows -> replaceChildren) and detaches the pressed <button>, so the
	// browser never fires `click` -- the single click is swallowed and the user
	// has to click twice. happy-dom cannot reproduce the swallow, so we assert
	// the guard directly: during a pointer interaction, focusin must not move
	// controller focus (the click handler owns focus then).
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);
	const rowB = getRow(host, "b.ts");

	expect(controller.getFocusedPath()).toBe("a.ts");

	rowB.dispatchEvent(new Event("pointerdown", { bubbles: true }));
	rowB.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	expect(controller.getFocusedPath()).toBe("a.ts");

	// After release, focusin resumes syncing (Tab / programmatic focus).
	rowB.dispatchEvent(new Event("pointerup", { bubbles: true }));
	rowB.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	expect(controller.getFocusedPath()).toBe("b.ts");
});

test("unmount tears down the delegated listeners: a later click no longer changes selection", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);
	const rowA = getRow(host, "a.ts");

	view.unmount();
	rowA.dispatchEvent(new MouseEvent("click", { bubbles: true }));

	expect(controller.getSelectedPaths()).toEqual([]);
});

test("typing a printable character while a row has keyboard focus opens and seeds search", () => {
	const controller = createController(["apple.ts", "banana.ts"]);
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		searchEnabled: true,
	});
	const host = mountConnected(view);

	expect(controller.isSearchOpen()).toBe(false);

	getRow(host, "apple.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: "a", bubbles: true }),
	);

	expect(controller.isSearchOpen()).toBe(true);
	expect(controller.getSearchValue()).toBe("a");
});

test("ctrl/cmd+A selects every visible path", () => {
	const controller = createController(["a.ts", "b.ts", "c.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);

	getRow(host, "a.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: "a", metaKey: true, bubbles: true }),
	);

	expect(controller.getSelectedPaths()).toEqual(["a.ts", "b.ts", "c.ts"]);
});

test("ctrl/cmd+Space toggles the focused path's selection", () => {
	const controller = createController(["a.ts", "b.ts"]);
	const view = new FileTreeVanillaView({ controller, itemHeight: 30 });
	const host = mountConnected(view);
	expect(controller.getFocusedPath()).toBe("a.ts");

	getRow(host, "a.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: " ", metaKey: true, bubbles: true }),
	);
	expect(controller.getSelectedPaths()).toEqual(["a.ts"]);

	getRow(host, "a.ts").dispatchEvent(
		new KeyboardEvent("keydown", { key: " ", metaKey: true, bubbles: true }),
	);
	expect(controller.getSelectedPaths()).toEqual([]);
});

test("with search open, ArrowDown navigates matches and Enter selects the focused match and closes search", () => {
	const controller = createController(["apple.ts", "banana.ts", "cherry.ts"]);
	const view = new FileTreeVanillaView({
		controller,
		itemHeight: 30,
		searchEnabled: true,
	});
	const host = mountConnected(view);

	controller.openSearch("a");
	expect(controller.isSearchOpen()).toBe(true);
	const matchingPaths = controller.getSearchMatchingPaths();
	expect(matchingPaths.length).toBeGreaterThan(1);
	const focusedBeforeArrowDown = controller.getFocusedPath();

	const input = host.querySelector(
		"[data-file-tree-search-input]",
	) as HTMLInputElement;
	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
	);

	const focusedAfterArrowDown = controller.getFocusedPath();
	expect(focusedAfterArrowDown).not.toBeNull();
	expect(focusedAfterArrowDown).not.toBe(focusedBeforeArrowDown);
	expect(matchingPaths).toContain(focusedAfterArrowDown as string);

	input.dispatchEvent(
		new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
	);

	expect(controller.isSearchOpen()).toBe(false);
	expect(controller.getSelectedPaths()).toEqual([
		focusedAfterArrowDown as string,
	]);
});

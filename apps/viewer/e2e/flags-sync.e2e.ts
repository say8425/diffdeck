// Launch-flag -> in-app toggle sync: CLI flags become URL params
// (cli.ts -> server/link.ts's `buildDiffViewerUrl`), which main.ts's prefs.ts
// resolvers (`resolveUntracked`/`resolveWatch`/`resolveFlatten`/
// `resolveTreeSide`/`resolveDiffStyle`/`resolveTreeHidden`/
// `resolveFoldWithTree`) read at boot to seed both the rendering state
// (diffStyle, treeSide, treeHidden, foldWithTree, ...) and the toolbar
// controls that mirror it. This spec launches with a non-default flag on
// every axis and asserts the DOM reflects all seven.
//
// The six checkbox toggles (`#toggle-untracked`, `#toggle-watch`,
// `#toggle-flatten`, `#toggle-tree-side`, `#toggle-tree-hidden`,
// `#toggle-fold-with-tree`) live inside `#overflow-menu`, which starts
// `hidden` -- but main.ts sets their `.checked` property at boot regardless
// of the menu's open state, and non-visibility assertions (like reading a
// property via `page.evaluate`) don't require the element to be visible. The
// Unified/Split segmented control, `#app`'s `data-tree-side`, and
// `#tree-toggle-btn`/`data-tree-hidden` live in the always-visible
// toolbar/app shell.
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const FLAGS = [
	"--untracked",
	"--watch",
	"--no-flatten",
	"--tree-right",
	"--split",
	"--hide-tree",
	"--fold-with-tree",
];

const test = base.extend<{ flagsUrl: string }>({
	flagsUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(FLAGS);
		await use(url);
		await stop();
	},
});

test("launch flags are reflected in the in-app toggle state", async ({
	page,
	flagsUrl,
}) => {
	await page.goto(flagsUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const readState = () =>
		page.evaluate(() => ({
			untracked: (
				document.getElementById("toggle-untracked") as HTMLInputElement | null
			)?.checked,
			watch: (
				document.getElementById("toggle-watch") as HTMLInputElement | null
			)?.checked,
			flatten: (
				document.getElementById("toggle-flatten") as HTMLInputElement | null
			)?.checked,
			treeSideToggle: (
				document.getElementById("toggle-tree-side") as HTMLInputElement | null
			)?.checked,
			splitPressed: document
				.querySelector('#diff-style-group button[data-style="split"]')
				?.getAttribute("aria-pressed"),
			treeSideAttr: document
				.querySelector("[data-tree-side]")
				?.getAttribute("data-tree-side"),
			treeHiddenToggle: (
				document.getElementById("toggle-tree-hidden") as HTMLInputElement | null
			)?.checked,
			treeHiddenAttr: document
				.querySelector("[data-tree-hidden]")
				?.getAttribute("data-tree-hidden"),
			foldWithTreeToggle: (
				document.getElementById(
					"toggle-fold-with-tree",
				) as HTMLInputElement | null
			)?.checked,
		}));

	// Web-first: the toolbar/prefs wiring runs synchronously at module load,
	// but poll anyway rather than asserting once immediately after `goto`.
	await expect.poll(readState).toEqual({
		untracked: true,
		watch: true,
		flatten: false,
		treeSideToggle: true,
		splitPressed: "true",
		treeSideAttr: "right",
		treeHiddenToggle: true,
		treeHiddenAttr: "true",
		foldWithTreeToggle: true,
	});
});

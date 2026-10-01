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

	// The checkboxes sit in the still-hidden #overflow-menu; main.ts sets
	// `.checked` at boot regardless, so reading the property needs no open menu.
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

// 버전 값은 /api/ping의 x-diffdeck-version 헤더에서 온다.
test("the overflow menu ends with a version line linking to the repository", async ({
	page,
}) => {
	const { url, stop } = await launchViewer();
	try {
		await page.goto(url);
		await page.locator("#overflow-btn").click();

		const link = page.locator("#version-link");
		await expect(link).toBeVisible();
		await expect(link).toHaveAttribute(
			"href",
			"https://github.com/say8425/diffdeck",
		);
		await expect(link).toHaveAttribute("rel", /noopener/);
		await expect(page.locator("#version-value")).toHaveText(/^v\d+\.\d+\.\d+/);
	} finally {
		await stop();
	}
});

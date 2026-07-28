// [diffdeck] Regression net for the GitHub-style flattened-path rendering in
// the file tree (packages/trees renderRowVanilla.ts + style.css deviation).
// Upstream wrapped every flattened segment in its own Truncate widget, so a
// deep chain in a narrow sidebar degraded into per-segment ellipses
// ("eng… / r… / … / p…"). The fork renders segments as plain text inside a
// single clip element and clips the joined path ONCE at its end via CSS
// text-overflow — and every row carries `title` with its full path so
// hovering reveals what the ellipsis hides.
//
// The deep-chain test below is the load-bearing one: a nowrap text run's
// intrinsic min-content is its full width, and that minimum propagates up
// the row's flex chain — a naive nowrap ellipsis container silently widened
// the row past the sidebar (715px in a 300px sidebar: the git dot landed
// off-screen and no ellipsis ever rendered). The wrapper's single
// minmax(0, max-content) grid column zeroes that intrinsic contribution;
// this spec pins the observable outcome.
//
// Tree rows live in `<file-tree-container>`'s open shadow root and are
// matched on `data-item-path` (see tree-nav.e2e.ts's header comment). A
// flatten-compressed chain row's `data-item-path` is the chain's terminal
// path with a trailing slash (see tree-fold-sync-flatten.e2e.ts).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

// Single-child directory chain deep enough that its joined path can never fit
// the default 300px sidebar — mirrors the report that motivated the change
// (an engagement-frontend page-modules chain).
const DEEP_CHAIN = [
	"apps",
	"cms",
	"src",
	"page-modules",
	"goods-review",
	"components",
	"GoodsReviewPolicyBottomSheet",
	"__tests__",
];
const DEEP_CHAIN_PATH = `${DEEP_CHAIN.join("/")}/`;

const test = base.extend<object, { nestedUrl: string }>({
	// Worker-scoped (like `viewerUrl` in fixtures/app.ts): the repo is mutated
	// once at setup and only read afterwards, so all three tests share one
	// viewer launch.
	nestedUrl: [
		async ({}, use) => {
			const viewer = await launchViewer([], { nestedChainFile: true });
			// Extend the fixture repo with the deep chain: committed once, then
			// edited in the working tree so the file shows up in the diff.
			const chainDir = join(viewer.repoDir, ...DEEP_CHAIN);
			const chainFile = join(chainDir, "GoodsReviewPolicyBottomSheet.test.tsx");
			mkdirSync(chainDir, { recursive: true });
			writeFileSync(chainFile, "export const t = 1;\n");
			for (const args of [
				// Stage ONLY the new chain — `add -A` would sweep the fixture's
				// pre-existing working-tree edits into the commit and empty the diff.
				["add", "--", DEEP_CHAIN[0] as string],
				["commit", "-qm", "deep chain"],
			]) {
				const result = spawnSync("git", ["-C", viewer.repoDir, ...args], {
					stdio: "pipe",
				});
				expect(result.status).toBe(0);
			}
			writeFileSync(chainFile, "export const t = 2;\n");

			await use(viewer.url);
			await viewer.stop();
		},
		{ scope: "worker" },
	],
});

test("flattened chain row renders plain segments in one end-clip element", async ({
	page,
	nestedUrl,
}) => {
	await page.goto(nestedUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const chainRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/mid/deep/"]');
	await expect(chainRow).toBeVisible();

	const clip = chainRow.locator("[data-item-flattened-clip]");
	await expect(clip).toHaveText("mid / deep");

	// No per-segment Truncate widgets: segments are plain text, so a narrow
	// sidebar can never produce "m… / d…" again.
	await expect(clip.locator("[data-truncate-container]")).toHaveCount(0);

	// The clip element is the single end-clip point (GitHub-style) — this is
	// the style.css half of the deviation actually applying in a real browser.
	const clipStyle = await clip.evaluate((el) => {
		const style = getComputedStyle(el);
		return {
			overflowX: style.overflowX,
			textOverflow: style.textOverflow,
			whiteSpace: style.whiteSpace,
		};
	});
	expect(clipStyle).toEqual({
		overflowX: "hidden",
		textOverflow: "ellipsis",
		whiteSpace: "nowrap",
	});
});

test("a deep flattened chain clips inside the sidebar instead of widening its row", async ({
	page,
	nestedUrl,
}) => {
	await page.goto(nestedUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const tree = page.locator("file-tree-container");
	const chainRow = tree.locator(`[data-item-path="${DEEP_CHAIN_PATH}"]`);
	await expect(chainRow).toBeVisible();

	const metrics = await chainRow.evaluate((button) => {
		const clip = button.querySelector<HTMLElement>(
			"[data-item-flattened-clip]",
		);
		const git = button.querySelector('[data-item-section="git"]');
		const host = document.getElementById("tree");
		return {
			rowRight: button.getBoundingClientRect().right,
			gitRight: git?.getBoundingClientRect().right ?? Number.NaN,
			hostRight: host?.getBoundingClientRect().right ?? Number.NaN,
			clipOverflows:
				clip != null
					? clip.scrollWidth > clip.getBoundingClientRect().width
					: false,
		};
	});

	// The row (git dot included) stays inside the sidebar…
	expect(metrics.rowRight).toBeLessThanOrEqual(metrics.hostRight);
	expect(metrics.gitRight).toBeLessThanOrEqual(metrics.hostRight);
	// …because the clip element is where the too-long path actually overflows
	// (which is what makes the CSS ellipsis render).
	expect(metrics.clipOverflows).toBe(true);
});

test("tree rows show the full path as a native title tooltip", async ({
	page,
	nestedUrl,
}) => {
	await page.goto(nestedUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const tree = page.locator("file-tree-container");
	await expect(tree.locator('[data-item-path="src/hello.ts"]')).toHaveAttribute(
		"title",
		"src/hello.ts",
	);

	// Flattened chain rows: the tooltip is the terminal segment's full path
	// (same value as data-item-path), not the " / "-joined display text —
	// exactly what the ellipsis hides on the deep chain.
	await expect(
		tree.locator('[data-item-path="src/mid/deep/"]'),
	).toHaveAttribute("title", "src/mid/deep/");
	await expect(
		tree.locator(`[data-item-path="${DEEP_CHAIN_PATH}"]`),
	).toHaveAttribute("title", DEEP_CHAIN_PATH);
});

// Regression net for vendored deviation 4 (flattened rows clip once at the end;
// every row has a full-path title) — vendored-packages.md. The deep-chain test
// is the load-bearing one: a nowrap run's min-content propagates up the row's
// flex chain and would widen the row past the sidebar instead of clipping.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

// Deep enough that the joined path can never fit the default 300px sidebar.
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
	// Worker-scoped: the repo is mutated only at setup, so the tests share one
	// launch.
	nestedUrl: [
		async ({}, use) => {
			const viewer = await launchViewer([], { nestedChainFile: true });
			const chainDir = join(viewer.repoDir, ...DEEP_CHAIN);
			const chainFile = join(chainDir, "GoodsReviewPolicyBottomSheet.test.tsx");
			mkdirSync(chainDir, { recursive: true });
			writeFileSync(chainFile, "export const t = 1;\n");
			for (const args of [
				// Stage ONLY the new chain — `add -A` would also commit the fixture's
				// working-tree edits and drop them from the diff.
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

	// `[data-truncate-container]` is the per-segment Truncate widget.
	await expect(clip.locator("[data-truncate-container]")).toHaveCount(0);

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

	expect(metrics.rowRight).toBeLessThanOrEqual(metrics.hostRight);
	expect(metrics.gitRight).toBeLessThanOrEqual(metrics.hostRight);
	// The overflow must happen inside the clip element — that's what renders
	// the ellipsis.
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

	// Flattened rows: the title is the terminal path (as in data-item-path), not
	// the " / "-joined display text.
	await expect(
		tree.locator('[data-item-path="src/mid/deep/"]'),
	).toHaveAttribute("title", "src/mid/deep/");
	await expect(
		tree.locator(`[data-item-path="${DEEP_CHAIN_PATH}"]`),
	).toHaveAttribute("title", DEEP_CHAIN_PATH);
});

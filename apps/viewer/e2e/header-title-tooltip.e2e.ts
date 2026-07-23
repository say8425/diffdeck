// [data-title]/[data-prev-name] visually truncate with CSS text-overflow:
// ellipsis while their textContent always holds the full path (see
// korean-filename.e2e.ts). This guards main.ts's ensureTitleTooltips, which
// syncs a native `title` attribute onto those nodes from their own
// textContent so hovering reveals the untruncated path.
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("header title shows a tooltip with the full file path", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const container = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="src/hello.ts"]') });
	await expect(container).toBeVisible();

	const [titleText, titleAttr] = await container.evaluate((el) => {
		const node = el.shadowRoot?.querySelector("[data-title]");
		return [node?.textContent ?? "", node?.getAttribute("title") ?? ""];
	});
	expect(titleText).toBe("src/hello.ts");
	expect(titleAttr).toBe(titleText);
});

test("renamed file's header shows tooltips on both the old and new name", async ({
	page,
}) => {
	const viewer = await launchViewer([], {});
	try {
		// hello.ts is edited in the fixture's working tree; revert that first so
		// a pure rename (no content change) stays above git's similarity
		// threshold and is reported as a rename instead of add+delete.
		const checkout = spawnSync(
			"git",
			["-C", viewer.repoDir, "checkout", "--", "src/hello.ts"],
			{ stdio: "pipe" },
		);
		expect(checkout.status).toBe(0);
		const result = spawnSync(
			"git",
			["-C", viewer.repoDir, "mv", "src/hello.ts", "src/renamed-hello.ts"],
			{ stdio: "pipe" },
		);
		expect(result.status).toBe(0);

		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/renamed-hello.ts"]') });
		await expect(container).toBeVisible();

		const attrs = await container.evaluate((el) => {
			const prev = el.shadowRoot?.querySelector("[data-prev-name]");
			const title = el.shadowRoot?.querySelector("[data-title]");
			return {
				prevText: prev?.textContent ?? "",
				prevAttr: prev?.getAttribute("title") ?? "",
				titleText: title?.textContent ?? "",
				titleAttr: title?.getAttribute("title") ?? "",
			};
		});
		expect(attrs.prevText).toBe("src/hello.ts");
		expect(attrs.prevAttr).toBe("src/hello.ts");
		expect(attrs.titleText).toBe("src/renamed-hello.ts");
		expect(attrs.titleAttr).toBe("src/renamed-hello.ts");
	} finally {
		await viewer.stop();
	}
});

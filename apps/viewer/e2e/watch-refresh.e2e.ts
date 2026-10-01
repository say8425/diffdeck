import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ watchViewer: { url: string; repoDir: string } }>({
	watchViewer: async ({}, use) => {
		const { url, repoDir, stop } = await launchViewer(["--watch"]);
		await use({ url, repoDir });
		await stop();
	},
});

const diffHasText = (page: Page, needle: string): Promise<boolean> =>
	page.evaluate(
		(n) =>
			Array.from(document.querySelectorAll("diffs-container")).some((el) =>
				(el.shadowRoot?.textContent ?? "").includes(n),
			),
		needle,
	);

test("watch polling 304s while idle and re-renders an edited file on the next poll", async ({
	page,
	watchViewer,
}) => {
	await page.goto(watchViewer.url);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect
		.poll(() => diffHasText(page, "hello, world"), { timeout: 15_000 })
		.toBe(true);

	await page.waitForResponse(
		(res) => res.url().includes("/api/diff") && res.status() === 304,
		{ timeout: 15_000 },
	);
	expect(await diffHasText(page, "hello, world")).toBe(true);

	writeFileSync(
		join(watchViewer.repoDir, "src", "hello.ts"),
		'export const hello = (): string => "hello, watched world";\n',
	);
	await expect
		.poll(() => diffHasText(page, "hello, watched world"), { timeout: 15_000 })
		.toBe(true);

	// "Working-tree edit"는 편집하지 않은 README.md의 내용이다.
	expect(await diffHasText(page, "Working-tree edit")).toBe(true);
});

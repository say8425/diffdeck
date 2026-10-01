// 문구는 load-error.test.ts가 지킨다. 여기서는 서버 표식 → 카드 → 버튼의
// 배선을 본다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test } from "./fixtures/app.ts";

const withParams = (url: string, set: Record<string, string>): string => {
	const next = new URL(url);
	for (const [k, v] of Object.entries(set)) next.searchParams.set(k, v);
	return next.toString();
};

const card = (page: Page) => page.locator("#diff #empty[data-load-error]");

test("a plain directory says it is not a git repository and names it", async ({
	page,
	viewerUrl,
}) => {
	const plain = mkdtempSync(join(tmpdir(), "diffdeck-plain-"));
	try {
		await page.goto(withParams(viewerUrl, { repo: plain }));
		await expect(card(page).locator(".empty-headline")).toHaveText(
			"Not a git repository",
		);
		await expect(card(page).locator(".empty-context")).toHaveText(plain);
		await expect(page.locator("#status")).toHaveText(
			"Failed to load diff: not a git repository",
		);
		await page.locator("#ref-picker-btn").click();
		await expect(page.locator("#ref-picker-empty")).toHaveText(
			"Couldn't load branches",
		);
	} finally {
		rmSync(plain, { recursive: true, force: true });
	}
});

test("a deleted folder is told apart from a non-repository", async ({
	page,
	viewerUrl,
}) => {
	const gone = join(tmpdir(), "diffdeck-no-such-dir-e2e");
	await page.goto(withParams(viewerUrl, { repo: gone }));
	await expect(card(page).locator(".empty-headline")).toHaveText(
		"That folder doesn't exist",
	);
	await expect(card(page).locator(".empty-context")).toHaveText(gone);
});

test("a rejected token says so instead of a bare failure", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(withParams(viewerUrl, { token: "not-the-token" }));
	await expect(card(page).locator(".empty-headline")).toHaveText(
		"This link's access token was rejected",
	);
});

test("an unreachable server offers a retry that actually reloads", async ({
	page,
	viewerUrl,
}) => {
	await page.route("**/api/diff*", (route) => route.abort());
	await page.goto(viewerUrl);
	await expect(card(page).locator(".empty-headline")).toHaveText(
		"Can't reach the diffdeck server",
	);
	await page.unroute("**/api/diff*");
	await card(page).locator("button.empty-action").click();
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
		timeout: 15_000,
	});
	await expect(card(page)).toHaveCount(0);
});

test("an unknown base in the URL names it and leads to the default base", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(withParams(viewerUrl, { base: "no-such-base" }));
	await expect(card(page).locator(".empty-headline")).toHaveText(
		"That base is gone",
	);
	await expect(card(page).locator(".empty-context")).toContainText(
		"no-such-base",
	);
	expect(new URL(page.url()).searchParams.get("base")).toBe("no-such-base");

	await card(page).locator("button.empty-action").click();
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
		timeout: 15_000,
	});
	expect(new URL(page.url()).searchParams.get("base")).toBeNull();
});

test("a failed image load says so instead of a broken icon", async ({
	page,
	viewerUrl,
}) => {
	await page.route("**/api/blob*", (route) =>
		route.fulfill({ status: 404, body: "not found" }),
	);
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await page
		.locator("file-tree-container")
		.locator('[data-item-path="assets/logo.png"]')
		.click();
	const imageCard = page
		.locator("diffs-container")
		.filter({ has: page.locator('[data-fold="assets/logo.png"]') })
		.locator("[data-image-card]");
	await expect(imageCard.locator(".img-error")).toHaveCount(2);
	await expect(imageCard.locator(".img-error").first()).toHaveText(
		"Couldn't load image",
	);
	await expect(imageCard.locator("img")).toHaveCount(0);
});

// watch 중에는 focus가 발화하지 않는다 — 다음 두 스펙은 focus 없이 폴만으로
// 이유가 뜨는지 본다.
test("a watch poll surfaces a deleted folder on the empty-state screen", async ({
	page,
}) => {
	const viewer = await launchViewer(["--watch"], { clean: true });
	try {
		await page.goto(viewer.url);
		await expect(
			page.locator("#diff #empty.empty-card:not([data-load-error])"),
		).toBeVisible({ timeout: 15_000 });
		rmSync(viewer.repoDir, { recursive: true, force: true });
		await expect(card(page).locator(".empty-headline")).toHaveText(
			"That folder doesn't exist",
			{ timeout: 15_000 },
		);
	} finally {
		await viewer.stop();
	}
});

test("a watch poll surfaces the reason in the status while a diff is on screen", async ({
	page,
}) => {
	const viewer = await launchViewer(["--watch"]);
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		const rendered = await page.locator("diffs-container").count();
		rmSync(viewer.repoDir, { recursive: true, force: true });
		await expect(page.locator("#status")).toHaveText(
			"Failed to load diff: folder not found",
			{ timeout: 15_000 },
		);
		// 살아 있는 CodeView는 덮어쓰지 않는다(viewer.md의 innerHTML 항목).
		await expect(page.locator("diffs-container")).toHaveCount(rendered);
		await expect(card(page)).toHaveCount(0);
	} finally {
		await viewer.stop();
	}
});

// 304 복구는 renderPatch를 거치지 않는다 — 실패 카드의 `id="empty"`가
// 계약이다(viewer.md).
test("recovering through a 304 replaces the failure card with the empty state", async ({
	page,
}) => {
	const viewer = await launchViewer([], { clean: true });
	try {
		await page.goto(viewer.url);
		const emptyCard = page.locator(
			"#diff #empty.empty-card:not([data-load-error])",
		);
		await expect(emptyCard).toBeVisible({ timeout: 15_000 });

		await page.route("**/api/diff*", (route) => route.abort());
		await page.locator("#refresh").click();
		await expect(card(page)).toBeVisible({ timeout: 15_000 });

		await page.unroute("**/api/diff*");
		const notModified = page.waitForResponse(
			(r) => r.url().includes("/api/diff") && r.status() === 304,
		);
		await page.locator("#refresh").click();
		await notModified;
		await expect(emptyCard).toBeVisible({ timeout: 15_000 });
		await expect(card(page)).toHaveCount(0);
	} finally {
		await viewer.stop();
	}
});

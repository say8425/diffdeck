// diff를 못 불러왔을 때 화면이 **이유를 말하는가**. 예전엔 사라진 head 하나만
// 전용 카드였고 나머지는 전부 "Failed to load diff." 한 줄이었다 — 홈
// 디렉토리를 `repo=`로 연 링크에서 서버는 "not a git repository"라고 답했는데
// 화면은 그걸 버렸다(실제 사고). 문구 자체는 load-error.test.ts가 지키고,
// 여기서는 서버 표식 → 카드 → 버튼의 배선을 실브라우저로 본다.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures/app.ts";

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
		// 그 리포엔 브랜치 목록도 없다 — 피커가 "Loading…"을 무기한 말하면
		// 끝나지 않을 일을 진행 중이라 주장하는 셈이다.
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

// URL에 명시된 base는 저장된 값과 달리 조용히 되돌리지 않는다(main.ts의
// recoverFromStaleBase) — 그래서 카드가 이유를 말하고, 버튼을 누르기 전까지
// URL은 그대로다.
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

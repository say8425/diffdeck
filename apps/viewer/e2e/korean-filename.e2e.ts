// 비ASCII 경로는 두 곳에서 git 스타일로 인용될 수 있다: 서버가 읽는 git 출력
// (`-z`로 받는다)과, vendored parseDiffFromFile이 되읽는 패치 헤더(main.ts가
// 서버가 준 이름으로 덮어쓴다).
import { spawnSync } from "node:child_process";
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("a Korean filename renders in the tree with real diff content, header title, and copy-path — not garbled", async ({
	page,
}) => {
	const viewer = await launchViewer([], { koreanFilename: true });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

		const treeHasPath = await page
			.locator("file-tree-container")
			.evaluate(
				(el) =>
					el.shadowRoot?.querySelector('[data-item-path="src/한글파일.ts"]') !=
					null,
			);
		expect(treeHasPath).toBe(true);

		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/한글파일.ts"]') });
		await expect(container).toBeVisible();

		const preText = () =>
			container.evaluate(
				(el) => el.shadowRoot?.querySelector("pre")?.textContent ?? "",
			);
		await expect.poll(preText).toContain("korean");
		await expect.poll(preText).toContain("base");
		await expect.poll(preText).toContain("edited");

		const headerTitleText = await container.evaluate(
			(el) => el.shadowRoot?.querySelector("[data-title]")?.textContent ?? "",
		);
		expect(headerTitleText).toContain("src/한글파일.ts");
		expect(headerTitleText).not.toContain("\\355");

		await page
			.context()
			.grantPermissions(["clipboard-read", "clipboard-write"]);
		const header = container.locator("[data-diffs-header]").first();
		await header.hover();
		const copyButton = container.locator("[data-copy-name]");
		await expect(copyButton).toBeVisible();
		await copyButton.click();
		await expect
			.poll(() => page.evaluate(() => navigator.clipboard.readText()))
			.toBe("src/한글파일.ts");
	} finally {
		await viewer.stop();
	}
});

test("renaming to a Korean filename shows the real old and new names in the header", async ({
	page,
}) => {
	const viewer = await launchViewer([], { koreanFilename: true });
	try {
		// 픽스처의 워킹트리 편집을 먼저 되돌린다 — 한 줄짜리 파일은 내용까지
		// 바뀌면 유사도 미달로 rename이 아니라 add+delete가 된다.
		const checkout = spawnSync(
			"git",
			["-C", viewer.repoDir, "checkout", "--", "src/한글파일.ts"],
			{ stdio: "pipe" },
		);
		expect(checkout.status).toBe(0);
		const result = spawnSync(
			"git",
			["-C", viewer.repoDir, "mv", "src/한글파일.ts", "src/새이름.ts"],
			{ stdio: "pipe" },
		);
		expect(result.status).toBe(0);

		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

		const container = page
			.locator("diffs-container")
			.filter({ has: page.locator('[data-fold="src/새이름.ts"]') });
		await expect(container).toBeVisible();

		const [prevNameText, titleText] = await container.evaluate((el) => [
			el.shadowRoot?.querySelector("[data-prev-name]")?.textContent ?? "",
			el.shadowRoot?.querySelector("[data-title]")?.textContent ?? "",
		]);
		expect(prevNameText).toBe("src/한글파일.ts");
		expect(titleText).toBe("src/새이름.ts");
		expect(prevNameText).not.toContain("\\355");
		expect(titleText).not.toContain("\\355");
	} finally {
		await viewer.stop();
	}
});

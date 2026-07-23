// 회귀 가드: 두 겹의 버그가 겹쳐 있었다.
//
// 1) 서버: git의 기본값(core.quotePath=true)에서는 -z 없는
//    `git diff --name-status`/`git ls-files`가 비-ASCII 경로를 큰따옴표+8진
//    이스케이프로 인용해서 낸다. 그 인용 문자열을 그대로 파일 경로로 쓰면
//    git show/readFileSync가 못 찾아 조용히 빈 diff가 렌더됐다
//    (apps/viewer/server/diff.ts의 `parseNameStatusZ` 도입 전 실제 재현).
// 2) 클라이언트: 서버가 이미 올바른 이름을 내려줘도, vendored
//    parseDiffFromFile(@diffdeck/diffs)이 npm `diff`의 createTwoFilesPatch로
//    유니파이드 diff 텍스트를 만든 뒤 그 텍스트의 `--- `/`+++ ` 헤더 줄을
//    되읽어 이름을 복원하는데, `diff`가 비-ASCII 경로를 그 텍스트 헤더에 다시
//    git 스타일로 인용해서 쓰고 vendored 파서는 그걸 그대로(unquote 없이)
//    되읽는다 — fileDiff.name/prevName이 인용된 채로 남는다. main.ts가 파싱
//    직후 그 필드들을 서버가 준 진짜 이름으로 덮어써 고친다.
//
// 실 CLI + 실 브라우저로 트리 노출·diff 본문·헤더 타이틀 텍스트·copy-path·
// rename(old→new 표시)까지 end-to-end로 검증한다.
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
		// 버그 상태에서는 old/new 둘 다 빈 문자열이라 <pre>가 아예 없거나 비어
		// 있었다 — 실제 old/new 내용이 둘 다 보여야 통과.
		await expect.poll(preText).toContain("korean");
		await expect.poll(preText).toContain("base");
		await expect.poll(preText).toContain("edited");

		// 헤더에 보이는 타이틀 텍스트 자체가 실제 경로여야 한다 (fileDiff.name이
		// 인용된 채로 남으면 vendored 기본 헤더 렌더가 그 문자 그대로 보여준다).
		const headerTitleText = await container.evaluate(
			(el) => el.shadowRoot?.querySelector("[data-title]")?.textContent ?? "",
		);
		expect(headerTitleText).toContain("src/한글파일.ts");
		expect(headerTitleText).not.toContain("\\355");

		// copy-path도 인용되지 않은 실제 경로를 복사해야 한다.
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
		// 픽스처는 base에 src/한글파일.ts를 커밋하고 워킹트리에서 내용까지
		// 바꿔둔다. 여기서는 이름만 바꾼 순수 rename을 재현해야 하므로, 먼저
		// 워킹트리 편집을 되돌려 base 내용과 동일하게 맞춘다 — 안 그러면
		// 한 줄짜리 파일에서 내용 변경 + 이름 변경이 겹쳐 git의 유사도 판정이
		// 50% 미만으로 떨어져 rename이 아니라 add+delete로 보고된다(git 기본
		// 동작, diffdeck과 무관 — 실제로 재현·확인함).
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

		// rename 헤더는 old/new 이름을 별도 요소로 렌더한다
		// (createFileHeaderElement.ts: [data-prev-name]가 old, [data-title]이 new).
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

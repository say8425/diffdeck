// Fold-with-tree + flatten: `flattenEmptyDirectories`(연속 단일 자식 디렉토리를
// 한 행으로 압축 표시)가 켜진 상태에서 압축된 행을 접어도 그 아래 diff
// 파일이 정상적으로 접히는지 검증한다. 압축 행 하나는 전체 체인의 "종단"
// 경로(예: "src/mid/deep")에만 매핑되고, 클릭도 이 종단 경로만 토글한다(중간
// 경로의 collapse는 렌더링에 반영되지 않는 구조적 no-op) — 경험적으로 검증됨.
// buildDirDescendants가 모든 조상 depth를 개별 검사하지만, 실제로 "접힘"으로
// 관측되는 건 사용자가 실제로 접을 수 있는 종단 경로뿐이므로 이 설계는 별도
// 처리 없이도 올바르게 동작한다.
import { expect, hasCode, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ nestedUrl: string }>({
	nestedUrl: async ({}, use) => {
		const { url, stop } = await launchViewer(["--fold-with-tree"], {
			nestedChainFile: true,
		});
		await use(url);
		await stop();
	},
});

test("collapsing a flatten-compressed directory row folds its diff file", async ({
	page,
	nestedUrl,
}) => {
	await page.goto(nestedUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect.poll(() => hasCode(page, "src/mid/deep/nested.ts")).toBe(true);

	// flatten compresses `src/mid/deep` into a single row; the row's own
	// `data-item-path` carries the terminal path with a trailing slash.
	const chainRow = page
		.locator("file-tree-container")
		.locator('[data-item-path="src/mid/deep/"]');
	await expect(chainRow).toBeVisible();
	await chainRow.click();

	await expect.poll(() => hasCode(page, "src/mid/deep/nested.ts")).toBe(false);
	await expect(
		page.locator('[data-fold="src/mid/deep/nested.ts"]'),
	).toHaveAttribute("aria-label", "Expand file");
});

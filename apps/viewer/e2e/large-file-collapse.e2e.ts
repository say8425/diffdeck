// 자동 접힘의 판정 기준은 "파일 길이"가 아니라 "변경량"이다.
//
// 뷰어는 첫 등장한 대형 파일을 접어서 마운트한다(main.ts의 isLargeFile). 그
// "대형"의 기준이 되는 changedLines를 예전엔 `FileDiffMetadata`의
// additionLines/deletionLines 길이 합으로 셌는데, 그 둘은 이름과 달리 변경된
// 줄이 아니다: 뷰어는 파일 전량으로 diff를 만들어(`isPartial === false`) 두
// 배열이 각각 새/옛 파일의 **전체 내용**이 된다. 즉 실효 판정식이 "파일 길이
// × 2 > 1500"이라, 몇 줄만 고친 긴 문서가 접힌 채로 떴다(실측: 1,166줄
// CLAUDE.md의 +28/-2 변경이 2,306으로 읽혔다).
//
// 이 계약은 유닛이 원리적으로 못 잡는다 — isLargeFile 자체는 옳았고 호출부가
// 틀린 값을 넘겼을 뿐이라, 기존 isLargeFile 테스트 다섯 개가 전부 통과한 채로
// 버그가 살아 있었다. 그래서 배선까지 태우는 e2e가 회귀망이다.
//
// 픽스처는 2,000줄 파일에서 3줄만 고친다: 구 로직이면 4,000으로 읽혀 접히고,
// 변경량(6줄)으로 읽으면 접히지 않는다. 반대 방향(변경량이 실제로 임계값을
// 넘는 대형 재작성은 여전히 접힌다)은 retokenize-cache.e2e.ts의 big.ts가,
// 이름 기반 lockfile 접힘은 lockfile-freeze.e2e.ts가 이미 지킨다.
import { expect, hasCode, launchViewer, test } from "./fixtures/app.ts";

test("a long file whose diff is small must not start collapsed", async ({
	page,
}) => {
	const viewer = await launchViewer([], { longFileSmallEdit: true });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect
			.poll(() => hasCode(page, "src/long.ts"), { timeout: 20_000 })
			.toBe(true);
		// 헤더 caret도 같은 말을 해야 한다: 펼쳐진 파일의 버튼은 "접기"를 제안한다.
		await expect(page.locator('[data-fold="src/long.ts"]')).toHaveAttribute(
			"aria-label",
			"Collapse file",
		);
	} finally {
		await viewer.stop();
	}
});

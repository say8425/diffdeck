// 자동 접힘의 판정 기준은 "파일 길이"가 아니라 "변경량"이다.
//
// 뷰어는 첫 등장한 대형 파일을 접어서 마운트한다(main.ts의 isLargeFile). 그
// "대형"의 기준이 되는 changedLines를 예전엔 `FileDiffMetadata`의
// additionLines/deletionLines 길이 합으로 셌는데, 그 둘은 이름과 달리 변경된
// 줄이 아니다: 뷰어는 파일 전량으로 diff를 만들어(`isPartial === false`) 두
// 배열이 각각 새/옛 파일의 **전체 내용**이 된다. 즉 실효 판정식이 "파일 길이
// × 2 > 1500"이라, 몇 줄만 고친 긴 문서가 접힌 채로 떴다(실측: headerlab의
// 1,166줄 CLAUDE.md에 +28/-2를 낸 변경이 2,306으로 읽혔다).
//
// 이 계약은 유닛이 원리적으로 못 잡는다 — isLargeFile 자체는 옳았고 호출부가
// 틀린 값을 넘겼을 뿐이라, 기존 isLargeFile 테스트 다섯 개가 전부 통과한 채로
// 버그가 살아 있었다. 그래서 배선까지 태우는 e2e가 회귀망이다.
//
// **세 방향을 여기서 함께 지킨다.** 예전엔 ①만 두고 ②를
// `retokenize-cache.e2e.ts`가, ③을 `lockfile-freeze.e2e.ts`가 지킨다고 적어
// 뒀는데 둘 다 사실이 아니었다. 그 두 스펙은 접힘 상태를 **단언하지 않는다**
// (전자는 헤더 click으로 펼친 뒤 하이라이트를 기다리고, 후자는 헤더 존재만
// 본다 — 헤더는 접혔든 펼쳐졌든 있다). 자동 접힘이 사라져도 클릭이 반대로
// 동작해 뒤따르는 단언이 깨지는 **부수효과**로만 빨간불이 될 뿐이다. 게다가
// lockfile 픽스처는 20줄마다 2줄을 바꿔 8k에서 1,596줄, 30k에서 5,996줄을
// 변경하므로(실측) **크기 규칙만으로 이미 접힌다** — LOCKFILE_NAMES를 통째로
// 비워도 그 스펙은 초록이라, 이름 규칙을 지키는 회귀망이 아니었다.
import { expect, hasCode, launchViewer, test } from "./fixtures/app.ts";

// ① 길지만 변경이 작은 파일: 2,000줄에서 3줄만 고친다. 줄을 교체할 뿐이라
// 옛 파일도 2,000줄이므로, 구 로직이면 새/옛 전량을 더해 정확히 4,000으로
// 읽혀 접혔다(실측). 변경량(6줄)으로 읽으면 접히지 않는다.
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

// ② 반대 방향: 변경량이 실제로 임계값을 넘으면 여전히 접혀야 한다. 800줄
// 전량 재작성 = 1,600줄 변경으로 LARGE_FILE_LINE_THRESHOLD(1,500)를 넘긴다
// (실측). 이 단언이 없으면 changedLines가 항상 0에 가까운 값으로 퇴화해도
// ①은 그대로 초록이라(접히지 않는 게 기대값) 아무도 못 잡는다.
test("a diff larger than the threshold still starts collapsed", async ({
	page,
}) => {
	const viewer = await launchViewer([], { bigFileLines: 800 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator('[data-fold="src/big.ts"]')).toHaveAttribute(
			"aria-label",
			"Expand file",
			{ timeout: 20_000 },
		);
		expect(await hasCode(page, "src/big.ts")).toBe(false);
	} finally {
		await viewer.stop();
	}
});

// ③ 이름 규칙: lockfile은 변경량이 임계값 아래여도 접힌다. 1,000줄 픽스처는
// 20줄마다 2줄만 바꿔 변경량이 196줄에 그치므로(실측) 크기 규칙으로는 절대
// 접히지 않는다 — 접히는 유일한 근거가 largeFile.ts의 LOCKFILE_NAMES다.
test("a lockfile collapses by name even when its diff is small", async ({
	page,
}) => {
	const viewer = await launchViewer([], { lockfileLines: 1000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator('[data-fold="pnpm-lock.yaml"]')).toHaveAttribute(
			"aria-label",
			"Expand file",
			{ timeout: 20_000 },
		);
		expect(await hasCode(page, "pnpm-lock.yaml")).toBe(false);
	} finally {
		await viewer.stop();
	}
});

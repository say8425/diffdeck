// In-app find (Cmd/Ctrl+F): opens `#find-bar`, highlights every match across
// files (`mark.cc-find-hit` in each `<diffs-container>`'s shadow root, plus
// `mark.cc-find-hit--active` on the current one), and Enter advances to the
// next match. `src/hello.ts`'s working-tree diff contains "hello" twice per
// line (the `hello` identifier and the `"hello, world"` string literal) on
// both its deletion and addition lines, so a "hello" query reliably yields
// multiple matches within a single small fixture file (confirmed empirically:
// 4 total, "1/4" on open).
import { expect, test } from "./fixtures/app.ts";

test("Cmd/Ctrl+F opens find, highlights matches, and Enter advances", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const findBar = page.locator("#find-bar");
	await expect(findBar).toBeHidden();

	// findBar.ts's shortcut listener accepts either modifier
	// (`event.metaKey || event.ctrlKey`), so Control+F opens it regardless of
	// the host OS the test runner is on.
	await page.keyboard.press("Control+F");
	await expect(findBar).toBeVisible();

	await page.locator("#find-input").fill("hello");

	const findCount = page.locator("#find-count");
	await expect(findCount).toHaveText(/\d+\/\d+/);

	const hitCount = () =>
		page.evaluate(
			() =>
				Array.from(document.querySelectorAll("diffs-container")).flatMap((c) =>
					Array.from(c.shadowRoot?.querySelectorAll("mark.cc-find-hit") ?? []),
				).length,
		);
	await expect.poll(hitCount).toBeGreaterThan(0);

	const activeCount = () =>
		page.evaluate(
			() =>
				Array.from(document.querySelectorAll("diffs-container")).flatMap((c) =>
					Array.from(
						c.shadowRoot?.querySelectorAll("mark.cc-find-hit--active") ?? [],
					),
				).length,
		);
	await expect.poll(activeCount).toBe(1);

	const countBefore = await findCount.textContent();
	const numeratorBefore = Number(countBefore?.split("/")[0]);

	await page.locator("#find-input").press("Enter");

	// Web-first: poll until the numerator actually advances (wraps mod total),
	// rather than a fixed sleep.
	await expect
		.poll(async () => {
			const text = await findCount.textContent();
			return Number(text?.split("/")[0]);
		})
		.not.toBe(numeratorBefore);
	await expect.poll(activeCount).toBe(1);
});

// 회귀망(2026-07-28): 렌더된 줄은 intraline word-diff span과 (워커 하이라이트
// 완료 후) 신택스 토큰 span으로 텍스트 노드가 쪼개진다. highlightDom이 텍스트
// 노드 단위로만 매칭하던 시절엔 "const hello"처럼 토큰 경계를 가로지르는
// 쿼리가 — 카운터는 매치를 세면서도 — 화면에 mark를 하나도 만들지 못했다
// ("1/1"인데 하이라이트 0개). 색이 실제로 입혀진 DOM에서 경계 교차 쿼리의
// mark가 매치 수만큼 온전히 생기는지 검증한다.
test("a query crossing syntax-token boundaries still highlights after colors land", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 워커 비동기 하이라이트가 실제로 착지해 줄이 토큰 span으로 쪼개질 때까지
	// 대기 — plain 렌더 상태에서는 "const hello" 구간이 단일 텍스트 노드라
	// 예전 코드도 통과해버려 회귀 감지가 안 된다.
	await expect
		.poll(
			() =>
				page.evaluate(() =>
					[...document.querySelectorAll("diffs-container")].some(
						(c) =>
							(c.shadowRoot?.textContent ?? "").includes("hello, world") &&
							c.shadowRoot
								?.querySelector("pre")
								?.querySelector("span[style]") != null,
					),
				),
			{ timeout: 20_000 },
		)
		.toBe(true);

	await page.keyboard.press("Control+F");
	await page.locator("#find-input").fill("const hello");

	// hello.ts의 deletion/addition 줄 각각 1회씩 — 분모 2.
	const findCount = page.locator("#find-count");
	await expect(findCount).toHaveText(/^\d+\/2$/);

	// 노드 경계에 걸친 매치는 조각 mark 여러 개로 표시된다 — 문서 순서로
	// 이어붙이면 매치당 정확히 "const hello"가 복원되어야 한다.
	await expect
		.poll(() =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll("diffs-container"))
					.flatMap((c) =>
						Array.from(
							c.shadowRoot?.querySelectorAll("mark.cc-find-hit") ?? [],
						),
					)
					.map((m) => m.textContent)
					.join(""),
			),
		)
		.toBe("const hello".repeat(2));

	// 활성 매치의 조각들도 --active를 달고 실제 화면에 존재한다.
	await expect
		.poll(() =>
			page.evaluate(() =>
				Array.from(document.querySelectorAll("diffs-container"))
					.flatMap((c) =>
						Array.from(
							c.shadowRoot?.querySelectorAll("mark.cc-find-hit--active") ?? [],
						),
					)
					.map((m) => m.textContent)
					.join(""),
			),
		)
		.toBe("const hello");
});

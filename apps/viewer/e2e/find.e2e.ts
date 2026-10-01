import { expect, test } from "./fixtures/app.ts";

test("Cmd/Ctrl+F opens find, highlights matches, and Enter advances", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	const findBar = page.locator("#find-bar");
	await expect(findBar).toBeHidden();

	// The shortcut accepts Ctrl as well as Cmd, so Control+F works on every OS.
	await page.keyboard.press("Control+F");
	await expect(findBar).toBeVisible();

	// "hello" appears twice on both the deleted and the added line of
	// src/hello.ts, so there are several matches for Enter to advance through.
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

	await expect
		.poll(async () => {
			const text = await findCount.textContent();
			return Number(text?.split("/")[0]);
		})
		.not.toBe(numeratorBefore);
	await expect.poll(activeCount).toBe(1);
});

test("a query crossing syntax-token boundaries still highlights after colors land", async ({
	page,
	viewerUrl,
}) => {
	await page.goto(viewerUrl);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);

	// 하이라이트가 착지해 줄이 토큰 span으로 쪼개진 뒤에 찾는다 — plain
	// 렌더에서는 "const hello"가 한 텍스트 노드라 경계 교차를 시험하지 못한다.
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

	// hello.ts의 삭제·추가 줄에 한 번씩.
	const findCount = page.locator("#find-count");
	await expect(findCount).toHaveText(/^\d+\/2$/);

	// 경계에 걸친 매치는 조각 mark 여러 개가 된다 — 이어 붙이면 매치마다
	// "const hello"여야 한다.
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

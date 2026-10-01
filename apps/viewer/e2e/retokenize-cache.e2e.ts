// 오버스캔을 벗어났다 재진입하는 파일이 전체 재토크나이즈로 프레임을 얼리면
// 안 된다 — vendored 예외 3(recycle의 renderCache 보존)의 회귀망이다
// (vendored-packages.md). 두 번째 테스트는 보존된 캐시가 스테일하지 않은지 본다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, launchViewer, test } from "./fixtures/app.ts";

test("re-entering a highlighted file must not freeze the frame with a re-tokenize", async ({
	page,
}) => {
	// big.ts는 재토크나이즈가 있으면 상한을 확실히 넘고 없으면 확실히 안 넘는
	// 크기다. bulk 12개는 big.ts를 오버스캔 밖으로 밀어낼 거리를 만든다.
	const viewer = await launchViewer([], { bulkFiles: 12, bigFileLines: 4000 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();
		// 포인터를 패널 밖에 둔다(:hover 간섭 배제).
		await page.mouse.move(2, 2);

		// big.ts는 대형 파일이라 접힌 채 마운트된다. 접힌 렌더에는 보존할 캐시가
		// 없으므로 헤더를 눌러 펼친다. big.ts 탐색은 evaluate마다 인라인한다 —
		// 콜백은 브라우저에서 돌아 바깥 함수를 못 쓴다.
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							[...document.querySelectorAll("diffs-container")].find(
								(c) =>
									c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
									"src/big.ts",
							) != null,
					),
				{ timeout: 20_000 },
			)
			.toBe(true);
		const expandBigFile = (): Promise<boolean> =>
			page.evaluate(() => {
				const el = [...document.querySelectorAll("diffs-container")].find(
					(c) =>
						c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
						"src/big.ts",
				);
				const header = el?.shadowRoot?.querySelector("[data-diffs-header]");
				if (!header) return false;
				header.dispatchEvent(
					new MouseEvent("click", { bubbles: true, composed: true }),
				);
				return true;
			});
		await expect.poll(expandBigFile).toBe(true);

		// 하이라이트까지 끝난 renderCache가 보존 대상이다.
		await expect
			.poll(
				() =>
					page.evaluate(() => {
						const el = [...document.querySelectorAll("diffs-container")].find(
							(c) =>
								c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
								"src/big.ts",
						);
						return (
							el?.shadowRoot
								?.querySelector("pre")
								?.querySelector("span[style]") != null
						);
					}),
				{ timeout: 20_000 },
			)
			.toBe(true);
		const bigTop = await page.evaluate(() => {
			const el = [...document.querySelectorAll("diffs-container")].find(
				(c) =>
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"src/big.ts",
			) as HTMLElement;
			const scroller = document.getElementById("diff") as HTMLElement;
			return (
				el.getBoundingClientRect().top -
				scroller.getBoundingClientRect().top +
				scroller.scrollTop
			);
		});

		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].every(
							(c) =>
								c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold !==
								"src/big.ts",
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		// 하단 파일들의 첫 토크나이즈가 측정에 섞이지 않게 기다린다.
		await page.waitForTimeout(1500);

		const reentryMaxGapMs = await page.evaluate(
			(top) =>
				new Promise<number>((resolve) => {
					const scroller = document.getElementById("diff") as HTMLElement;
					let maxGap = 0;
					let last = performance.now();
					let frames = 0;
					const tick = (): void => {
						const now = performance.now();
						maxGap = Math.max(maxGap, now - last);
						last = now;
						frames++;
						if (frames < 120) requestAnimationFrame(tick);
						else resolve(maxGap);
					};
					requestAnimationFrame(tick);
					scroller.scrollTop = top;
				}),
			bigTop,
		);

		// 빈 통과 방지: 재마운트된 행이 하이라이트돼 있어야 캐시를 재사용한
		// 것이다(plain이면 아니다).
		const remounted = await page.evaluate(() => {
			const el = [...document.querySelectorAll("diffs-container")].find(
				(c) =>
					c.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
					"src/big.ts",
			);
			const pre = el?.shadowRoot?.querySelector("pre");
			return {
				mounted: el != null,
				hasHeader: el?.shadowRoot?.querySelector("[data-diffs-header]") != null,
				highlighted: pre?.querySelector("span[style]") != null,
				textLen: pre?.textContent?.length ?? 0,
			};
		});
		expect(remounted.mounted).toBe(true);
		expect(remounted.hasHeader).toBe(true);
		expect(remounted.highlighted).toBe(true);
		// 파일 안도 행 단위로 창 렌더돼 <pre>에는 버퍼 분량만 있다 — 하한은
		// 헤더만 그려진 경우를 가르는 값이다.
		expect(remounted.textLen).toBeGreaterThan(1000);

		// 캐시 렌더는 수십 ms, 동기 재토크나이즈는 수백 ms라 그 사이의 상한.
		expect(reentryMaxGapMs).toBeLessThan(250);
	} finally {
		await viewer.stop();
	}
});

test("a file edited while unmounted re-renders fresh content on re-entry (no stale cache)", async ({
	page,
}) => {
	// 보존된 캐시는 renderDiff의 동등성 검사(areDiffTargetsEqual)로 무효화돼야
	// 한다. bulk 12개가 hello.ts(정렬상 맨 끝)를 첫 화면의 오버스캔 밖에 둔다.
	const viewer = await launchViewer(["--watch"], { bulkFiles: 12 });
	try {
		await page.goto(viewer.url);
		await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/, {
			timeout: 15_000,
		});
		await expect(page.locator("diffs-container").first()).toBeVisible();

		// hello.ts를 한 번 마운트해 캐시를 만든 뒤 최상단으로 돌아가 언마운트한다
		// (캐시가 보존된 상태).
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some((el) =>
							(el.shadowRoot?.textContent ?? "").includes("hello, world"),
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = 0;
		});
		await expect
			.poll(
				() =>
					page.evaluate(
						() =>
							![...document.querySelectorAll("diffs-container")].some(
								(el) =>
									el.querySelector<HTMLElement>("[data-fold]")?.dataset.fold ===
									"src/hello.ts",
							),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);

		// 언마운트된 채로 파일을 고친다 — 다음 폴이 새 payload(200)를 받는다.
		writeFileSync(
			join(viewer.repoDir, "src", "hello.ts"),
			'export const hello = (): string => "hello, recycled world";\n',
		);
		await page.waitForResponse(
			(res) => res.url().includes("/api/diff") && res.status() === 200,
			{ timeout: 15_000 },
		);

		await page.evaluate(() => {
			const scroller = document.getElementById("diff") as HTMLElement;
			scroller.scrollTop = scroller.scrollHeight;
		});
		await expect
			.poll(
				() =>
					page.evaluate(() =>
						[...document.querySelectorAll("diffs-container")].some((el) =>
							(el.shadowRoot?.textContent ?? "").includes(
								"hello, recycled world",
							),
						),
					),
				{ timeout: 15_000 },
			)
			.toBe(true);
		expect(
			await page.evaluate(() =>
				[...document.querySelectorAll("diffs-container")].some((el) =>
					(el.shadowRoot?.textContent ?? "").includes('"hello, world"'),
				),
			),
		).toBe(false);
	} finally {
		await viewer.stop();
	}
});

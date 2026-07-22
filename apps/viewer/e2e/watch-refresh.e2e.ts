// Watch 자동갱신 사이클: --watch로 2초 폴링이 켜진 상태에서 ① 무변경 폴이
// 조건부 요청(If-None-Match)으로 304를 받아 렌더를 그대로 유지하고 ② 워킹트리
// 편집이 다음 폴에서 200 + 새 payload로 감지되어 그 파일이 재렌더되는,
// 변경량 비례(O(변경)) 갱신 계약을 실브라우저로 고정한다.
//
// diff 내용은 <diffs-container>의 open shadow root 안에 있어(render.e2e.ts
// 헤더 참고) locator 텍스트 매칭 대신 shadowRoot.textContent를 뒤진다.
// 고정 sleep 없이 waitForResponse(304/200)와 expect.poll만 쓴다.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, launchViewer, test as base } from "./fixtures/app.ts";

const test = base.extend<{ watchViewer: { url: string; repoDir: string } }>({
	watchViewer: async ({}, use) => {
		const { url, repoDir, stop } = await launchViewer(["--watch"]);
		await use({ url, repoDir });
		await stop();
	},
});

const diffHasText = (page: Page, needle: string): Promise<boolean> =>
	page.evaluate(
		(n) =>
			Array.from(document.querySelectorAll("diffs-container")).some((el) =>
				(el.shadowRoot?.textContent ?? "").includes(n),
			),
		needle,
	);

test("watch polling 304s while idle and re-renders an edited file on the next poll", async ({
	page,
	watchViewer,
}) => {
	await page.goto(watchViewer.url);
	await expect(page.locator("#status")).toHaveText(/\d+ file\(s\)/);
	await expect
		.poll(() => diffHasText(page, "hello, world"), { timeout: 15_000 })
		.toBe(true);

	// 무변경 폴 한 사이클: 브라우저가 If-None-Match를 보내고 서버가 304로
	// 응답한다 — payload 전송·재파싱·재렌더 전부가 생략되는 경로다.
	await page.waitForResponse(
		(res) => res.url().includes("/api/diff") && res.status() === 304,
		{ timeout: 15_000 },
	);
	expect(await diffHasText(page, "hello, world")).toBe(true);

	// 워킹트리 편집 → 다음 폴이 200으로 새 payload를 받고 그 파일이 재렌더된다.
	writeFileSync(
		join(watchViewer.repoDir, "src", "hello.ts"),
		'export const hello = (): string => "hello, watched world";\n',
	);
	await expect
		.poll(() => diffHasText(page, "hello, watched world"), { timeout: 15_000 })
		.toBe(true);

	// 편집하지 않은 파일(README.md)의 렌더는 그대로 남아 있다.
	expect(await diffHasText(page, "Working-tree edit")).toBe(true);
});

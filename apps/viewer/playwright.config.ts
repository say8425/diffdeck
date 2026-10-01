import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	// github: 실패를 GHA annotation으로 올린다. printsToStdio()가 false라 사람용 출력은
	// list가 맡는다.
	reporter: [["list"], ["github"]],
	// 트레이스가 없으면 CI가 올리는 test-results/에 쓸 만한 실패 산출물이 없다.
	use: { channel: "chrome", headless: true, trace: "retain-on-failure" },
	// 판별력은 각 테스트의 명시적 단언이 갖고 이 값은 상한일 뿐이다 — 공유 러너의
	// 헛실패를 막을 만큼 넉넉히 둔다. worker-highlight.e2e.ts의 폴 timeout이 이
	// 값에 맞춰져 있어, 바꾸면 그쪽도 다시 계산한다.
	timeout: 60_000,
});

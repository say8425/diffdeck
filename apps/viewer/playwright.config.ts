import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	// retain-on-failure: 실패한 테스트만 트레이스를 남긴다(스크린샷 + DOM 스냅샷
	// 포함). 이게 없으면 CI가 올리는 test-results/에 .last-run.json 45바이트만
	// 들어 있어, "실패 산출물을 올린다"는 약속이 실제로는 아무것도 주지 않는다.
	use: { channel: "chrome", headless: true, trace: "retain-on-failure" },
	// 판별력은 각 성능 테스트가 toBeLessThan(300) 같은 명시적 프레임 간격
	// 단언으로 갖는다 — 이 timeout은 상한일 뿐이라 올려도 신호가 약해지지
	// 않는다. CI 최장이 17.2초(retokenize-cache)라 30초는 여유가 1.7배뿐이고,
	// 공유 러너에서 그게 유일한 헛실패 경로다.
	timeout: 60_000,
});

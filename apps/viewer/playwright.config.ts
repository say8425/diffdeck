import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	// github 리포터는 실패를 GHA annotation(Checks 탭·체크 요약, 그 파일이 diff에
	// 포함된 PR이면 Files changed에도 인라인)과 요약 notice로 올린다 — 실패를
	// 찾으려고 잡 로그를 스크롤하지 않아도 된다. env 게이트가 없어 로컬에서도
	// `::notice` 줄이 섞이지만, printsToStdio()가 false라 사람용 출력은 list가
	// 단독으로 담당한다.
	reporter: [["list"], ["github"]],
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

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
	// 실패한 테스트만 한 번 더 돌린다. 결정적 회귀는 두 번 다 같은 지점에서
	// 실패하므로 여전히 빨간불이고, 걸러지는 건 비결정적 실패뿐이다 — 부하가
	// 높은 머신·공유 러너에서 프레임 예산을 못 맞추거나 준비를 못 끝내는 경우.
	// 조용히 묻히지도 않는다: 재시도로 통과한 테스트는 리포터가 flaky로 따로
	// 표시하므로 흔들림 비율 자체를 계속 볼 수 있다.
	//
	// CI만 켜지 않고 로컬에도 같이 적용하는 이유는 이 리포가 로컬↔CI 동등성을
	// 명시적으로 중시하기 때문이다(위 test-results 아티팩트 주석 참고) —
	// 재시도를 한쪽에만 두면 "CI에서만 다르게 동작하는" 부류를 새로 만든다.
	//
	// 대가는 분명히 해 둔다: 이 스위트의 판별력은 toBeLessThan(300) 같은 명시적
	// 프레임 예산 단언이 갖는데, **한계선 회귀**(절반쯤 실패하는 성능 저하)는
	// 재시도가 통과시킬 수 있다. 결정적 회귀와 달리 이건 flaky 표시로만 드러난다.
	// 그래서 특정 스펙이 상습적으로 flaky로 찍히면 그건 retries를 2로 올릴
	// 신호가 아니라 **그 스펙이 무엇을 못 잡고 있는지 들여다볼 신호**다.
	retries: 1,
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	// github 리포터는 실패한 시도를 GHA annotation으로, 요약을 notice로 올린다 —
	// retries: 1을 넣은 뒤 flaky가 초록 잡의 원시 로그에만 남는 것을 막는 유일한
	// 장치다(아래 retries 주석의 tripwire에 센서를 달아 준다). env 게이트가 없어
	// 로컬에서도 `::notice` 줄이 섞이지만, printsToStdio()가 false라 사람용
	// 출력은 list 리포터가 단독으로 담당한다.
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
	// 실패한 테스트만 한 번 더 돌린다. 노리는 건 부하 높은 머신·공유 러너에서
	// 프레임 예산을 못 맞추거나 준비를 못 끝내는 비결정적 실패다.
	//
	// **가려지는 게 그것뿐은 아니다 — 이 스위트에선 특히 그렇다.** 재시도는
	// 워커 프로세스를 새로 띄우고 실패한 테스트 하나만 다시 돌린다(실측: pid가
	// 바뀌고 모듈 상태가 리셋된다). 그런데 fixtures/app.ts의 `viewerUrl`이
	// `{ scope: "worker" }`라 CLI 서버 프로세스 하나와 그 인프로세스 캐시를
	// **그 픽스처를 소비하는 14개 스펙**이 공유한다(workers: 1이라 사실상 런
	// 전체에 걸쳐 하나). 그래서 **앞선 테스트가 남긴 서버 상태가 있어야 터지는
	// 회귀**는 1차 시도에서 100% 실패하고 새 서버로 도는 재시도에서 100%
	// 통과한다 — 영원히 빨간불이 안 된다. 확률적으로 결국 빨개지는 한계선 성능
	// 회귀보다 엄격히 나쁘다. 가려지는 건 singleFlight 키 오염 같은 **인프로세스
	// 서버 상태 축적** 클래스이고(#54에서 고친 건 그 인스턴스이지 클래스가
	// 아니다 — 그 PR 본문이 isGitRepo·getRepoSummary·getFileBytes가 여전히
	// flight 밖이라고 직접 적는다), 노출되는 스펙은 viewerUrl을 쓰는 14개다.
	// self-heal.e2e.ts는 여기 해당하지 않는다 — 테스트 안에서 launchViewer를
	// 직접 불러 양쪽 시도 모두 새 서버를 받으므로 이 마스킹에 면역이다.
	//
	// 조용히 묻히지는 않는다: 재시도로 통과한 테스트는 flaky로 따로 표시되고,
	// github 리포터가 실패한 시도를 GHA annotation으로 올린다(Checks 탭과 체크
	// 요약에 뜨고, 그 스펙 파일이 마침 diff에 포함된 PR에서만 Files changed에
	// 인라인으로도 보인다). 다만 그건 per-run 가시성이지 비율 집계가 아니다 —
	// .last-run.json은 flaky를 "passed"로 뭉개고(ok()가 flaky를 true로 친다),
	// 런을 가로질러 모아주는 주체가 없다.
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

---
paths:
  - "apps/viewer/e2e/**"
  - "apps/viewer/playwright.config.ts"
---

# e2e (Playwright)

- 스펙 이름은 `*.e2e.ts`다. Playwright는 `*.e2e.ts`만 보고(`testMatch`), `bun test`는 `*.test.ts`와 `*.spec.ts`를 수집한다 — Playwright 관례대로 `*.spec.ts`로 지으면 bun이 그 스펙을 돌린다.
- Playwright는 스펙·fixture·globalSetup을 항상 Node로 실행한다(`bunx playwright test`로 띄워도). `Bun` 전역과 `$`를 쓸 수 없고, bun이 필요하면 `spawn`으로 PATH의 `bun`을 부른다.
- fixtures: `repo.ts`(임시 git 리포 빌더), `app.ts`(`launchViewer` — 실제 `dist/cli.js`를 띄운다, 넷째 인자 `extraEnv`), `proc.ts`(child_process 래퍼), `drag.ts`(합성 드래그 제스처).
- 픽스처에 `git remote add`를 쓰지 않는다. 원격이 생기면 base 해석의 `gh pr view`가 GitHub를 찾느라 스펙마다 수십 초가 걸린다. default 브랜치가 필요하면 `update-ref` + `symbolic-ref`로 원격 HEAD symref만 세운다.
- 실제 `gh`는 쓰지 않는다. PR 관련 스펙은 고정 JSON을 답하는 가짜 `gh`를 `extraEnv`로 PATH 앞에 둔다(`pr-badge.e2e.ts`).
- 프레임 안(rAF 콜백 등)에서 JS로 `scrollTop`을 대입하지 않는다. CI의 Linux 헤드리스 Chrome이 컴포지터 커밋 대기에서 멈출 수 있다. 스크롤은 `page.mouse.wheel`로 한다. JS로 스크롤하는 기존 스펙이 이유 없이 통째로 멈추면 이 기제를 먼저 의심한다.
- 첫 페인트 전부터 DOM 변화를 기록하려면 `addInitScript`에서 MutationObserver를 `document`에 건다(document-start에는 `documentElement`가 없다).
- 계산된 스타일은 `expect.poll`로 읽는다 — 워커 하이라이트가 코드 줄 DOM을 갈아 끼우는 순간 떨어진 요소는 빈 값을 준다.
- 레이아웃 수치는 OS 글꼴에 따라 다르다(macOS와 Linux CI). 폭에 기대는 단언은 그 전제("칩이 아직 최소 폭보다 넓다" 같은)를 함께 단언한다.
- 판별력을 확인한다 — 구현을 되돌렸을 때 그 스펙이 실제로 실패해야 한다. 흔한 빈 통과:
  - "지워지는가"는 값이 한 번 쓰인 뒤 사라지는 전이로 본다. 처음부터 빈 상태로 띄우면 지우는 코드를 없애도 초록이다.
  - 다른 스펙의 부수효과를 회귀망으로 세지 않는다. 그 스펙이 실제로 무엇을 단언하는지 확인한다.
  - 느슨한 하한 대신 정확한 기대값(예: 최종 scrollTop)을 단언한다.
- 스펙 개수와 소요 시간은 문서에 적지 않는다. 개수는 `bunx playwright test --list`가 답한다.

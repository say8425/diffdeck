---
paths:
  - "apps/viewer/fonts/**"
  - "apps/viewer/index.html"
  - "apps/viewer/build.ts"
  - "apps/viewer/e2e/fonts.e2e.ts"
---

# 폰트

UI는 Pretendard, 코드는 JetBrains Mono, 코드 안의 한글은 D2Coding이다. 전부 `apps/viewer/fonts/`에 직접 싣는다(출처·커밋·SHA-256은 `fonts/README.md`). 시스템 폰트에 맡기면 OS마다 화면이 달라지고 레이아웃 e2e의 수치도 macOS와 Linux CI에서 갈린다.

- npm 패키지로 의존하지 않는다(설치 크기가 크다). 필요한 파일만 고정한 출처에서 받아 커밋하고 `fonts/README.md`를 갱신한다.
- JetBrains Mono는 서브셋이 아니라 전체 폰트를 싣는다 — 라틴 서브셋에는 화살표·수학 기호·박스 문자가 없다.
- 엔진(shadow DOM)에는 커스텀 프로퍼티로만 넘긴다: `--diffs-font-family`·`--diffs-header-font-family`·`--trees-font-family-override`. 엔진 코드는 고치지 않는다. 연결이 끊겨도 아무것도 깨지지 않고 시스템 폰트로 떨어지므로, `fonts.e2e.ts`는 계산된 값이 아니라 실제로 로드되고 글리프를 그린 폰트를 확인한다.
- D2Coding의 `unicode-range`는 한글과 원화 기호(`₩`·`￦`)로 좁힌다. 넓히면 한자·가나 한 글자 때문에 한글이 없는 diff에서도 D2Coding 전체를 받는다.
- 한글이 섞인 줄은 고정폭 격자가 어긋난다(라틴 0.6em, 한글 1em). `size-adjust`로 맞추면 한글이 커 보여서 받아들인 차이다.
- 리거처는 끈다(`--diffs-font-features: "calt" 0, "liga" 0`). 줄 안 변경 강조·찾기·grab 범위가 글자 단위로 칠해지기 때문이다.
- Pretendard와 JetBrains Mono 정체는 `<link rel="preload" … crossorigin>`으로 미리 받는다(`crossorigin`이 없으면 @font-face 요청과 캐시 항목이 갈린다). D2Coding은 미리 받지 않는다.
- `font-display: swap`이라 폰트가 도착하면 폭이 바뀐다. 폭을 재서 고정하는 곳(PR 칩의 최소 폭)은 `document.fonts`의 `loadingdone`에서 다시 잰다.
- SIL OFL 1.1이라 라이선스 원문을 함께 배포한다: `build.ts`가 `*.woff2`와 `OFL-*.txt`를 `dist/viewer/fonts/`로 복사한다(`fonts/README.md`는 싣지 않는다). `apps/viewer/NOTICE`와 루트 `NOTICE`에도 고지한다.
- `fonts.e2e.ts`의 "한자만으로는 D2Coding을 부르지 않는다" 스펙의 기준 글자를 바꿀 때는 두 폰트의 cmap을 확인한다(JetBrains Mono에 없고 D2Coding에 있어야 판별력이 있다). 계산된 폰트는 `expect.poll`로 읽는다.

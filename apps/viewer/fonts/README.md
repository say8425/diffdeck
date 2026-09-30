# Vendored fonts

뷰어가 쓰는 폰트 파일이다. **수정하지 않은 원본**이고, npm 패키지에서 필요한
파일만 골라 담았다 — 패키지째 의존성으로 두면 CI가 설치 때마다 수십 MB를 받는다
(`pretendard` 72MB, `d2coding` 37MB tarball). `build.ts`가 `*.woff2`와
`OFL-*.txt`를 `dist/viewer/fonts/`로 복사하고, `index.html`의 `@font-face`가
`fonts/…`로 읽는다. 전부 SIL Open Font License 1.1 — 라이선스 원문은 같은
디렉토리의 `OFL-*.txt`이고 배포물에도 함께 실린다.

| 파일                                                  | 출처                                                     | 역할                       |
| ----------------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| `PretendardVariable.woff2`                            | npm `pretendard@1.3.9` `dist/web/variable/woff2/`        | UI 전체 (굵기 45–920 가변) |
| `jetbrains-mono-latin-wght-{normal,italic}.woff2`     | npm `@fontsource-variable/jetbrains-mono@5.3.0` `files/` | 코드 (라틴)                |
| `jetbrains-mono-latin-ext-wght-{normal,italic}.woff2` | 같은 패키지                                              | 코드 (라틴 확장)           |
| `d2coding-full.woff2`                                 | npm `d2coding@1.3.2` `fonts/` (NAVER D2Coding)           | 코드의 한글 폴백           |
| `OFL-Pretendard.txt`                                  | github.com/orioncactus/pretendard `LICENSE`              |                            |
| `OFL-JetBrainsMono.txt`                               | 위 Fontsource 패키지의 `LICENSE`                         |                            |
| `OFL-D2Coding.txt`                                    | github.com/naver/d2codingfont `OFL.txt`                  |                            |

SHA-256:

```
9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4  PretendardVariable.woff2
18be452724bfdc236c074ca94a249a7f41a86752c7d04ab258ce9ed5651f6a7e  jetbrains-mono-latin-wght-normal.woff2
a8afa085e9ca5e53434e2ee918ba6b65c7dd4dda56509976b36591478c99d62e  jetbrains-mono-latin-wght-italic.woff2
79bfdab9ba467e26eea4122e6f2567e188dd8a09a8c730d501fc487c4ab99c6e  jetbrains-mono-latin-ext-wght-normal.woff2
60652c78382d7e5021ce4c3ed8985fc41d8f3d1b1a3bedcec2a44ed8979fe5eb  jetbrains-mono-latin-ext-wght-italic.woff2
9872851bcbf6807a3133b34213c86a5c5a4fe8eabe300c13b605a30a29cbdc12  d2coding-full.woff2
```

고르지 않은 것과 이유:

- **Pretendard 동적 서브셋(92개 파일)** — 로컬 서버라 한 파일 2MB를 한 번 읽는 편이
  단순하다. 요청 수가 늘 이유가 없다.
- **JetBrains Mono의 키릴·그리스·베트남어 서브셋** — 코드에서 드물다. 없으면 그
  글자만 다음 폴백(시스템 monospace)으로 떨어진다.
- **D2Coding Bold** — 1.6MB를 더 싣는 대신 브라우저의 합성 볼드로 둔다. 한글
  굵은 코드 토큰은 드물다.
- **D2Coding 서브셋판(KS X 1001 2,350자)** — 코드 주석에 드문 음절이 나오면 그
  글자만 모양이 달라진다. 코드 폰트는 완결성이 더 중요해 전체판을 쓴다.

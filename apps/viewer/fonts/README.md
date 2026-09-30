# Vendored fonts

뷰어가 쓰는 폰트 파일이다. **수정하지 않은 원본**이고, 배포처에서 필요한 파일만
골라 담았다 — npm 패키지째 의존성으로 두면 CI가 설치 때마다 수십 MB를 받는다
(`pretendard` 72MB, `d2coding` 37MB tarball). `build.ts`가 `*.woff2`와
`OFL-*.txt`를 `dist/viewer/fonts/`로 복사하고, `index.html`의 `@font-face`가
`fonts/…`로 읽는다. 전부 SIL Open Font License 1.1 — 라이선스 원문은 같은
디렉토리의 `OFL-*.txt`이고 배포물에도 함께 실린다.

| 파일                              | 출처                                                                                       | 역할                           |
| --------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------ |
| `PretendardVariable.woff2`        | npm `pretendard@1.3.9` `dist/web/variable/woff2/`                                          | UI 전체 (굵기 45–930 가변)     |
| `JetBrainsMono-wght.woff2`        | github.com/JetBrains/JetBrainsMono `fonts/webfonts/JetBrainsMono[wght].woff2` @ `02bb50b0` | 코드 (정체, 굵기 100–800 가변) |
| `JetBrainsMono-Italic-wght.woff2` | 같은 커밋의 `fonts/webfonts/JetBrainsMono-Italic[wght].woff2`                              | 코드 (이탤릭)                  |
| `d2coding-full.woff2`             | npm `d2coding@1.3.2` `fonts/` (NAVER D2Coding)                                             | 코드의 한글·원화 기호 폴백     |
| `OFL-Pretendard.txt`              | github.com/orioncactus/pretendard `LICENSE`                                                |                                |
| `OFL-JetBrainsMono.txt`           | 위 JetBrains Mono 커밋의 `OFL.txt`                                                         |                                |
| `OFL-D2Coding.txt`                | github.com/naver/d2codingfont `OFL.txt`                                                    |                                |

JetBrains Mono 커밋 전체: `02bb50b082dad9ef8a0f33ac393839202b760223`.

SHA-256:

```
9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4  PretendardVariable.woff2
31ec365b93e4bad6f202ce23352a56d01ca4462b2afc782ed2cf6fa42ca9ac0e  JetBrainsMono-wght.woff2
76a805b6ea613ce2e3973f1bac6fa29db23116b2881390b59247d22890844ecc  JetBrainsMono-Italic-wght.woff2
9872851bcbf6807a3133b34213c86a5c5a4fe8eabe300c13b605a30a29cbdc12  d2coding-full.woff2
```

고르지 않은 것과 이유:

- **JetBrains Mono의 Fontsource 서브셋** — 한때 이걸 썼는데 서브셋에 화살표(`→ ⇒`)·
  수학 기호(`≠ ≤`)·박스 문자(`─ │`)가 없어 그 글자들이 OS 폰트로 떨어졌다(리뷰 지적 —
  fontTools로 cmap 확인). 공식 가변 폰트 전체는 두 파일 237KB라 서브셋의 이득이
  없다. 가변 woff2는 v2.304 릴리스 zip에 없고(정적 woff2와 가변 TTF뿐) 그 뒤 기본
  브랜치에 추가됐으므로, 직접 변환하지 않고 JetBrains가 만든 파일을 커밋에 고정해
  받았다.
- **Pretendard 동적 서브셋(92개 파일)** — 로컬 서버라 한 파일 2MB를 한 번 읽는 편이
  단순하다. 요청 수가 늘 이유가 없다.
- **D2Coding Bold** — 1.6MB를 더 싣는 대신 브라우저의 합성 볼드로 둔다. 한글
  굵은 코드 토큰은 드물다(pierre-dark 테마엔 굵은 토큰 스코프가 없다).
- **D2Coding 서브셋판(KS X 1001 2,350자)** — 코드 주석에 드문 음절이 나오면 그
  글자만 모양이 달라진다. 코드 폰트는 완결성이 더 중요해 전체판을 쓴다.

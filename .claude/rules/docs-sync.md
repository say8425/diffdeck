---
paths:
  - "apps/viewer/cli.ts"
  - "apps/viewer/cli/**"
  - "apps/viewer/browser/**"
  - "apps/viewer/index.html"
  - "apps/viewer/server/server.ts"
  - "apps/viewer/server/link.ts"
  - "apps/viewer/server/config.ts"
  - "apps/viewer/server/token.ts"
  - "README.md"
  - "apps/viewer/README.md"
  - "docs/README.*.md"
  - "skills/**"
---

# 사용자 문서 동기화

- 사용자에게 보이는 동작(툴바·피커·Grab·기동 출력·옵션·기본 포트·URL 형태)을 바꾸면, 그것을 설명하는 문서를 같은 PR에서 고친다: `README.md`와 번역 4종(`docs/README.{ko,ja,zh,es}.md`), `apps/viewer/README.md`(npm 페이지), `skills/diffdeck/SKILL.md`. 화면이 바뀌면 `docs/`의 스크린샷과 `demo.gif`도 다시 찍는다.
- CLI 표면의 단일 진실은 `cli.ts`의 `HELP`(파싱은 `cli/args.ts`)다. 플래그를 추가·변경·삭제하면 위 일곱 문서를 함께 고친다.
- `docs-flags-parity.test.ts`는 단방향이다. HELP의 플래그가 각 문서에 코드 스팬으로 있는지만 보므로, 플래그를 지우면 문서에 남은 유령 플래그를 잡지 못한다. `install-skill`의 `--codex`·`--project`는 검사 밖이다. 플래그를 나열하는 문서를 새로 만들면 테스트의 `DOCS`에도 넣는다.
- `skills/diffdeck/SKILL.md`는 에이전트가 diffdeck를 구동할 때 읽는 유일한 문서다(`install-skill`이 `~/.claude/skills/`·`~/.agents/skills/`에 배포하고 플러그인이 `skills/`를 스캔한다). 기동 출력, 옵션, `127.0.0.1` 바인딩, grab 클립보드 형식(`grab/encode.ts`)이 바뀌면 함께 고친다.
- README는 영어 `README.md`가 원본이고, 번역 4종은 같은 절과 같은 사실을 담는다. 영어를 고치면 번역도 같은 커밋에서 고친다.

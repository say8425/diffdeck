# diffdeck AI Skill Distribution — 설계

**날짜**: 2026-07-13
**상태**: 설계 (writing-plans 대기)
**저자**: Penguin + Claude (brainstorming)
**선행**: Plan 1-5 완료 — `@say8425/diffdeck` CLI(`bunx`로 뷰어 실행, `--port`/`--no-open`/`--help`/`--version`, `/api/diff` JSON), 배포 준비 완료(미배포, 사용자 게이트).

## 목표

AI 코딩 에이전트(Claude Code, Codex 등)가 **사람을 위해 diffdeck 뷰어를 브라우저에 띄워줄 수 있도록**, diffdeck을 **agent skill**로 배포한다. 에이전트는 이미 Bash로 CLI를 실행할 수 있으므로, skill은 "**언제·어떻게**" diffdeck을 쓰는지 가르치는 지침이다. 하나의 SKILL.md를 **4개 설치 채널**로 배포한다.

## 핵심 통찰 (리서치 검증)

네 채널이 **전부 동일한 Anthropic-포맷 SKILL.md**를 소비한다 — frontmatter `name`+`description` + 마크다운 본문. 이는 cross-vendor "Agent Skills" 오픈 표준([agentskills.io](https://agentskills.io))이며, Codex의 Rust 파서(`codex-rs/core-skills/src/loader.rs`의 `SkillFrontmatter{name, description}`)와 Claude Code 스킬 문서, vercel-labs/skills README로 각각 직접 확인했다. 따라서 **SKILL.md 하나(단일 소스) + 얇은 매니페스트 몇 개**로 4채널을 모두 커버한다.

## 아키텍처: SKILL.md 하나, 설치 채널 넷

### 단일 소스 아티팩트
- **`skills/diffdeck/SKILL.md`** (repo 루트). `name: diffdeck`가 디렉터리명과 일치해야 함(npx skills 요구사항). 이 파일이 4채널 전부를 먹인다.
- `apps/viewer/build.ts`가 이 파일을 `apps/viewer/dist/skills/diffdeck/SKILL.md`로 복사 → npm 패키지(`files:["dist",...]`)에 실려 `diffdeck install-skill`이 런타임에 읽는다.

### 채널별 추가물 (전부 repo 루트, 얇음)

| 채널 | 추가 파일 (repo 루트) | 사용자 설치 명령 |
|---|---|---|
| **① `diffdeck install-skill`** | (없음 — 번들된 SKILL.md 복사) | `diffdeck install-skill` (옵션 `--codex`, `--project`) |
| **② Claude Code 플러그인** | `.claude-plugin/plugin.json` + `.claude-plugin/marketplace.json` | `/plugin marketplace add say8425/diffdeck` → `/plugin install diffdeck@diffdeck` |
| **③ Codex 플러그인** | `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` | `codex plugin marketplace add say8425/diffdeck` → `codex plugin add diffdeck@diffdeck` |
| **④ npx skills** | (없음 — 루트 `skills/diffdeck/`면 자동 발견) | `npx skills add say8425/diffdeck` |

②③의 매니페스트는 루트 `skills/diffdeck/`를 참조 → repo 루트가 곧 단일-플러그인 마켓플레이스(`source: "./"`). ③의 bare-skill 경로(`.agents/skills/diffdeck/`)는 매니페스트 없이도 사용자가 복사/심볼릭하면 동작.

## 컴포넌트 (What)

### 1. `skills/diffdeck/SKILL.md` (단일 소스)
```yaml
---
name: diffdeck
description: >
  Launch the diffdeck local diff viewer in the human's browser to show code
  changes visually. Use when the human asks to see or review a diff, when
  showing what changed before a commit, or when a multi-file change is easier
  to grasp visually than as terminal text.
license: Apache-2.0
---
```
본문(에이전트 지침, 플레인 마크다운 — 모든 에이전트 호환):
- **무엇**: 현재 git repo의 로컬 브라우저 diff 뷰어(파일트리·검색·working/vs-base 모드·이미지 diff).
- **띄우는 법**: 대상 repo에서 `diffdeck`(PATH에 있으면) 또는 `bunx @say8425/diffdeck`를 **백그라운드로** 실행(서버는 중지 전까지 상주). 출력된 URL(`http://127.0.0.1:<port>/?repo=…&token=…`)을 캡처해 사람에게 "뷰어 열었음 + URL" 안내.
- **플래그**: `--port <n>`(기본 49573), `--no-open`(headless/원격 — 브라우저 대신 URL만 출력해 공유), `--help`/`--version`.
- **안 쓸 때**: 한 줄짜리 사소한 변경(그냥 인라인 표시); 사람이 볼 브라우저가 없는 headless 세션.
- **중지**: 프로세스 종료(Ctrl+C/kill); 세션 내 상주함을 명시.

### 2. `apps/viewer/cli/installSkill.ts` (순수 헬퍼 + 설치 동작)
- 순수 함수 `resolveSkillTargets(opts, env): string[]` — 옵션(claude/codex, user/project)에 따라 설치 대상 디렉터리 배열 반환:
  - 기본(Claude user): `<HOME>/.claude/skills/diffdeck`
  - `--codex`(Codex user 추가): `<HOME>/.agents/skills/diffdeck`
  - `--project`: `<cwd>/.claude/skills/diffdeck` (+ `--codex`면 `<cwd>/.agents/skills/diffdeck`)
- 설치 동작 `installSkill(sourceDir, targets)` — 번들된 `${import.meta.dir}/skills/diffdeck/SKILL.md`를 각 대상에 복사(디렉터리 생성, 멱등 덮어쓰기), 설치 경로 출력.

### 3. `apps/viewer/cli.ts` — 서브커맨드 분기
- `process.argv[2] === "install-skill"` → 설치기 실행(나머지 인자 파싱: `--codex`, `--project`).
- 그 외(`diffdeck` 단독 또는 플래그) → 기존 뷰어 실행(변경 없음).

### 4. `apps/viewer/build.ts` — SKILL.md 번들
- 기존 산출(cli.js, viewer/*)에 더해 repo 루트 `../../skills/diffdeck/SKILL.md`를 `dist/skills/diffdeck/SKILL.md`로 복사. `files:["dist",...]`가 이미 커버.

### 5. Claude Code 플러그인 매니페스트 (repo 루트)
- `.claude-plugin/plugin.json`: `{ "name": "diffdeck", "description": "…", "author": {...}, "homepage": "…", "repository": "…" }` — **`version` 생략**(모든 커밋이 새 버전 = 지속 배포; 버전 핀 함정 회피).
- `.claude-plugin/marketplace.json`: `{ "name": "diffdeck", "owner": {"name": "say8425"}, "plugins": [{ "name": "diffdeck", "source": "./" }] }`.
- 스킬은 루트 `skills/diffdeck/SKILL.md`(플러그인 루트 = repo 루트라 플러그인 내부).

### 6. Codex 플러그인 매니페스트 (repo 루트)
- `.codex-plugin/plugin.json`: `{ "name": "diffdeck", "version": "0.1.0", "description": "…", "skills": "./skills/", "author": {...}, "repository": "…" }` — Codex는 semver **`version` 필수**(CC와 비대칭). 릴리스 시 bump.
- `.agents/plugins/marketplace.json`: Codex 마켓플레이스 카탈로그 — plugin 엔트리 `name: diffdeck`, `source`가 repo 루트 플러그인을 가리킴.

### 7. 문서
- README에 "AI agents" 섹션: 4채널 설치 명령 + 스킬이 하는 일.
- `docs/RELEASE`(또는 README): repo public 전환·npm 배포가 ②③④의 선행 조건임을 명시.

## CLI 인터페이스 (신규)

```
diffdeck                      # (기존) 뷰어 실행 + 브라우저 오픈
diffdeck install-skill        # ~/.claude/skills/diffdeck/ 에 스킬 설치
diffdeck install-skill --codex    # + ~/.agents/skills/diffdeck/ (Codex)
diffdeck install-skill --project  # ./.claude/skills/diffdeck/ (프로젝트 스코프)
diffdeck --help               # (기존) install-skill 안내 추가
```

## 선행 조건 (사용자 게이트 — 자동 실행 금지)

- **repo PUBLIC 전환**: ②③④는 GitHub repo가 public이어야 동작(현재 private, `gh repo view`로 확인). **access control 변경은 outward-facing이라 사용자님이 직접**. spec/plan은 이를 "선행 조건"으로 명시만 한다. ①(`install-skill`)은 public 여부 무관하게 동작.
- **npm 배포**: 스킬 본문의 `bunx @say8425/diffdeck`는 배포 선행 필요(기존 게이트). 배포 전엔 로컬(`bun dist/cli.js`)로 동작. 스킬은 "`diffdeck` PATH에 있으면 우선, 없으면 `bunx @say8425/diffdeck`"로 작성해 배포 후 자연 활성.

## 검증 전략

1. **단위**: `resolveSkillTargets`(claude/codex × user/project 조합 → 정확한 경로); 커밋된 4개 매니페스트 JSON이 파싱되고 필수 필드(name 등)를 가지는지 어서션.
2. **통합 스모크**: 빌드 후 임시 HOME으로 `dist/cli.js install-skill` 실행 → `<HOME>/.claude/skills/diffdeck/SKILL.md` 존재 + `name: diffdeck` frontmatter 검증. `--codex` → `.agents/skills/`도.
3. **매니페스트 정합성**: 4채널 매니페스트/디스커버리 경로가 모두 동일한 `skills/diffdeck/SKILL.md`를 가리키는지(드리프트 방지) 테스트.
4. **선택**: `claude` CLI 있으면 `claude plugin validate .`(없으면 skip — 하드 의존 금지).
5. **수동(사용자)**: repo public + npm 배포 후 `npx skills add say8425/diffdeck --list`, `/plugin marketplace add`, `codex plugin marketplace add`로 각 채널 실동작 확인(CI에선 불가라 문서화).
6. **전체 게이트**: `bun run typecheck` EXIT 0, `bun test` green, 뷰어+CLI 빌드 성공.

## 비목표 (Non-goals)

- **MCP 서버** — 에이전트가 이미 CLI를 shell로 실행 가능하므로 과함(YAGNI).
- **에이전트가 `/api/diff` JSON 직접 소비** — 별개 기능("AI가 diff를 읽음" vs 본 스펙 "AI가 사람에게 띄움").
- **skills.sh 수동 등록** — 설치 텔레메트리가 자동 노출.
- **Cursor 등 개별 에이전트 매니페스트** — npx skills가 ~70개 에이전트로 자동 배포/번역.
- **repo를 public으로 자동 전환·자동 npm publish** — 사용자 게이트.
- **엔진(CodeView/trees) 변경** — 스킬은 순수 배포 레이어.

## 불변 제약 (계승)

- vendored 엔진 재작성 금지 — 스킬은 CLI 위에 얹는 배포 레이어일 뿐.
- 외부 deps 정확 버전 핀.
- 라이선스: 스킬 콘텐츠는 diffdeck 자체 저작물 → Apache-2.0(repo와 일치). 매니페스트에 license 명시.
- SKILL.md는 **단일 소스** — 4채널이 복제본이 아니라 같은 파일을 참조/번들.

## 리스크 & 완화

- **repo private → ②③④ 미동작**: spec이 선행 조건으로 명시, ①은 무관하게 동작하도록 설계해 배포 없이도 가치 제공. public 전환 후 나머지 자동 활성.
- **Codex/npx-skills CLI 명령어 churn**(신생 생태계): 문서의 정확한 명령어는 사용자 환경의 `codex plugin --help`/`npx skills --help`로 최종 확인 권장(spec에 명시). 매니페스트 포맷은 실소스로 검증됨.
- **모노레포 캐시 복사**(`/plugin install` 시 repo 소스 캐시로 복사): dist/node_modules는 gitignore라 제외, 소스 수 MB 수준 — 감수. 문제 시 후속에서 플러그인 서브디렉터리 분리.
- **CC는 version 생략(지속)·Codex는 version 필수(비대칭)**: 각 매니페스트 규약대로 작성, 릴리스 시 Codex version만 bump.
- **SKILL.md 드리프트**(4채널이 서로 다른 내용을 갖게 됨): 단일 소스 + 정합성 테스트(검증 3)로 방지.

## 태스크 분해 (개략 — 상세는 writing-plans, TDD)

1. **SKILL.md 저작** + 번들: `skills/diffdeck/SKILL.md`(단일 소스), `build.ts`가 `dist/skills/`로 복사.
2. **`install-skill` CLI**: `resolveSkillTargets` 순수 헬퍼 + 설치 동작 + `cli.ts` 서브커맨드 분기 + 단위/스모크 테스트.
3. **Claude Code 플러그인 매니페스트**: `.claude-plugin/{plugin,marketplace}.json` + 정합성 테스트(+가능 시 `claude plugin validate`).
4. **Codex 플러그인 매니페스트**: `.codex-plugin/plugin.json` + `.agents/plugins/marketplace.json` + 정합성 테스트.
5. **문서 + 선행조건 명시**: README "AI agents" 섹션(4채널 설치), repo-public·npm-publish 선행 조건 기록.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP } from "../cli.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

// cli.ts의 HELP가 CLI 표면의 단일 진실이고, 아래 문서들은 전부 그 표면을
// 사람에게 되풀이해 말한다. 예전엔 SKILL.md 하나만 대조했는데, 그 사이
// `--fold-with-tree`가 npm README(apps/viewer/README.md)와 번역 4종에서
// 조용히 빠져 있었다 — 플래그를 만든 #14은 루트 README와 CLAUDE.md만
// 갱신했고, SKILL.md는 이 테스트를 만든 #24이 뒤늦게 채웠기 때문이다.
// 게이트가 감시하는 문서만 따라잡힌다. 그래서 목록을 전부로 넓혔다.
const DOCS = [
	"skills/diffdeck/SKILL.md",
	"README.md",
	"apps/viewer/README.md",
	"docs/README.ko.md",
	"docs/README.ja.md",
	"docs/README.zh.md",
	"docs/README.es.md",
] as const;

const metaFlags = new Set(["--help", "--version"]);

const extractOptionsFlags = (help: string): string[] => {
	const optionsBlock = help.split("Options:")[1].split(/\n\s*\n/)[0];
	const tokens = optionsBlock.match(/--[a-z][a-z-]*/g) ?? [];
	return [...new Set(tokens)].filter((flag) => !metaFlags.has(flag));
};

/**
 * 문서에서 플래그는 항상 코드 스팬으로 적힌다: `--split` 또는 `--port <n>`.
 * 여는 백틱을 요구해 산문 속 우연한 일치를 막고, 뒤에 백틱이나 공백을 요구해
 * `--tree-right`가 가상의 `--tree-right-foo`에 매칭되지 않게 한다.
 *
 * 이 게이트의 한계를 알고 쓸 것 — 셋 다 실측으로 확인했다:
 * 1. **단방향**이다. HELP의 각 플래그가 문서에 있는지만 본다. 플래그를
 *    삭제하면 문서에 남은 유령 플래그가 그대로 통과한다.
 * 2. **언급**을 증명하지 실제 **위치**를 증명하지 않는다. 표의 행을 지우고
 *    같은 코드 스팬을 산문 한 줄로 옮겨도 통과한다. 그래도 표 문법에
 *    앵커를 걸지 않는 건, 번역 4종의 컬럼 폭이 제각각이고 SKILL.md는
 *    애초에 표가 아니라서다 — 앵커를 걸면 게이트가 먼저 부서진다.
 * 3. `Options:` 블록만 읽는다. `install-skill`의 `--codex`·`--project`는
 *    Commands 섹션이라 이 게이트 밖이다.
 * 무는 곳은 확실히 문다: 번역에서 행 하나를 지우면 그 문서만 빨간불이 되고,
 * HELP에 새 플래그를 넣으면 일곱 문서가 한꺼번에 빨간불이 된다.
 */
const documents = (content: string, flag: string): boolean =>
	new RegExp(`\`${flag}[\`\\s]`).test(content);

describe("CLI flag parity between cli.ts HELP and every doc that lists flags", () => {
	const flags = extractOptionsFlags(HELP);

	test("HELP's Options block has flags to check", () => {
		expect(flags.length).toBeGreaterThan(0);
	});

	test("HELP's Options block excludes meta-flags --help/--version", () => {
		expect(flags).not.toContain("--help");
		expect(flags).not.toContain("--version");
	});

	// 파일 읽기는 test 콜백 **안**에서 한다. describe 본문에서 읽으면 경로가
	// 하나만 틀려도 테스트가 등록되기 전에 throw해서, "문서 X가 없다"가 아니라
	// 정체불명의 수집 크래시로 보인다 — 위 가드 두 개조차 돌지 않는다.
	for (const doc of DOCS) {
		for (const flag of flags) {
			test(`${doc} documents ${flag}`, () => {
				const content = readFileSync(join(repoRoot, doc), "utf8");
				expect(documents(content, flag)).toBe(true);
			});
		}
	}
});

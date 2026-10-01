import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP } from "../cli.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

// 플래그를 나열하는 문서는 전부 여기 둔다 — 감시하지 않는 문서는 조용히 뒤처진다(docs-sync.md).
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

// 플래그는 코드 스팬(`--split`, `--port <n>`)으로 적힌다. 여는 백틱은 산문 속
// 우연한 일치를, 뒤의 백틱·공백은 `--tree-right`가 `--tree-right-foo`에 걸리는
// 것을 막는다. 표 문법에는 앵커를 걸지 않아(번역마다 컬럼 폭이 다르고
// SKILL.md는 표가 아니다) 위치가 아니라 언급만 증명한다. 다른 한계는
// docs-sync.md에 있다.
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

	// 파일은 test 콜백 안에서 읽는다 — describe 본문에서 읽으면 경로 하나만
	// 틀려도 수집 단계에서 통째로 터진다.
	for (const doc of DOCS) {
		for (const flag of flags) {
			test(`${doc} documents ${flag}`, () => {
				const content = readFileSync(join(repoRoot, doc), "utf8");
				expect(documents(content, flag)).toBe(true);
			});
		}
	}
});

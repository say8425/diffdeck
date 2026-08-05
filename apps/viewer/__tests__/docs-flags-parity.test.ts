import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HELP } from "../cli.ts";

const repoRoot = join(import.meta.dir, "..", "..", "..");

// cli.ts의 HELP가 CLI 표면의 단일 진실이고, 아래 문서들은 전부 그 표면을
// 사람에게 되풀이해 말한다. 예전엔 SKILL.md 하나만 대조했는데, 그 사이
// `--fold-with-tree`가 npm README(apps/viewer/README.md)와 번역 4종에서
// 조용히 빠져 있었다 — 플래그가 생긴 #14이 루트 README와 SKILL.md만
// 갱신했기 때문이다. 게이트가 한 문서만 보면 나머지는 아무도 지키지 않는다.
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

	for (const doc of DOCS) {
		const content = readFileSync(join(repoRoot, doc), "utf8");
		for (const flag of flags) {
			test(`${doc} documents ${flag}`, () => {
				expect(documents(content, flag)).toBe(true);
			});
		}
	}
});

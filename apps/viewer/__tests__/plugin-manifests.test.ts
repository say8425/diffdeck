import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const readJson = (rel: string) =>
	JSON.parse(readFileSync(join(root, rel), "utf8"));

describe("plugin manifests", () => {
	test("the shared skill file exists (single source every channel points at)", () => {
		expect(existsSync(join(root, "skills", "diffdeck", "SKILL.md"))).toBe(true);
	});

	test("Claude Code plugin.json: name diffdeck, semver version (release-please synced)", () => {
		// 과거엔 무버전(continuous)이 불변조건이었으나, codex 매니페스트와의
		// 비대칭을 없애기 위해 release-please extra-files로 버전을 동기화한다.
		const p = readJson(".claude-plugin/plugin.json");
		expect(p.name).toBe("diffdeck");
		expect(/^\d+\.\d+\.\d+$/.test(p.version)).toBe(true);
	});

	test("Claude Code marketplace.json: lists the diffdeck plugin at source ./", () => {
		const m = readJson(".claude-plugin/marketplace.json");
		expect(m.name).toBe("diffdeck");
		expect(m.owner?.name).toBeTruthy();
		expect(m.plugins).toEqual([
			expect.objectContaining({ name: "diffdeck", source: "./" }),
		]);
	});

	test("Codex plugin.json: name diffdeck, semver version, skills → ./skills/", () => {
		const p = readJson(".codex-plugin/plugin.json");
		expect(p.name).toBe("diffdeck");
		expect(/^\d+\.\d+\.\d+$/.test(p.version)).toBe(true);
		expect(p.skills).toBe("./skills/");
	});

	test("Codex marketplace.json: local source pointing at the repo root plugin", () => {
		const m = readJson(".agents/plugins/marketplace.json");
		expect(m.name).toBe("diffdeck");
		expect(m.plugins?.[0]?.name).toBe("diffdeck");
		expect(m.plugins?.[0]?.source).toEqual({ source: "local", path: "./" });
	});
});

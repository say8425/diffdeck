# diffdeck AI Skill Distribution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Distribute diffdeck as an agent skill so AI coding agents can launch the diffdeck viewer in the human's browser — one `skills/diffdeck/SKILL.md` served through four install channels (`diffdeck install-skill`, Claude Code plugin, Codex plugin, `npx skills`).

**Architecture:** A single canonical `skills/diffdeck/SKILL.md` at the repo root is the source of truth for all channels. `build.ts` copies it into `dist/skills/` so the published npm package's `install-skill` subcommand can write it into a user's Claude Code / Codex skills dir. Thin plugin manifests at the repo root (`.claude-plugin/`, `.codex-plugin/`, `.agents/plugins/`) make the repo its own single-plugin marketplace; `npx skills` needs only the root `skills/` dir. Every channel references the same SKILL.md — no per-channel content.

**Tech Stack:** Bun (runtime + bundler + test), TypeScript 6, oxlint/oxfmt. Static JSON manifests + one Markdown skill file.

## Global Constraints

- **Single source of truth:** exactly one skill file, `skills/diffdeck/SKILL.md` (repo root). Its frontmatter `name` MUST be `diffdeck` and MUST match the directory name (npx skills requirement). No channel gets its own copy of the content — build-time bundling and plugin manifests all point at this one file.
- **Skill content is agent-agnostic plain Markdown** (works across Claude Code, Codex, Cursor, etc.) — no agent-specific tool calls in the body.
- Manifests live at the **repo root** (`source: "./"` — repo = single-plugin marketplace). Do not create a plugin subdirectory.
- Claude Code plugin manifest **omits `version`** (continuous delivery — every commit is a new version). Codex plugin manifest **requires semver `version`** (`0.1.0`, bump on release) — this asymmetry is intentional.
- License of the skill content is **Apache-2.0** (matches the repo); declare it in the SKILL.md frontmatter and the manifests.
- **Do NOT run `bun install`.** Verification gate for every task: `bun run typecheck` (repo root) EXIT 0 and the task's tests green.
- Edits are in `apps/viewer/**`, repo-root `skills/`, repo-root dotfile manifests, `README.md` — all repo-formatted (tabs) / static files; the Edit/Write tools are fine.
- **HARD GATES (out of scope — never do these):** making the GitHub repo public (channels ②③④ need it; user's outward-facing decision), running `npm publish`, and any cc-statusline cutover. The plan only prepares the artifacts.
- Do not touch the engine (`packages/**` CodeView/trees) — this is a pure distribution layer over the existing CLI.

## File Structure

Created:
- `skills/diffdeck/SKILL.md` — the single-source agent skill.
- `apps/viewer/cli/installSkill.ts` — `parseInstallArgs`, `resolveSkillTargets` (pure), `installSkillTo`.
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` — Claude Code plugin + marketplace.
- `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json` — Codex plugin + marketplace.
- `apps/viewer/__tests__/skill-source.test.ts`, `cli-install-skill.test.ts`, `plugin-manifests.test.ts`.

Modified:
- `apps/viewer/build.ts` — copy `skills/diffdeck/SKILL.md` → `dist/skills/diffdeck/SKILL.md`.
- `apps/viewer/cli.ts` — `install-skill` subcommand dispatch + `--help` text.
- `README.md` — "AI agents" install section + prerequisites.

---

### Task 1: Single-source SKILL.md + build bundle

**Files:**
- Create: `skills/diffdeck/SKILL.md`
- Modify: `apps/viewer/build.ts`
- Test: `apps/viewer/__tests__/skill-source.test.ts`

**Interfaces:**
- Produces: `skills/diffdeck/SKILL.md` (frontmatter `name: diffdeck`, `description`, `license: Apache-2.0`); `dist/skills/diffdeck/SKILL.md` (build output the CLI's `install-skill` reads at `${import.meta.dir}/skills/diffdeck/SKILL.md`).

- [ ] **Step 1: Write the failing test**

Create `apps/viewer/__tests__/skill-source.test.ts`. It pins the single-source SKILL.md's location and required frontmatter, and (after building) that the bundle carries it.
```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const skillPath = join(repoRoot, "skills", "diffdeck", "SKILL.md");
const distSkillPath = join(
	import.meta.dir,
	"..",
	"dist",
	"skills",
	"diffdeck",
	"SKILL.md",
);

describe("diffdeck skill source", () => {
	test("skills/diffdeck/SKILL.md exists with name: diffdeck frontmatter", () => {
		expect(existsSync(skillPath)).toBe(true);
		const text = readFileSync(skillPath, "utf8");
		expect(text.startsWith("---")).toBe(true);
		expect(/^name:\s*diffdeck\s*$/m.test(text)).toBe(true);
		expect(/^description:\s*\S/m.test(text)).toBe(true);
	});
});

describe("skill is bundled into dist", () => {
	beforeAll(async () => {
		const proc = Bun.spawn(
			["bun", "run", join(import.meta.dir, "..", "build.ts")],
			{ stdout: "pipe", stderr: "pipe" },
		);
		if ((await proc.exited) !== 0) throw new Error("build.ts failed");
	});
	afterAll(() => {});

	test("build copies SKILL.md to dist/skills/diffdeck/SKILL.md", () => {
		expect(existsSync(distSkillPath)).toBe(true);
		expect(readFileSync(distSkillPath, "utf8")).toContain("name: diffdeck");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/skill-source.test.ts`
Expected: FAIL — `skills/diffdeck/SKILL.md` does not exist yet.

- [ ] **Step 3: Write `skills/diffdeck/SKILL.md`**

Create `skills/diffdeck/SKILL.md` (repo root) with exactly this content:
```markdown
---
name: diffdeck
description: Launch the diffdeck local diff viewer in the human's browser to show code changes visually. Use when the human asks to see or review a diff, when showing what changed before a commit, or when a multi-file change is easier to understand visually than as terminal text.
license: Apache-2.0
---

# diffdeck — show the human a visual diff

diffdeck runs a local web server that renders the current git repository's diff
(working-tree changes, or a branch vs its base) in the browser: a file tree with
git-status badges, unified/split views, in-app search, image diffs, and live
watch. Use it to let the **human** see changes visually instead of reading raw
diff text in the terminal.

## When to use

- The human asks to "see the diff", "show me the changes", or "open the diff viewer".
- You just made a multi-file change and a visual review would help the human.
- Before a commit, to let the human eyeball what will be committed.

## When NOT to use

- A tiny, single-line change — just show it inline.
- A headless/CI context where the human has no browser to look at (or use
  `--no-open` and share the URL for them to open later).

## How to launch

Run diffdeck in the repository you want to show, **in the background** (the
server stays up until stopped), then tell the human it is open and give them the
URL. Prefer a globally-installed `diffdeck`; otherwise use `bunx @say8425/diffdeck`:

```bash
# from inside the target git repo, run in the background:
diffdeck            # or: bunx @say8425/diffdeck
```

It prints:

```
diffdeck viewer running at:
http://127.0.0.1:49573/?repo=<repo>&token=<token>
Press Ctrl+C to stop.
```

Capture that URL and tell the human, e.g. "Opened the diff viewer for you:
http://127.0.0.1:49573/?repo=…&token=… — it shows the current changes." The
browser opens automatically for the human. If you are running somewhere the
human's browser can't be reached (remote/headless), add `--no-open` and just
share the printed URL.

## Options

- `--port <n>` — serve on a specific port (default 49573, or `$DIFFDECK_PORT`).
- `--no-open` — don't open a browser; print the URL to share.

## Stopping

The server keeps running (across your session) until the process is stopped
(Ctrl+C, or kill the background process). Leave it running while the human is
looking; stop it when they are done.
```

- [ ] **Step 4: Copy the skill into the bundle in `build.ts`**

In `apps/viewer/build.ts`, after the `index.html` write (after line 38) and before the final `console.log`, add:
```typescript
await Bun.write(
	`${dist}/skills/diffdeck/SKILL.md`,
	Bun.file(`${import.meta.dir}/../../skills/diffdeck/SKILL.md`),
);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/skill-source.test.ts`
Expected: PASS (both describes).

- [ ] **Step 6: Typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun run typecheck`
Expected: EXIT 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add skills/diffdeck/SKILL.md apps/viewer/build.ts apps/viewer/__tests__/skill-source.test.ts
git commit -m "feat: add diffdeck agent skill (single source) + bundle into dist"
```

---

### Task 2: `install-skill` CLI subcommand

**Files:**
- Create: `apps/viewer/cli/installSkill.ts`
- Modify: `apps/viewer/cli.ts`
- Test: `apps/viewer/__tests__/cli-install-skill.test.ts`

**Interfaces:**
- Consumes: `dist/skills/diffdeck/SKILL.md` (Task 1).
- Produces:
  - `interface InstallSkillOptions { codex: boolean; project: boolean }`
  - `parseInstallArgs(argv: string[]): InstallSkillOptions`
  - `resolveSkillTargets(opts: InstallSkillOptions, env?: Record<string,string|undefined>, cwd?: string): string[]` — returns absolute target directories. Default: `<HOME>/.claude/skills/diffdeck`. `--codex` appends `<HOME>/.agents/skills/diffdeck`. `--project` uses `<cwd>` as base instead of `<HOME>`.
  - `installSkillTo(sourceFile: string, targets: string[]): void` — creates each dir and copies `SKILL.md` into it.

- [ ] **Step 1: Write the failing unit test**

Create `apps/viewer/__tests__/cli-install-skill.test.ts`:
```typescript
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "../cli/installSkill.ts";

describe("parseInstallArgs", () => {
	test("defaults: no codex, no project", () => {
		expect(parseInstallArgs([])).toEqual({ codex: false, project: false });
	});
	test("--codex and --project flags", () => {
		expect(parseInstallArgs(["--codex", "--project"])).toEqual({
			codex: true,
			project: true,
		});
	});
});

describe("resolveSkillTargets", () => {
	const env = { HOME: "/home/x" };
	test("default → Claude Code user skills dir", () => {
		expect(resolveSkillTargets({ codex: false, project: false }, env, "/cwd")).toEqual([
			"/home/x/.claude/skills/diffdeck",
		]);
	});
	test("--codex appends Codex user skills dir", () => {
		expect(resolveSkillTargets({ codex: true, project: false }, env, "/cwd")).toEqual([
			"/home/x/.claude/skills/diffdeck",
			"/home/x/.agents/skills/diffdeck",
		]);
	});
	test("--project uses cwd as base", () => {
		expect(resolveSkillTargets({ codex: true, project: true }, env, "/cwd")).toEqual([
			"/cwd/.claude/skills/diffdeck",
			"/cwd/.agents/skills/diffdeck",
		]);
	});
});

describe("installSkillTo", () => {
	let tmp: string;
	beforeAll(() => {
		tmp = mkdtempSync(join(tmpdir(), "dd-install-"));
	});
	afterAll(() => {
		rmSync(tmp, { recursive: true, force: true });
	});
	test("copies SKILL.md into each target dir (creating dirs)", () => {
		const src = join(tmp, "src-SKILL.md");
		Bun.write(src, "---\nname: diffdeck\n---\nbody");
		const a = join(tmp, "a", "diffdeck");
		const b = join(tmp, "b", "diffdeck");
		installSkillTo(src, [a, b]);
		expect(existsSync(join(a, "SKILL.md"))).toBe(true);
		expect(readFileSync(join(b, "SKILL.md"), "utf8")).toContain("name: diffdeck");
	});
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-install-skill.test.ts`
Expected: FAIL — `../cli/installSkill.ts` does not exist.

- [ ] **Step 3: Implement `installSkill.ts`**

Create `apps/viewer/cli/installSkill.ts`:
```typescript
import { cpSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type Env = Record<string, string | undefined>;

export interface InstallSkillOptions {
	codex: boolean;
	project: boolean;
}

export const parseInstallArgs = (argv: string[]): InstallSkillOptions => ({
	codex: argv.includes("--codex"),
	project: argv.includes("--project"),
});

// Target directories the skill is written into. Claude Code reads
// <base>/.claude/skills/<name>/; Codex reads <base>/.agents/skills/<name>/.
// base = cwd for --project (repo-local), else HOME (user-global).
export const resolveSkillTargets = (
	opts: InstallSkillOptions,
	env: Env = process.env,
	cwd: string = process.cwd(),
): string[] => {
	const base = opts.project ? cwd : env.HOME || homedir();
	const targets = [join(base, ".claude", "skills", "diffdeck")];
	if (opts.codex) targets.push(join(base, ".agents", "skills", "diffdeck"));
	return targets;
};

export const installSkillTo = (sourceFile: string, targets: string[]): void => {
	for (const dir of targets) {
		mkdirSync(dir, { recursive: true });
		cpSync(sourceFile, join(dir, "SKILL.md"));
	}
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-install-skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the subcommand into `cli.ts`**

In `apps/viewer/cli.ts`, add the import (after line 2):
```typescript
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "./cli/installSkill.ts";
```
Extend the `HELP` string to document the subcommand — replace the `Usage:` block and add a Commands section:
```typescript
const HELP = `diffdeck — local git diff viewer

Usage:
  bunx @say8425/diffdeck [options]
  bunx @say8425/diffdeck install-skill [--codex] [--project]

Commands:
  install-skill  Install the diffdeck agent skill so an AI agent can open the
                 viewer for you. Writes ~/.claude/skills/diffdeck/ (add --codex
                 for ~/.agents/skills/, --project for the current repo).

Options:
  --port <n>    Port to serve on (default: $DIFFDECK_PORT or 49573)
  --no-open     Do not open a browser automatically
  -h, --help    Show this help
  -v, --version Show version

Runs a local diff viewer for the git repository in the current directory.
Press Ctrl+C to stop.`;
```
Add the dispatch at the very top of `main()` (before `const args = parseArgs(...)`):
```typescript
	if (process.argv[2] === "install-skill") {
		const opts = parseInstallArgs(process.argv.slice(3));
		const source = `${import.meta.dir}/skills/diffdeck/SKILL.md`;
		const targets = resolveSkillTargets(opts);
		installSkillTo(source, targets);
		for (const dir of targets) {
			console.log(`installed diffdeck skill → ${dir}/SKILL.md`);
		}
		process.exit(0);
	}
```

- [ ] **Step 6: Write the integration smoke test**

Append to `apps/viewer/__tests__/cli-install-skill.test.ts`:
```typescript
describe("packaged cli.js install-skill", () => {
	let home: string;
	beforeAll(async () => {
		const build = Bun.spawn(
			["bun", "run", join(import.meta.dir, "..", "build.ts")],
			{ stdout: "pipe", stderr: "pipe" },
		);
		if ((await build.exited) !== 0) throw new Error("build.ts failed");
		home = mkdtempSync(join(tmpdir(), "dd-skill-home-"));
	});
	afterAll(() => {
		rmSync(home, { recursive: true, force: true });
	});
	test("writes the bundled SKILL.md into <HOME>/.claude/skills/diffdeck", async () => {
		const cli = join(import.meta.dir, "..", "dist", "cli.js");
		const proc = Bun.spawn(["bun", cli, "install-skill"], {
			env: { ...process.env, HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(await proc.exited).toBe(0);
		const installed = join(home, ".claude", "skills", "diffdeck", "SKILL.md");
		expect(existsSync(installed)).toBe(true);
		expect(readFileSync(installed, "utf8")).toContain("name: diffdeck");
	});
});
```

- [ ] **Step 7: Run the full install-skill test + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/cli-install-skill.test.ts && bun run typecheck`
Expected: all PASS; typecheck EXIT 0.

- [ ] **Step 8: Manually smoke the help + a real install to a temp HOME**

Run: `cd /Users/penguin/dev/diffdeck && bun run apps/viewer/build.ts >/dev/null && bun apps/viewer/dist/cli.js --help | grep -A1 install-skill && HOME=$(mktemp -d) bun apps/viewer/dist/cli.js install-skill`
Expected: help shows `install-skill`; the install prints `installed diffdeck skill → …/.claude/skills/diffdeck/SKILL.md`.

- [ ] **Step 9: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add apps/viewer/cli/installSkill.ts apps/viewer/cli.ts apps/viewer/__tests__/cli-install-skill.test.ts
git commit -m "feat(cli): diffdeck install-skill subcommand (Claude Code + Codex, user/project)"
```

---

### Task 3: Plugin manifests (Claude Code + Codex) + cross-channel consistency test

**Files:**
- Create: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, `.agents/plugins/marketplace.json`
- Test: `apps/viewer/__tests__/plugin-manifests.test.ts`

**Interfaces:**
- Consumes: `skills/diffdeck/SKILL.md` (all manifests reference the root `skills/` dir).
- Produces: the four static manifests that make the repo a single-plugin marketplace for Claude Code and Codex.

- [ ] **Step 1: Write the failing consistency test**

Create `apps/viewer/__tests__/plugin-manifests.test.ts`. It parses all four manifests, checks required fields, and asserts every channel points at the one shared `skills/diffdeck/SKILL.md`.
```typescript
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const readJson = (rel: string) => JSON.parse(readFileSync(join(root, rel), "utf8"));

describe("plugin manifests", () => {
	test("the shared skill file exists (single source every channel points at)", () => {
		expect(existsSync(join(root, "skills", "diffdeck", "SKILL.md"))).toBe(true);
	});

	test("Claude Code plugin.json: name diffdeck, no version (continuous)", () => {
		const p = readJson(".claude-plugin/plugin.json");
		expect(p.name).toBe("diffdeck");
		expect(p.version).toBeUndefined();
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/plugin-manifests.test.ts`
Expected: FAIL — manifests do not exist.

- [ ] **Step 3: Create the Claude Code manifests**

`.claude-plugin/plugin.json` (no `version` — continuous delivery):
```json
{
	"name": "diffdeck",
	"description": "Launch the diffdeck local diff viewer in the browser to show code changes visually to the human.",
	"author": { "name": "say8425", "url": "https://github.com/say8425" },
	"homepage": "https://github.com/say8425/diffdeck",
	"repository": "https://github.com/say8425/diffdeck"
}
```
`.claude-plugin/marketplace.json`:
```json
{
	"name": "diffdeck",
	"owner": { "name": "say8425", "url": "https://github.com/say8425" },
	"plugins": [
		{
			"name": "diffdeck",
			"source": "./",
			"description": "diffdeck diff-viewer skill — lets an AI agent open the diff viewer for you."
		}
	]
}
```

- [ ] **Step 4: Create the Codex manifests**

`.codex-plugin/plugin.json` (schema verified against `openai/plugins/plugins/figma/.codex-plugin/plugin.json`):
```json
{
	"name": "diffdeck",
	"version": "0.1.0",
	"description": "Launch the diffdeck local diff viewer in the browser to show code changes visually to the human.",
	"author": { "name": "say8425", "url": "https://github.com/say8425" },
	"homepage": "https://github.com/say8425/diffdeck",
	"repository": "https://github.com/say8425/diffdeck",
	"license": "Apache-2.0",
	"keywords": ["diff", "viewer", "git", "code-review"],
	"skills": "./skills/",
	"interface": {
		"displayName": "diffdeck",
		"shortDescription": "Local diff viewer an AI agent can open for you",
		"category": "Developer Tools"
	}
}
```
`.agents/plugins/marketplace.json` (schema verified against `openai/plugins/.agents/plugins/marketplace.json`):
```json
{
	"name": "diffdeck",
	"plugins": [
		{
			"name": "diffdeck",
			"source": { "source": "local", "path": "./" },
			"policy": { "installation": "AVAILABLE" },
			"category": "Developer Tools"
		}
	]
}
```

> Implementer note: the Codex `policy.authentication` field is omitted because the diffdeck skill ships no MCP server / credentials. If a later real-Codex check (`codex plugin --help` / `codex plugin marketplace add`) reports a required `authentication` value, add it then — do not block this task on it; the consistency test validates structure, and real-Codex install is a post-publish user step (repo must be public first).

- [ ] **Step 5: Run the consistency test + typecheck**

Run: `cd /Users/penguin/dev/diffdeck && bun test apps/viewer/__tests__/plugin-manifests.test.ts && bun run typecheck`
Expected: all PASS; typecheck EXIT 0.

- [ ] **Step 6: Validate the Claude Code plugin if the CLI is available (best-effort)**

Run: `cd /Users/penguin/dev/diffdeck && (command -v claude >/dev/null && claude plugin validate . 2>&1 | tail -5 || echo "claude CLI not available — skipping plugin validate")`
Expected: either a clean validation summary, or the skip message. If `claude plugin validate` reports concrete errors in the diffdeck manifests, fix them; do not fail the task if the `claude` CLI is simply absent.

- [ ] **Step 7: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add .claude-plugin .codex-plugin .agents apps/viewer/__tests__/plugin-manifests.test.ts
git commit -m "feat: Claude Code + Codex plugin manifests (repo as single-plugin marketplace)"
```

---

### Task 4: README "AI agents" section + prerequisites

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the four channels from Tasks 1-3. Produces: user-facing install docs.

- [ ] **Step 1: Check the current README structure**

Run: `cd /Users/penguin/dev/diffdeck && grep -n "^## " README.md`
Note where the `## CLI` and `## Publishing` sections are so the new section is appended coherently (after `## CLI`).

- [ ] **Step 2: Add the "AI agents" section to `README.md`**

Insert this section after the `## CLI` section:
```markdown
## AI agents

diffdeck ships an **agent skill** so an AI coding agent (Claude Code, Codex, …)
can open the diff viewer in your browser when a change is easier to see than to
read. The skill just teaches the agent when and how to run the diffdeck CLI.

Install it through any of these channels (all use the same
`skills/diffdeck/SKILL.md`):

```bash
# 1. Self-contained (needs diffdeck installed): writes ~/.claude/skills/diffdeck/
diffdeck install-skill              # add --codex for ~/.agents/skills/, --project for this repo

# 2. Claude Code plugin
#    /plugin marketplace add say8425/diffdeck
#    /plugin install diffdeck@diffdeck

# 3. Codex plugin
#    codex plugin marketplace add say8425/diffdeck
#    codex plugin add diffdeck@diffdeck

# 4. npx skills (any supported agent)
npx skills add say8425/diffdeck
```

Channels 2–4 fetch from GitHub, so they require the repository to be **public**
and diffdeck to be **published to npm** (for the skill's `bunx @say8425/diffdeck`
to resolve). Channel 1 works from any local install. The exact `codex` / `npx
skills` subcommands are young and may vary by version — check
`codex plugin --help` / `npx skills --help` against your installed version.
```

- [ ] **Step 3: Verify the section renders (no broken fences) + oxfmt**

Run: `cd /Users/penguin/dev/diffdeck && grep -c '^```' README.md && bunx oxfmt README.md && git diff --stat README.md`
Expected: an even count of code-fence markers; oxfmt leaves content intact (table/prose only reflowed).

- [ ] **Step 4: Full suite + typecheck (final regression gate)**

Run: `cd /Users/penguin/dev/diffdeck && bun run typecheck && bun test 2>&1 | tail -4`
Expected: typecheck EXIT 0; full suite green.

- [ ] **Step 5: Commit**

```bash
cd /Users/penguin/dev/diffdeck
git add README.md
git commit -m "docs: AI agents skill install section (four channels + prerequisites)"
```

---

## Self-Review

**1. Spec coverage** (against `docs/superpowers/specs/2026-07-13-diffdeck-ai-skill-distribution-design.md`):
- Single-source `skills/diffdeck/SKILL.md` + build bundle → Task 1. ✅
- `diffdeck install-skill` (`--codex`/`--project`) → Task 2. ✅
- Claude Code + Codex plugin manifests at repo root (`source: "./"`, CC no-version, Codex semver) → Task 3 (spec tasks 3+4 merged — both are static JSON validated by one cross-channel consistency test). ✅
- npx skills → needs only root `skills/diffdeck/` (Task 1) + public repo (prerequisite); no code. Documented in Task 4. ✅
- README "AI agents" + prerequisites → Task 4. ✅
- Prerequisites (repo public, npm publish) as HARD GATES → Global Constraints + Task 4 docs. ✅
- Non-goals (MCP, /api/diff, auto-public) → not built. ✅

**2. Placeholder scan:** No TBD/"handle edge cases"/uncoded steps — every code step carries complete file content. The Codex `authentication` uncertainty is called out explicitly with a bounded resolution (implementer note in Task 3 Step 4), not a placeholder.

**3. Type consistency:** `InstallSkillOptions`/`parseInstallArgs`/`resolveSkillTargets`/`installSkillTo` signatures match between Task 2's definition and its cli.ts usage. `resolveSkillTargets` path outputs (`.claude/skills/diffdeck`, `.agents/skills/diffdeck`) match the manifests' `skills/diffdeck/` and the SKILL.md dir name `diffdeck` (Task 1) consistently. Build output path `dist/skills/diffdeck/SKILL.md` (Task 1) matches the `${import.meta.dir}/skills/diffdeck/SKILL.md` the CLI reads (Task 2).

**Edge notes for the executor:**
- Tasks 2's smoke test and Task 1's build test both run `bun run build.ts`; that is fine (idempotent) but keep them from running in parallel against the same `dist/` is handled by bun's default per-file test isolation within one `bun test` invocation running serially by file — if a race appears, run the two files separately.
- Real Codex/npx-skills/plugin installation cannot run in CI (needs a public repo + those tools); those are user-verified post-publish, as the spec records.

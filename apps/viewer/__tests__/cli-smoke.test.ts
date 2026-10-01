import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const cliPath = join(import.meta.dir, "..", "dist", "cli.js");

let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
let repo: string;
let cacheHome: string;
let baseUrl: string;
let port: number;
let token: string;

const readUrlFromStdout = async (
	stream: ReadableStream<Uint8Array>,
): Promise<string> => {
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of stream) {
		buffer += decoder.decode(chunk, { stream: true });
		const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+\/\?\S+/);
		if (match) return match[0];
	}
	throw new Error(`CLI did not print a viewer URL. stdout so far:\n${buffer}`);
};

beforeAll(async () => {
	const build = Bun.spawn(
		["bun", "run", join(import.meta.dir, "..", "build.ts")],
		{ stdout: "pipe", stderr: "pipe" },
	);
	if ((await build.exited) !== 0) throw new Error("build.ts failed");

	repo = mkdtempSync(join(tmpdir(), "dd-cli-repo-"));
	await $`git -C ${repo} init -q`;
	await $`git -C ${repo} config user.email t@t.co`;
	await $`git -C ${repo} config user.name test`;
	writeFileSync(join(repo, "a.txt"), "one\n");
	await $`git -C ${repo} add a.txt`;
	await $`git -C ${repo} commit -qm init`;
	writeFileSync(join(repo, "a.txt"), "two\n");

	cacheHome = mkdtempSync(join(tmpdir(), "dd-cli-cache-"));
	proc = Bun.spawn(["bun", cliPath, "--no-open", "--port", "0"], {
		cwd: repo,
		env: { ...process.env, XDG_CACHE_HOME: cacheHome },
		stdout: "pipe",
		stderr: "pipe",
	});

	const url = await readUrlFromStdout(proc.stdout);
	const parsed = new URL(url);
	port = Number(parsed.port);
	token = parsed.searchParams.get("token") ?? "";
	baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(() => {
	proc?.kill("SIGINT");
	for (const d of [repo, cacheHome])
		if (d) rmSync(d, { recursive: true, force: true });
});

describe("packaged cli.js", () => {
	// 공유 proc을 마지막에 SIGINT로 끝내므로 단계들을 한 test에 묶는다 — 쪼개면 선언 순서 실행에 기대게 된다.
	test("the shared CLI process: tokened URL, executable shebang, ping/shell/diff endpoints, then clean SIGINT shutdown", async () => {
		expect(token.length).toBeGreaterThan(0);

		const contents = readFileSync(cliPath, "utf8");
		expect(contents.startsWith("#!/usr/bin/env bun\n")).toBe(true);
		expect(contents.split("\n")[1]).toContain("@bun");
		expect(statSync(cliPath).mode & 0o100).toBe(0o100);

		const ping = await fetch(`${baseUrl}/api/ping`);
		expect(ping.status).toBe(204);
		expect(ping.headers.get("x-diffdeck")).toBe("1");

		const shell = await fetch(`${baseUrl}/`);
		expect(shell.status).toBe(200);
		expect(await shell.text()).toContain("/main.js");

		const diff = await fetch(
			`${baseUrl}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(diff.status).toBe(200);
		const files = (await diff.json()) as Array<{ name: string }>;
		expect(files.some((f) => f.name === "a.txt")).toBe(true);

		proc.kill("SIGINT");
		expect(await proc.exited).toBe(0);
	});

	test("view flags appear in the printed URL", async () => {
		const flagsRepo = mkdtempSync(join(tmpdir(), "dd-flags-repo-"));
		await $`git -C ${flagsRepo} init -q`;
		const flagsCache = mkdtempSync(join(tmpdir(), "dd-flags-cache-"));
		const p = Bun.spawn(
			[
				"bun",
				cliPath,
				"--no-open",
				"--port",
				"0",
				"--untracked",
				"--split",
				"--tree-right",
				"--watch",
				"--no-flatten",
				"--hide-tree",
				"--fold-with-tree",
			],
			{
				cwd: flagsRepo,
				env: { ...process.env, XDG_CACHE_HOME: flagsCache },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const url = await readUrlFromStdout(p.stdout);
		const q = new URL(url).searchParams;
		expect(q.get("untracked")).toBe("1");
		expect(q.get("style")).toBe("split");
		expect(q.get("tree")).toBe("right");
		expect(q.get("watch")).toBe("1");
		expect(q.get("flatten")).toBe("0");
		expect(q.get("sidebar")).toBe("0");
		expect(q.get("foldtree")).toBe("1");
		p.kill("SIGINT");
		await p.exited;
		rmSync(flagsRepo, { recursive: true, force: true });
		rmSync(flagsCache, { recursive: true, force: true });
	});
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
	test("printed URL carries a token", () => {
		expect(token.length).toBeGreaterThan(0);
	});

	test("GET /api/ping returns 204 with the x-diffdeck marker", async () => {
		const res = await fetch(`${baseUrl}/api/ping`);
		expect(res.status).toBe(204);
		expect(res.headers.get("x-diffdeck")).toBe("1");
	});

	test("GET / serves the viewer shell", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(await res.text()).toContain("/main.js");
	});

	test("GET /api/diff with the token returns the repo diff JSON", async () => {
		const res = await fetch(
			`${baseUrl}/api/diff?repo=${encodeURIComponent(repo)}&token=${token}`,
		);
		expect(res.status).toBe(200);
		// DiffFile's field is `name`, not `path` — see apps/viewer/server/diff.ts.
		const files = (await res.json()) as Array<{ name: string }>;
		expect(files.some((f) => f.name === "a.txt")).toBe(true);
	});

	test("SIGINT stops the server gracefully (exit 0)", async () => {
		proc.kill("SIGINT");
		expect(await proc.exited).toBe(0);
	});

	test("view flags appear in the printed URL", async () => {
		const cliPath = join(import.meta.dir, "..", "dist", "cli.js");
		const repo = mkdtempSync(join(tmpdir(), "dd-flags-repo-"));
		await $`git -C ${repo} init -q`;
		const cache = mkdtempSync(join(tmpdir(), "dd-flags-cache-"));
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
			],
			{
				cwd: repo,
				env: { ...process.env, XDG_CACHE_HOME: cache },
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
		p.kill("SIGINT");
		await p.exited;
		rmSync(repo, { recursive: true, force: true });
		rmSync(cache, { recursive: true, force: true });
	});
});

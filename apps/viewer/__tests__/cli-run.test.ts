import { describe, expect, mock, spyOn, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedArgs } from "../cli/args.ts";
import { realDeps, run, type CliDeps } from "../cli.ts";
import { SAFE_CWD } from "../server/cwd.ts";
import type { DiffServerHandle } from "../server/server.ts";

class ExitSignal extends Error {
	code: number;
	constructor(code: number) {
		super(`exit(${code})`);
		this.code = code;
	}
}

const defaultArgs: ParsedArgs = {
	open: true,
	help: false,
	version: false,
	untracked: false,
	watch: false,
	flatten: true,
	treeSide: "left",
	diffStyle: "unified",
	treeHidden: false,
};

const makeHandle = (
	port: number | undefined,
	stop = mock(),
): DiffServerHandle =>
	({
		server: { port },
		token: "tk",
		stop,
	}) as unknown as DiffServerHandle;

const makeDeps = (over: Partial<CliDeps> = {}): CliDeps => ({
	startServer: mock(() =>
		makeHandle(5000),
	) as unknown as CliDeps["startServer"],
	buildUrl: mock(() => "http://127.0.0.1:5000/?token=tk"),
	resolvePort: mock(() => 49573),
	parse: mock(() => defaultArgs),
	spawnOpener: mock(),
	installSkill: mock(() => ["/home/u/.claude/skills/diffdeck"]),
	log: mock(),
	error: mock(),
	exit: mock((code: number) => {
		throw new ExitSignal(code);
	}) as unknown as CliDeps["exit"],
	onSignal: mock(),
	cwd: mock(() => "/repo"),
	toSafeCwd: mock(),
	viewerDir: "/v",
	prewarm: mock(),
	...over,
});

const runExpectingExit = (argv: string[], deps: CliDeps): ExitSignal => {
	try {
		run(argv, deps);
	} catch (err) {
		if (err instanceof ExitSignal) return err;
		throw err;
	}
	throw new Error("run() returned without exiting");
};

describe("run — install-skill", () => {
	test("installs before flag parsing, logs per target, exits 0", () => {
		const deps = makeDeps();
		const signal = runExpectingExit(["install-skill", "--codex"], deps);
		expect(deps.installSkill).toHaveBeenCalledWith(["--codex"]);
		expect(deps.log).toHaveBeenCalledWith(
			"installed diffdeck skill → /home/u/.claude/skills/diffdeck/SKILL.md",
		);
		expect(signal.code).toBe(0);
		expect(deps.parse).not.toHaveBeenCalled();
		expect(deps.startServer).not.toHaveBeenCalled();
	});

	test("logs one line per installed target dir", () => {
		const deps = makeDeps({
			installSkill: mock(() => ["/a/diffdeck", "/b/diffdeck"]),
		});
		runExpectingExit(["install-skill"], deps);
		expect(deps.log).toHaveBeenCalledWith(
			"installed diffdeck skill → /a/diffdeck/SKILL.md",
		);
		expect(deps.log).toHaveBeenCalledWith(
			"installed diffdeck skill → /b/diffdeck/SKILL.md",
		);
	});
});

describe("run — help/version", () => {
	test("--help logs HELP and exits 0 without starting the server", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs, help: true })),
		});
		const signal = runExpectingExit(["--help"], deps);
		expect(deps.log).toHaveBeenCalledWith(
			expect.stringContaining("diffdeck — local git diff viewer"),
		);
		expect(signal.code).toBe(0);
		expect(deps.startServer).not.toHaveBeenCalled();
	});

	test("--version logs the package version and exits 0", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs, version: true })),
		});
		const signal = runExpectingExit(["--version"], deps);
		expect(deps.log).toHaveBeenCalledWith(expect.any(String));
		expect(signal.code).toBe(0);
		expect(deps.startServer).not.toHaveBeenCalled();
	});
});

describe("run — normal startup", () => {
	test("kicks off a diff-cache prewarm with the bound port, repo, token, and untracked flag", () => {
		const deps = makeDeps();
		run([], deps);
		expect(deps.prewarm).toHaveBeenCalledWith({
			port: 5000,
			repo: "/repo",
			token: "tk",
			untracked: false,
		});
	});

	test("prewarm follows the --untracked launch flag", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs, untracked: true })),
		});
		run([], deps);
		expect(deps.prewarm).toHaveBeenCalledWith(
			expect.objectContaining({ untracked: true }),
		);
	});

	test("starts the server, builds the url, logs, opens, and registers signals", () => {
		const stop = mock();
		const deps = makeDeps({
			startServer: mock(() =>
				makeHandle(5000, stop),
			) as unknown as CliDeps["startServer"],
			parse: mock(() => ({ ...defaultArgs, open: true })),
		});

		const signal = (() => {
			try {
				run([], deps);
			} catch (err) {
				if (err instanceof ExitSignal) return err;
				throw err;
			}
			return undefined;
		})();
		// Normal startup does not exit synchronously — it registers signal
		// handlers and returns.
		expect(signal).toBeUndefined();

		expect(deps.startServer).toHaveBeenCalledWith({
			port: 49573,
			viewerDir: "/v",
			repairCwd: deps.toSafeCwd,
		});
		expect(deps.buildUrl).toHaveBeenCalledWith({
			port: 5000,
			repo: "/repo",
			token: "tk",
			untracked: false,
			watch: false,
			flatten: true,
			treeSide: "left",
			diffStyle: "unified",
			treeHidden: false,
		});
		expect(deps.log).toHaveBeenCalledWith("diffdeck viewer running at:");
		expect(deps.log).toHaveBeenCalledWith("http://127.0.0.1:5000/?token=tk");
		expect(deps.log).toHaveBeenCalledWith("Press Ctrl+C to stop.");
		expect(deps.spawnOpener).toHaveBeenCalledWith(
			"http://127.0.0.1:5000/?token=tk",
		);
		expect(deps.onSignal).toHaveBeenCalledTimes(2);
		expect(deps.onSignal).toHaveBeenCalledWith("SIGINT", expect.any(Function));
		expect(deps.onSignal).toHaveBeenCalledWith("SIGTERM", expect.any(Function));

		// The registered shutdown handler stops the server and exits 0.
		const onSignalMock = deps.onSignal as unknown as ReturnType<typeof mock>;
		const [, sigintHandler] = onSignalMock.mock.calls[0] as [
			string,
			() => void,
		];
		let shutdownExit: ExitSignal | null = null;
		try {
			sigintHandler();
		} catch (err) {
			if (err instanceof ExitSignal) shutdownExit = err;
		}
		expect(shutdownExit).toBeInstanceOf(ExitSignal);
		expect(shutdownExit?.code).toBe(0);
		expect(stop).toHaveBeenCalledTimes(1);
	});

	test("--no-open does not spawn the opener", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs, open: false })),
		});
		run([], deps);
		expect(deps.spawnOpener).not.toHaveBeenCalled();
	});

	test("explicit --port skips resolvePort and is used verbatim", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs, port: 6001 })),
		});
		run([], deps);
		expect(deps.resolvePort).not.toHaveBeenCalled();
		expect(deps.startServer).toHaveBeenCalledWith({
			port: 6001,
			viewerDir: "/v",
			repairCwd: deps.toSafeCwd,
		});
	});

	test("no --port falls back to resolvePort()", () => {
		const deps = makeDeps({
			parse: mock(() => ({ ...defaultArgs })),
		});
		run([], deps);
		expect(deps.resolvePort).toHaveBeenCalledTimes(1);
		expect(deps.startServer).toHaveBeenCalledWith({
			port: 49573,
			viewerDir: "/v",
			repairCwd: deps.toSafeCwd,
		});
	});

	// 순서가 곧 계약이다. toSafeCwd가 cwd()보다 먼저면 repo가 "/"가 되어
	// 엉뚱한 리포를 서빙하고, startServer보다 나중이면 그 사이에 기동
	// 디렉토리가 지워지는 창이 남는다.
	test("repo를 읽은 뒤, 서버를 띄우기 전에 안전 cwd로 이탈한다", () => {
		const calls: string[] = [];
		const deps = makeDeps({
			cwd: mock(() => {
				calls.push("cwd");
				return "/repo";
			}),
			toSafeCwd: mock(() => {
				calls.push("toSafeCwd");
			}),
			startServer: mock(() => {
				calls.push("startServer");
				return makeHandle(5000);
			}) as unknown as CliDeps["startServer"],
		});

		run([], deps);

		expect(calls).toEqual(["cwd", "toSafeCwd", "startServer"]);
	});

	test("buildUrl은 기동 디렉토리를 repo로 받는다", () => {
		const deps = makeDeps({ cwd: mock(() => "/repo") });

		run([], deps);

		expect(deps.buildUrl).toHaveBeenCalledWith(
			expect.objectContaining({ repo: "/repo" }),
		);
	});

	test("같은 이탈 함수를 서버의 복구 훅으로 주입한다", () => {
		const toSafeCwd = mock();
		const deps = makeDeps({ toSafeCwd });

		run([], deps);

		expect(deps.startServer).toHaveBeenCalledWith(
			expect.objectContaining({ repairCwd: toSafeCwd }),
		);
	});

	test("undefined handle.server.port falls back to the requested port in buildUrl", () => {
		const deps = makeDeps({
			startServer: mock(() =>
				makeHandle(undefined),
			) as unknown as CliDeps["startServer"],
			parse: mock(() => ({ ...defaultArgs, port: 7000 })),
		});
		run([], deps);
		expect(deps.buildUrl).toHaveBeenCalledWith(
			expect.objectContaining({ port: 7000 }),
		);
	});
});

describe("run — server start failure", () => {
	test("logs the error, exits 1, and never builds the url", () => {
		const deps = makeDeps({
			startServer: mock(() => {
				throw new Error("EADDRINUSE");
			}) as unknown as CliDeps["startServer"],
			parse: mock(() => ({ ...defaultArgs, port: 4999 })),
		});
		const signal = runExpectingExit([], deps);
		expect(deps.error).toHaveBeenCalledWith(
			"diffdeck: failed to start server on port 4999: EADDRINUSE",
		);
		expect(signal.code).toBe(1);
		expect(deps.buildUrl).not.toHaveBeenCalled();
	});

	test("non-Error throw is stringified into the error message", () => {
		const deps = makeDeps({
			startServer: mock(() => {
				throw "boom";
			}) as unknown as CliDeps["startServer"],
		});
		const signal = runExpectingExit([], deps);
		expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("boom"));
		expect(signal.code).toBe(1);
	});
});

// realDeps wires each CliDeps collaborator to a real side-effecting API
// (Bun.spawn, console, process.exit/on/cwd, the fs-backed skill installer).
// run() itself is fully exercised above via fake deps; these tests instead
// exercise realDeps' own bodies directly, spying on the underlying globals so
// nothing here actually opens a browser, exits the test process, or touches
// the real $HOME.
describe("realDeps", () => {
	test("spawnOpener spawns via Bun.spawn and swallows spawn failures", () => {
		const spawnSpy = spyOn(Bun, "spawn").mockImplementation(
			() => ({ unref: () => {} }) as unknown as ReturnType<typeof Bun.spawn>,
		);
		realDeps.spawnOpener("http://127.0.0.1:1/x");
		expect(spawnSpy).toHaveBeenCalled();

		spawnSpy.mockImplementation(() => {
			throw new Error("no opener available");
		});
		expect(() => realDeps.spawnOpener("http://127.0.0.1:1/x")).not.toThrow();

		spawnSpy.mockRestore();
	});

	test("log and error write to the console", () => {
		const logSpy = spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = spyOn(console, "error").mockImplementation(() => {});
		realDeps.log("hello");
		realDeps.error("oops");
		expect(logSpy).toHaveBeenCalledWith("hello");
		expect(errorSpy).toHaveBeenCalledWith("oops");
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	test("exit delegates to process.exit", () => {
		const exitSpy = spyOn(process, "exit").mockImplementation(
			(() => undefined) as unknown as typeof process.exit,
		);
		realDeps.exit(0);
		expect(exitSpy).toHaveBeenCalledWith(0);
		exitSpy.mockRestore();
	});

	test("onSignal delegates to process.on", () => {
		const onSpy = spyOn(process, "on").mockImplementation(
			(() => process) as unknown as typeof process.on,
		);
		const handler = (): void => {};
		realDeps.onSignal("SIGINT", handler);
		expect(onSpy).toHaveBeenCalledWith("SIGINT", handler);
		onSpy.mockRestore();
	});

	test("cwd delegates to process.cwd", () => {
		expect(realDeps.cwd()).toBe(process.cwd());
	});

	// realDeps.toSafeCwd는 커버리지 게이트(함수 100%) 대상이라 실제로 한 번
	// 불려야 한다. bun test는 파일들을 한 프로세스에서 순차 실행하므로
	// chdir이 새어나가면 뒤따르는 테스트 파일이 전부 오염된다 — finally로
	// 반드시 되돌린다.
	test("realDeps.toSafeCwd가 프로세스를 안전 경로로 옮긴다", () => {
		const before = process.cwd();
		try {
			realDeps.toSafeCwd();
			expect(process.cwd()).toBe(SAFE_CWD);
		} finally {
			process.chdir(before);
		}
	});

	test("prewarm is fire-and-forget and never throws, even unreachable", () => {
		expect(() =>
			realDeps.prewarm({
				port: 1,
				repo: "/nope",
				token: "t",
				untracked: false,
			}),
		).not.toThrow();
	});

	test("viewerDir points at the sibling viewer/ directory", () => {
		expect(realDeps.viewerDir.endsWith("/viewer")).toBe(true);
	});

	test("installSkill parses argv, resolves --project targets under cwd, and writes SKILL.md", () => {
		const tmp = mkdtempSync(join(tmpdir(), "dd-realdeps-cwd-"));
		const skillSourceDir = join(import.meta.dir, "..", "skills", "diffdeck");
		mkdirSync(skillSourceDir, { recursive: true });
		writeFileSync(
			join(skillSourceDir, "SKILL.md"),
			"---\nname: diffdeck\n---\nbody",
		);
		const cwdSpy = spyOn(process, "cwd").mockReturnValue(tmp);
		try {
			const targets = realDeps.installSkill(["--project"]);
			expect(targets).toEqual([join(tmp, ".claude", "skills", "diffdeck")]);
			expect(
				readFileSync(
					join(tmp, ".claude", "skills", "diffdeck", "SKILL.md"),
					"utf8",
				),
			).toContain("name: diffdeck");
		} finally {
			cwdSpy.mockRestore();
			rmSync(tmp, { recursive: true, force: true });
			// realDeps.installSkill의 소스 경로(cli.ts: `${import.meta.dir}/skills/...`)는
			// 소스 트리에서 실행될 때 apps/viewer/skills/를 가리킨다 — 빌드 산출물
			// (dist/skills/, build.ts가 채움)과 달리 이 경로는 트리에 원래 없어서
			// 이 테스트가 직접 만들어야 한다. 정확히 이 테스트가 만든 파일/빈
			// 디렉토리만 지운다 — apps/viewer/skills/가 다른 이유로 이미 있었거나
			// 비어 있지 않다면 건드리지 않는다(rmdirSync는 비어있지 않으면 throw).
			rmSync(join(skillSourceDir, "SKILL.md"), { force: true });
			try {
				rmdirSync(skillSourceDir);
				rmdirSync(join(import.meta.dir, "..", "skills"));
			} catch {
				// 비어있지 않음 — 이 테스트가 만든 게 아니니 그대로 둔다.
			}
		}
	});
});

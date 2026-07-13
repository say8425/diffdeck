import { describe, expect, mock, spyOn, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedArgs } from "../cli/args.ts";
import { realDeps, run, type CliDeps } from "../cli.ts";
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
	viewerDir: "/v",
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
		expect(() => sigintHandler()).toThrow(ExitSignal);
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
		});
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
			rmSync(join(import.meta.dir, "..", "skills"), {
				recursive: true,
				force: true,
			});
		}
	});
});

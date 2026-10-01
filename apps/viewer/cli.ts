import { parseArgs, type ParsedArgs } from "./cli/args.ts";
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "./cli/installSkill.ts";
import { openerCommand } from "./cli/opener.ts";
import packageJson from "./package.json";
import { resolveDiffPort } from "./server/config.ts";
import { SAFE_CWD } from "./server/cwd.ts";
import { buildDiffViewerUrl } from "./server/link.ts";
import { prewarmDiff } from "./server/prewarm.ts";
import { startDiffServer } from "./server/server.ts";

export const HELP = `diffdeck — local git diff viewer

Usage:
  bunx @say8425/diffdeck [options]
  bunx @say8425/diffdeck install-skill [--codex] [--project]

Commands:
  install-skill  Install the diffdeck agent skill so an AI agent can open the
                 viewer for you. Writes ~/.claude/skills/diffdeck/ (add --codex
                 for ~/.agents/skills/, --project for the current repo).

Options:
  --port <n>        Port to serve on (default: $DIFFDECK_PORT or 49573)
  --no-open         Do not open a browser automatically
  --untracked       Start with untracked files included
  --watch           Start with watch (auto-refresh) on
  --no-flatten      Start with the file tree un-flattened (flatten is on by default)
  --tree-right      Start with the file tree on the right
  --split           Start in split view (unified is the default)
  --hide-tree       Start with the file tree hidden
  --fold-with-tree  Start with sidebar directory collapse synced to diff folds
  -h, --help        Show this help
  -v, --version     Show version

Runs a local diff viewer for the git repository in the current directory.
Press Ctrl+C to stop.`;

export interface CliDeps {
	startServer: typeof startDiffServer;
	buildUrl: typeof buildDiffViewerUrl;
	resolvePort: typeof resolveDiffPort;
	parse: (argv: string[]) => ParsedArgs;
	spawnOpener: (url: string) => void;
	installSkill: (argv: string[]) => string[];
	log: (msg: string) => void;
	error: (msg: string) => void;
	exit: (code: number) => never;
	onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
	cwd: () => string;
	/** 프로세스를 지워질 수 없는 경로로 옮긴다. 예방과 복구 양쪽에 쓰인다. */
	toSafeCwd: () => void;
	viewerDir: string;
	prewarm: (opts: {
		port: number;
		repo: string;
		token: string;
		untracked: boolean;
	}) => void;
}

export const run = (argv: string[], deps: CliDeps): void => {
	if (argv[0] === "install-skill") {
		const dirs = deps.installSkill(argv.slice(1));
		for (const dir of dirs) {
			deps.log(`installed diffdeck skill → ${dir}/SKILL.md`);
		}
		deps.exit(0);
	}

	const args = deps.parse(argv);

	if (args.help) {
		deps.log(HELP);
		deps.exit(0);
	}
	if (args.version) {
		deps.log(packageJson.version);
		deps.exit(0);
	}

	const port = args.port ?? deps.resolvePort();
	const repo = deps.cwd();

	// repo를 읽은 직후에 cwd를 떠난다(먼저 떠나면 repo가 `/`가 된다). 이후 git·gh 호출은
	// 모두 repo를 명시하므로, 대개 지워질 워크트리인 이 디렉토리가 삭제돼도 데몬이
	// 산다 — cwd가 삭제된 프로세스는 자식 프로세스를 띄울 수 없다(.claude/rules/server.md).
	deps.toSafeCwd();

	let handle: ReturnType<typeof startDiffServer>;
	try {
		handle = deps.startServer({
			port,
			viewerDir: deps.viewerDir,
			repairCwd: deps.toSafeCwd,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		deps.error(`diffdeck: failed to start server on port ${port}: ${message}`);
		return deps.exit(1);
	}

	const url = deps.buildUrl({
		// bun-types makes the port optional (unix sockets); we always bind TCP.
		port: handle.server.port ?? port,
		repo,
		token: handle.token,
		untracked: args.untracked,
		watch: args.watch,
		flatten: args.flatten,
		treeSide: args.treeSide,
		diffStyle: args.diffStyle,
		treeHidden: args.treeHidden,
		foldWithTree: args.foldWithTree,
	});

	deps.log("diffdeck viewer running at:");
	deps.log(url);
	deps.log("Press Ctrl+C to stop.");

	deps.prewarm({
		port: handle.server.port ?? port,
		repo,
		token: handle.token,
		untracked: args.untracked,
	});

	if (args.open) {
		deps.spawnOpener(url);
	}

	const shutdown = (): void => {
		handle.stop();
		deps.exit(0);
	};
	deps.onSignal("SIGINT", shutdown);
	deps.onSignal("SIGTERM", shutdown);
};

export const realDeps: CliDeps = {
	startServer: startDiffServer,
	buildUrl: buildDiffViewerUrl,
	resolvePort: resolveDiffPort,
	parse: parseArgs,
	spawnOpener: (url) => {
		try {
			Bun.spawn(openerCommand(process.platform, url), {
				stdout: "ignore",
				stderr: "ignore",
			}).unref();
		} catch {
			// Best-effort: the URL is already printed (headless/CI has no opener).
		}
	},
	installSkill: (argv) => {
		const opts = parseInstallArgs(argv);
		const source = `${import.meta.dir}/skills/diffdeck/SKILL.md`;
		const targets = resolveSkillTargets(opts);
		installSkillTo(source, targets);
		return targets;
	},
	log: (msg) => console.log(msg),
	error: (msg) => console.error(msg),
	exit: (code) => process.exit(code),
	onSignal: (signal, handler) => {
		process.on(signal, handler);
	},
	cwd: () => process.cwd(),
	toSafeCwd: () => process.chdir(SAFE_CWD),
	viewerDir: `${import.meta.dir}/viewer`,
	prewarm: (opts) => void prewarmDiff(opts),
};

if (import.meta.main) run(process.argv.slice(2), realDeps);

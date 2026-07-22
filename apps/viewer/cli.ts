import { parseArgs, type ParsedArgs } from "./cli/args.ts";
import {
	installSkillTo,
	parseInstallArgs,
	resolveSkillTargets,
} from "./cli/installSkill.ts";
import { openerCommand } from "./cli/opener.ts";
import packageJson from "./package.json";
import { resolveDiffPort } from "./server/config.ts";
import { buildDiffViewerUrl } from "./server/link.ts";
import { startDiffServer } from "./server/server.ts";

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
  --untracked   Start with untracked files included
  --watch       Start with watch (auto-refresh) on
  --no-flatten  Start with the file tree un-flattened (flatten is on by default)
  --tree-right  Start with the file tree on the right
  --split       Start in split view (unified is the default)
  --hide-tree   Start with the file tree hidden
  -h, --help    Show this help
  -v, --version Show version

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
	viewerDir: string;
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

	let handle: ReturnType<typeof startDiffServer>;
	try {
		handle = deps.startServer({ port, viewerDir: deps.viewerDir });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		deps.error(`diffdeck: failed to start server on port ${port}: ${message}`);
		return deps.exit(1);
	}

	const url = deps.buildUrl({
		// handle.server.port is `number | undefined` in bun-types (unix sockets
		// have no port); we always request an explicit TCP port above, so the
		// bound port is always defined and always equals it — fall back to the
		// requested port defensively rather than asserting non-null.
		port: handle.server.port ?? port,
		repo,
		token: handle.token,
		untracked: args.untracked,
		watch: args.watch,
		flatten: args.flatten,
		treeSide: args.treeSide,
		diffStyle: args.diffStyle,
		treeHidden: args.treeHidden,
	});

	deps.log("diffdeck viewer running at:");
	deps.log(url);
	deps.log("Press Ctrl+C to stop.");

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
			// Opening the browser is best-effort — the URL is already printed and
			// the server keeps running even if no opener is available (headless/CI).
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
	viewerDir: `${import.meta.dir}/viewer`,
};

if (import.meta.main) run(process.argv.slice(2), realDeps);

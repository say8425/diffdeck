import { parseArgs } from "./cli/args.ts";
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
  -h, --help    Show this help
  -v, --version Show version

Runs a local diff viewer for the git repository in the current directory.
Press Ctrl+C to stop.`;

const main = (): void => {
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

	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		console.log(HELP);
		process.exit(0);
	}
	if (args.version) {
		console.log(packageJson.version);
		process.exit(0);
	}

	const port = args.port ?? resolveDiffPort();
	const repo = process.cwd();

	let handle: ReturnType<typeof startDiffServer>;
	try {
		handle = startDiffServer({
			port,
			viewerDir: `${import.meta.dir}/viewer`,
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error(
			`diffdeck: failed to start server on port ${port}: ${message}`,
		);
		process.exit(1);
	}

	const url = buildDiffViewerUrl({
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
	});

	console.log("diffdeck viewer running at:");
	console.log(url);
	console.log("Press Ctrl+C to stop.");

	if (args.open) {
		try {
			Bun.spawn(openerCommand(process.platform, url), {
				stdout: "ignore",
				stderr: "ignore",
			}).unref();
		} catch {
			// Opening the browser is best-effort — the URL is already printed and
			// the server keeps running even if no opener is available (headless/CI).
		}
	}

	const shutdown = (): void => {
		handle.stop();
		process.exit(0);
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
};

main();

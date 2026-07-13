export interface ParsedArgs {
	port?: number;
	open: boolean;
	help: boolean;
	version: boolean;
	untracked: boolean;
	watch: boolean;
	flatten: boolean;
	treeSide: "left" | "right";
	diffStyle: "unified" | "split";
}

const parsePort = (raw: string | undefined): number | undefined => {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	// 0 is a valid, meaningful value here (ask the OS for any free port —
	// Bun.serve({ port: 0 }) honors it), so the lower bound is inclusive.
	return Number.isInteger(n) && n >= 0 && n < 65536 ? n : undefined;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
	const result: ParsedArgs = {
		open: true,
		help: false,
		version: false,
		untracked: false,
		watch: false,
		flatten: true,
		treeSide: "left",
		diffStyle: "unified",
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--port") {
			const port = parsePort(argv[i + 1]);
			if (port !== undefined) result.port = port;
			i++; // consume the value token (even when invalid)
		} else if (arg === "--no-open") {
			result.open = false;
		} else if (arg === "--help" || arg === "-h") {
			result.help = true;
		} else if (arg === "--version" || arg === "-v") {
			result.version = true;
		} else if (arg === "--untracked") {
			result.untracked = true;
		} else if (arg === "--watch") {
			result.watch = true;
		} else if (arg === "--no-flatten") {
			result.flatten = false;
		} else if (arg === "--tree-right") {
			result.treeSide = "right";
		} else if (arg === "--split") {
			result.diffStyle = "split";
		}
	}
	return result;
};

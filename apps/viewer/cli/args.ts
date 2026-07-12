export interface ParsedArgs {
	port?: number;
	open: boolean;
	help: boolean;
	version: boolean;
}

const parsePort = (raw: string | undefined): number | undefined => {
	if (!raw) return undefined;
	const n = Number.parseInt(raw, 10);
	return Number.isInteger(n) && n > 0 && n < 65536 ? n : undefined;
};

export const parseArgs = (argv: string[]): ParsedArgs => {
	const result: ParsedArgs = { open: true, help: false, version: false };
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
		}
	}
	return result;
};

// Build the CLI + viewer bundle once before the e2e suite runs, so every spec
// spawns a real `dist/cli.js` (mirrors apps/viewer/__tests__/cli-smoke.test.ts's
// per-file beforeAll, but Playwright only needs to pay this cost once for the
// whole run). Runs under Node (see fixtures/proc.ts), so this spawns the
// real `bun` binary rather than using the `Bun` global directly.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runToExit } from "./fixtures/proc.ts";

const here = dirname(fileURLToPath(import.meta.url));

export default async function globalSetup(): Promise<void> {
	const result = await runToExit("bun", ["run", join(here, "..", "build.ts")], {
		cwd: join(here, ".."),
	});
	if (result.code !== 0) {
		throw new Error(
			`diffdeck build failed for e2e (exit ${result.code}):\n${result.stderr}`,
		);
	}
}

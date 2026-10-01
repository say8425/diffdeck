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

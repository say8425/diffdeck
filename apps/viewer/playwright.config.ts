import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e",
	testMatch: "**/*.e2e.ts",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: false,
	workers: 1,
	reporter: [["list"]],
	use: { channel: "chrome", headless: true },
	timeout: 30_000,
});

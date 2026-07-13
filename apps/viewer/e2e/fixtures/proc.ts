// Node child_process helpers for the e2e global-setup and app fixture.
//
// Playwright Test always runs spec files, fixtures, and globalSetup under
// Node.js — even when the `playwright` CLI itself was launched via `bunx`,
// Playwright forks its own Node worker processes internally. So unlike the
// rest of this repo's `bun test` suite, files under e2e/** can't rely on the
// `Bun` global or `"bun"`'s `$` shell; they spawn the real `bun` binary (via
// PATH) as a child process instead, exactly as a developer would from a
// terminal.
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Spawn `command args`, buffer stdout/stderr, and resolve once it exits. */
export const runToExit = (
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> =>
	new Promise((resolve, reject) => {
		const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
			command,
			args,
			{
				...options,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});

export interface LongRunningProcess {
	stdout: Readable;
	exited: Promise<number>;
	kill: (signal?: NodeJS.Signals) => void;
}

/** Spawn a long-running process (the diffdeck server) without awaiting exit. */
export const spawnLongRunning = (
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): LongRunningProcess => {
	const child: ChildProcessByStdio<null, Readable, Readable> = spawn(
		command,
		args,
		{
			...options,
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	const exited = new Promise<number>((resolve, reject) => {
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 0));
	});
	// A rejection here is surfaced to callers via `exited` (e.g. `stop()`
	// awaits it). But callers that fail earlier — e.g. `readUrlFromStdout`
	// throwing before anyone awaits `exited` — would otherwise leave this
	// promise's rejection unhandled and crash the process. Attaching a no-op
	// catch marks it handled without swallowing the rejection for real
	// consumers (Promise settlement fires all attached handlers).
	exited.catch(() => {});
	return {
		stdout: child.stdout,
		exited,
		kill: (signal = "SIGTERM") => {
			child.kill(signal);
		},
	};
};

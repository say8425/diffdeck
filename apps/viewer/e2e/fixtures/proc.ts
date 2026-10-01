// Playwright runs fixtures under Node, so these spawn `bun` via child_process
// instead of using `Bun`/`$` (e2e.md).
import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

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
	/** 지금까지 쌓인 stderr 전체. */
	stderr: () => string;
	exited: Promise<number>;
	kill: (signal?: NodeJS.Signals) => void;
}

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
	// Marks the rejection handled so a caller that fails before awaiting
	// `exited` doesn't crash the process; awaiting callers still see it.
	exited.catch(() => {});
	// stderr를 읽어 둬야 자식이 죽은 이유가 kill과 함께 버려지지 않는다.
	// setEncoding으로 받는다 — 청크마다 Buffer.toString()을 부르면 경계에서
	// 멀티바이트 문자가 깨진다.
	let stderrBuffer = "";
	child.stderr.setEncoding("utf8");
	child.stderr.on("data", (chunk: string) => {
		stderrBuffer += chunk;
	});
	return {
		stdout: child.stdout,
		stderr: () => stderrBuffer,
		exited,
		kill: (signal = "SIGTERM") => {
			child.kill(signal);
		},
	};
};

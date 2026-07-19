import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCacheDir } from "./config.ts";

type Env = Record<string, string | undefined>;

export const getTokenPath = (env: Env = process.env): string =>
	join(getCacheDir(env), "diff-server.token");

export const generateToken = (): string =>
	crypto.randomUUID().replaceAll("-", "");

export const readTokenSync = (env: Env = process.env): string | null => {
	try {
		const value = readFileSync(getTokenPath(env), "utf8").trim();
		return value || null;
	} catch {
		return null;
	}
};

/**
 * Write the token out. Kept separate from minting it so the server can bind
 * its port first: the token file is what a client takes as "a daemon is
 * usable here", so persisting one for a server that then fails to start
 * points that client at whoever really owns the port.
 */
export const persistToken = (token: string, env: Env = process.env): void => {
	mkdirSync(getCacheDir(env), { recursive: true, mode: 0o700 });
	writeFileSync(getTokenPath(env), token, { mode: 0o600 });
};

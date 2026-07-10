import { Glob } from "bun";
import { dirname, join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function extractSources(
	mapDir: string,
	opts: { keepNodeModules?: boolean },
): Map<string, string> {
	const out = new Map<string, string>();
	const glob = new Glob("**/*.js.map");
	for (const abs of glob.scanSync({ cwd: mapDir, absolute: true })) {
		const map = JSON.parse(readFileSync(abs, "utf8"));
		const sources: string[] = map.sources ?? [];
		const contents: (string | null)[] = map.sourcesContent ?? [];
		sources.forEach((s, i) => {
			if (!opts.keepNodeModules && s.includes("/node_modules/")) return;
			const content = contents[i];
			if (!content) return;
			const norm = s.replace(/^(\.\.\/)+/, "").replace(/^\.\//, "");
			if (!out.has(norm)) out.set(norm, content);
		});
	}
	return out;
}

export function writeSources(map: Map<string, string>, outDir: string): number {
	let n = 0;
	for (const [rel, content] of map) {
		const path = join(outDir, rel);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, content);
		n++;
	}
	return n;
}

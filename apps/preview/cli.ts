import { parseArgs } from "node:util";
import { recordSnapshot } from "./record.ts";

const { values } = parseArgs({
	options: {
		repo: { type: "string", default: "." },
		viewer: { type: "string", default: "apps/viewer/dist/viewer" },
		out: { type: "string", default: "apps/preview/site" },
		base: { type: "string", default: "@auto" },
	},
});
const manifest = await recordSnapshot({
	repo: values.repo,
	viewerDir: values.viewer,
	outDir: values.out,
	base: values.base,
});
for (const [key, entry] of Object.entries(manifest.entries)) {
	console.log(`${entry.status} ${key}`);
}

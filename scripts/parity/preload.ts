// bunfig.toml `[test] preload` entry: registers the reusable css-inline plugin
// (scripts/css-inline-plugin.ts) with the Bun runtime so `bun test` can resolve
// the forked packages' `import styles from '../style.css?inline'` imports to the
// real stylesheet text. Same plugin the build (scripts/parity/build.ts) uses.
import { plugin } from "bun";
import { cssInlinePlugin } from "../css-inline-plugin.ts";

await plugin(cssInlinePlugin);

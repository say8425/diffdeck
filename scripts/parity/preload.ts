// bunfig.toml `[test] preload` entry: registers the runtime css-inline plugin
// (scripts/css-inline-plugin.ts) with the Bun runtime so `bun test` resolves
// the forked packages' `import styles from '../style.css?inline'` imports to the
// real stylesheet text. The build (scripts/parity/build.ts) uses the bundler
// variant from the same module.
import { plugin } from "bun";
import { cssInlineRuntimePlugin } from "../css-inline-plugin.ts";

await plugin(cssInlineRuntimePlugin);

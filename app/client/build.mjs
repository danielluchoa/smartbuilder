// Standalone client build (Bun bundler + Tailwind plugin).
// Replaces the Muse artifact SDK's build step with the same Bun.build
// configuration: bundles index.html (and its src/main.tsx entry) into
// dist/ as static files the SmartBuilder server serves.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindPlugin from "bun-plugin-tailwind";

const here = dirname(fileURLToPath(import.meta.url));
process.chdir(here);

const result = await Bun.build({
  entrypoints: ["./index.html"],
  outdir: "./dist",
  target: "browser",
  minify: true,
  sourcemap: "none",
  define: { "process.env.NODE_ENV": '"production"' },
  naming: {
    asset: "assets/[name]-[hash].[ext]",
    chunk: "assets/[name]-[hash].[ext]",
    entry: "[name].[ext]",
  },
  plugins: [tailwindPlugin],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.log(
  "[build] client built:",
  result.outputs.map((o) => o.path.replace(`${here}/`, "")).join(", "),
);

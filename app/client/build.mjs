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

// Bun rewrites imported asset URLs as "./<name>-<hash>.<ext>" which the
// browser resolves against the document ("/"), not "/assets/". Copy the
// logo files to dist/ root so <img src> resolves correctly.
import { copyFileSync, readdirSync } from "node:fs";
for (const f of readdirSync(`${here}/dist/assets`)) {
  if (f.startsWith("logo-")) copyFileSync(`${here}/dist/assets/${f}`, `${here}/dist/${f}`);
}

console.log(
  "[build] client built:",
  result.outputs.map((o) => o.path.replace(`${here}/`, "")).join(", "),
);

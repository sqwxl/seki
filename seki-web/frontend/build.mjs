import * as esbuild from "esbuild";
const watch = process.argv.includes("--watch");

const appConfig = {
  entryPoints: ["src/index.ts"],
  jsx: "automatic",
  jsxImportSource: "preact",
  bundle: true,
  outdir: "../static/dist",
  entryNames: "bundle",
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  splitting: true,
  minify: !watch,
  sourcemap: watch,
  external: ["/static/wasm/*"],
  logLevel: "info",
};

const swConfig = {
  entryPoints: ["src/service-worker.ts"],
  bundle: true,
  outfile: "../static/dist/sw.js",
  format: "esm",
  minify: !watch,
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx1 = await esbuild.context(appConfig);
    const ctx2 = await esbuild.context(swConfig);
    await ctx1.watch();
    await ctx2.watch();
    console.log("Watching for changes...");
  } else {
    await Promise.all([esbuild.build(appConfig), esbuild.build(swConfig)]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

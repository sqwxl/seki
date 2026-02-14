import * as esbuild from "esbuild";
const watch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/index.ts"],
  jsx: "automatic",
  jsxImportSource: "preact",
  bundle: true,
  outfile: "../static/dist/bundle.js",
  format: "esm",
  sourcemap: true,
  external: ["/static/wasm/*"],
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(config);
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await esbuild.build(config);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

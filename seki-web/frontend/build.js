const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");

const config = {
  entryPoints: ["src/go.tsx"],
  bundle: true,
  outfile: "../static/dist/bundle.js",
  format: "esm",
  target: "es2020",
  jsx: "automatic",
  jsxImportSource: "preact",
  sourcemap: true,
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

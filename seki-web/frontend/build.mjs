import * as esbuild from "esbuild";
import { existsSync } from "fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "fs/promises";
import { createRequire } from "module";
import path from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(import.meta.url));
const watchMode = process.argv.includes("--watch");
const srcDir = path.join(root, "src");
const distDir = path.join(root, "../static/dist");
const devDir = path.join(distDir, "dev");
const vendorDir = path.join(devDir, "vendor");

const jsxConfig = {
  jsx: "automatic",
  jsxImportSource: "preact",
};

const vendorImports = new Map([
  ["preact", "/static/dist/dev/vendor/preact.js"],
  ["preact/hooks", "/static/dist/dev/vendor/preact-hooks.js"],
  ["preact/jsx-runtime", "/static/dist/dev/vendor/preact-jsx-runtime.js"],
  ["@preact/signals", "/static/dist/dev/vendor/preact-signals.js"],
  ["classnames", "/static/dist/dev/vendor/classnames.js"],
]);

const appConfig = {
  entryPoints: ["src/index.ts"],
  ...jsxConfig,
  bundle: true,
  outdir: "../static/dist",
  entryNames: "bundle",
  chunkNames: "chunks/[name]-[hash]",
  format: "esm",
  splitting: true,
  minify: true,
  external: ["/static/wasm/*", "/static/images/*"],
  logLevel: "info",
};

const swConfig = {
  entryPoints: ["src/service-worker.ts"],
  bundle: true,
  outfile: "../static/dist/sw.js",
  format: "esm",
  minify: !watchMode,
  logLevel: "info",
};

async function collectSourceEntries(dir = srcDir) {
  const entries = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "__mocks__") {
      continue;
    }

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      entries.push(...(await collectSourceEntries(fullPath)));
    } else if (/\.[cm]?[tj]sx?$/.test(entry.name)) {
      entries.push(fullPath);
    }
  }

  return entries;
}

function packagePath(packageName, relativePath) {
  let packageJson;

  try {
    packageJson = require.resolve(`${packageName}/package.json`);
  } catch {
    packageJson = require.resolve(packageName);

    while (path.basename(packageJson) !== "node_modules") {
      const candidate = path.join(packageJson, "../package.json");

      if (existsSync(candidate)) {
        packageJson = candidate;

        break;
      }

      packageJson = path.dirname(packageJson);
    }
  }

  return path.join(path.dirname(packageJson), relativePath);
}

function toBrowserPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function rewriteSpecifier(specifier, filePath) {
  const vendor = vendorImports.get(specifier);

  if (vendor) {
    return vendor;
  }

  if (!specifier.startsWith(".")) {
    return specifier;
  }

  const fromDir = path.dirname(filePath);
  const targetBase = path.resolve(fromDir, specifier);
  let target = targetBase;

  if (!path.extname(targetBase)) {
    const jsFile = `${targetBase}.js`;
    const indexFile = path.join(targetBase, "index.js");

    if (existsSync(jsFile)) {
      target = jsFile;
    } else if (existsSync(indexFile)) {
      target = indexFile;
    }
  }

  let next = toBrowserPath(path.relative(fromDir, target));

  if (!next.startsWith(".")) {
    next = `./${next}`;
  }

  return next;
}

function rewriteImports(code, filePath) {
  return code.replace(
    /((?:from|import)\s*(?:\(\s*)?["'])([^"']+)(["'])/g,
    (match, prefix, specifier, suffix) =>
      `${prefix}${rewriteSpecifier(specifier, filePath)}${suffix}`,
  );
}

async function rewriteJsImports(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await rewriteJsImports(fullPath);
    } else if (entry.name.endsWith(".js")) {
      const code = await readFile(fullPath, "utf8");

      await writeFile(fullPath, rewriteImports(code, fullPath));
    }
  }
}

async function writeVendorFiles() {
  await mkdir(vendorDir, { recursive: true });
  await copyFile(
    packagePath("preact", "dist/preact.mjs"),
    path.join(vendorDir, "preact.js"),
  );
  await copyFile(
    packagePath("preact", "hooks/dist/hooks.mjs"),
    path.join(vendorDir, "preact-hooks.js"),
  );
  await copyFile(
    packagePath("preact", "jsx-runtime/dist/jsxRuntime.mjs"),
    path.join(vendorDir, "preact-jsx-runtime.js"),
  );
  await esbuild.build({
    entryPoints: ["@preact/signals"],
    bundle: true,
    format: "esm",
    outfile: path.join(vendorDir, "preact-signals.js"),
    external: ["preact", "preact/hooks"],
    sourcemap: true,
    logLevel: "silent",
  });
  await esbuild.build({
    entryPoints: ["classnames"],
    bundle: true,
    format: "esm",
    outfile: path.join(vendorDir, "classnames.js"),
    sourcemap: true,
    logLevel: "silent",
  });
  await rewriteJsImports(vendorDir);
}

async function writeDevEntryShim() {
  await writeFile(
    path.join(distDir, "bundle.js"),
    'import "/static/dist/dev/index.js";\n',
  );
}

async function finalizeDevBuild() {
  await writeVendorFiles();
  await rewriteJsImports(devDir);
  await writeDevEntryShim();
}

async function createDevContext() {
  const entryPoints = await collectSourceEntries();

  return esbuild.context({
    entryPoints,
    ...jsxConfig,
    bundle: false,
    outbase: "src",
    outdir: "../static/dist/dev",
    format: "esm",
    sourcemap: true,
    logLevel: "info",
    plugins: [
      {
        name: "finalize-dev-modules",
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length === 0) {
              await finalizeDevBuild();
            }
          });
        },
      },
    ],
  });
}

async function main() {
  if (watchMode) {
    await rm(devDir, { recursive: true, force: true });
    const appCtx = await createDevContext();
    const swCtx = await esbuild.context(swConfig);
    await appCtx.watch();
    await swCtx.watch();

    console.log("Watching unbundled frontend modules...");
  } else {
    await Promise.all([esbuild.build(appConfig), esbuild.build(swConfig)]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

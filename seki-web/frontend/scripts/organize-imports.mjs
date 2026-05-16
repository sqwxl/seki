#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const configPath = ts.findConfigFile(frontendRoot, ts.sys.fileExists);

if (!configPath) {
  throw new Error("Could not find tsconfig.json");
}

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}

const parsed = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  frontendRoot,
);
const projectFiles = new Set(parsed.fileNames.map((file) => resolve(file)));

function gitRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: frontendRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return frontendRoot;
  }
}

function resolveInputPath(input) {
  const fromCwd = resolve(process.cwd(), input);
  if (existsSync(fromCwd)) {
    return fromCwd;
  }

  const fromGitRoot = resolve(gitRoot(), input);
  if (existsSync(fromGitRoot)) {
    return fromGitRoot;
  }

  return fromCwd;
}

function isTypeScriptFile(file) {
  return [".ts", ".tsx"].includes(extname(file));
}

const requestedFiles = process.argv.slice(2).map(resolveInputPath);
const targetFiles =
  requestedFiles.length > 0
    ? requestedFiles.filter((file) => isTypeScriptFile(file) && projectFiles.has(file))
    : [...projectFiles].filter(isTypeScriptFile);

const fileVersions = new Map(parsed.fileNames.map((file) => [resolve(file), "0"]));
const serviceHost = {
  getScriptFileNames: () => parsed.fileNames,
  getScriptVersion: (fileName) => fileVersions.get(resolve(fileName)) ?? "0",
  getScriptSnapshot: (fileName) => {
    if (!existsSync(fileName)) {
      return undefined;
    }
    return ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf8"));
  },
  getCurrentDirectory: () => frontendRoot,
  getCompilationSettings: () => parsed.options,
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
};

const languageService = ts.createLanguageService(
  serviceHost,
  ts.createDocumentRegistry(),
);

function applyTextChanges(text, changes) {
  return [...changes]
    .sort((a, b) => b.span.start - a.span.start)
    .reduce((next, change) => {
      const start = change.span.start;
      const end = start + change.span.length;
      return `${next.slice(0, start)}${change.newText}${next.slice(end)}`;
    }, text);
}

let changed = 0;

for (const fileName of targetFiles) {
  const changes = languageService.organizeImports(
    { type: "file", fileName },
    {},
    {},
  );
  const textChanges = changes.flatMap((change) => change.textChanges);
  if (textChanges.length === 0) {
    continue;
  }

  const current = readFileSync(fileName, "utf8");
  const next = applyTextChanges(current, textChanges);
  if (next !== current) {
    writeFileSync(fileName, next);
    changed += 1;
  }
}

if (changed > 0) {
  console.log(`Organized imports in ${changed} file${changed === 1 ? "" : "s"}.`);
}

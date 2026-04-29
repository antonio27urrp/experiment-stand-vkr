import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeResult } from "./result-writer.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const ignoredDirs = new Set(["node_modules", "dist", ".next", ".turbo", "coverage"]);

const architectureRoots = {
  "spa-redux": ["apps/spa-redux/src"],
  "micro-frontends": [
    "apps/micro-shell/src",
    "apps/micro-list/src",
    "apps/micro-detail/src",
    "apps/micro-crud/src"
  ],
  "ssr-csr": ["apps/ssr-csr/pages"],
  jamstack: ["apps/jamstack/pages"]
};

const buildRoots = {
  "spa-redux": ["apps/spa-redux/dist/assets"],
  "micro-frontends": [
    "apps/micro-shell/dist/assets",
    "apps/micro-list/dist/assets",
    "apps/micro-detail/dist/assets",
    "apps/micro-crud/dist/assets"
  ],
  "ssr-csr": ["apps/ssr-csr/.next/static/chunks"],
  jamstack: ["apps/jamstack/.next/static/chunks"]
};

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch (_error) {
    return false;
  }
}

async function collectFiles(root, predicate) {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath, predicate)));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
}

function countLoc(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("//"))
    .length;
}

function countDependencyEdges(source) {
  const staticImports = source.match(/^\s*import\s.+?from\s+["'][^"']+["']/gm) ?? [];
  const sideEffectImports = source.match(/^\s*import\s+["'][^"']+["']/gm) ?? [];
  const dynamicImports = source.match(/\bimport\s*\(\s*["'][^"']+["']\s*\)/g) ?? [];
  return staticImports.length + sideEffectImports.length + dynamicImports.length;
}

async function analyzeArchitecture(architecture, roots) {
  const sourceFiles = (
    await Promise.all(
      roots.map((root) =>
        collectFiles(path.join(workspaceRoot, root), (filePath) => sourceExtensions.has(path.extname(filePath)))
      )
    )
  ).flat();

  let codeLoc = 0;
  let dependencyEdges = 0;

  for (const filePath of sourceFiles) {
    const source = await fs.readFile(filePath, "utf8");
    codeLoc += countLoc(source);
    dependencyEdges += countDependencyEdges(source);
  }

  const buildChunkFiles = (
    await Promise.all(
      (buildRoots[architecture] ?? []).map((root) =>
        collectFiles(path.join(workspaceRoot, root), (filePath) => path.extname(filePath) === ".js")
      )
    )
  ).flat();

  return {
    codeLoc,
    moduleCount: sourceFiles.length,
    dependencyEdges,
    avgDependenciesPerModule: sourceFiles.length ? dependencyEdges / sourceFiles.length : 0,
    buildChunkCount: buildChunkFiles.length
  };
}

const architectureFilter = getArg("architecture", "all");
const selectedArchitectures =
  architectureFilter === "all" ? Object.keys(architectureRoots) : architectureFilter.split(",").map((item) => item.trim());

for (const architecture of selectedArchitectures) {
  const roots = architectureRoots[architecture];

  if (!roots) {
    throw new Error(`Unknown architecture: ${architecture}`);
  }

  const metrics = await analyzeArchitecture(architecture, roots);
  const result = {
    architecture,
    dataSize: 0,
    users: 0,
    run: 0,
    mode: "code-scalability",
    metrics,
    environment: {
      sourceRoots: roots,
      buildRoots: buildRoots[architecture] ?? []
    },
    timestamp: new Date().toISOString()
  };

  const filePath = await writeResult(result);
  console.log(`Saved ${filePath}`);
}

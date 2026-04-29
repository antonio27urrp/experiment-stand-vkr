import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendApiUrl, benchmarkTargets } from "./config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function parseList(value, fallback) {
  if (!value || value === "all") {
    return fallback;
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
  }

  throw lastError;
}

async function assertHttpOk(url, title) {
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    throw new Error(`${title} is not available at ${url} (HTTP ${response.status})`);
  }
}

async function assertFileExists(relativePath, title) {
  const filePath = path.join(workspaceRoot, relativePath);

  try {
    await fs.access(filePath);
  } catch (_error) {
    throw new Error(`${title} is missing: ${relativePath}`);
  }
}

async function checkBackend() {
  await assertHttpOk(`${backendApiUrl}/health`, "Backend health endpoint");
}

async function checkFrontendTargets(selectedArchitectures) {
  const selectedTargets = benchmarkTargets.filter((target) => selectedArchitectures.includes(target.architecture));
  for (const target of selectedTargets) {
    await assertHttpOk(target.url, `Frontend target (${target.architecture})`);
  }
}

async function checkBuildArtifacts(selectedArchitectures) {
  const checks = [];

  if (selectedArchitectures.includes("spa-redux")) {
    checks.push(assertFileExists("apps/spa-redux/dist/index.html", "spa-redux production build"));
  }

  if (selectedArchitectures.includes("micro-frontends")) {
    checks.push(assertFileExists("apps/micro-shell/dist/index.html", "micro-shell production build"));
    checks.push(assertFileExists("apps/micro-list/dist/assets/remoteEntry.js", "micro-list remoteEntry"));
    checks.push(assertFileExists("apps/micro-detail/dist/assets/remoteEntry.js", "micro-detail remoteEntry"));
    checks.push(assertFileExists("apps/micro-crud/dist/assets/remoteEntry.js", "micro-crud remoteEntry"));
  }

  if (selectedArchitectures.includes("ssr-csr")) {
    checks.push(assertFileExists("apps/ssr-csr/.next/BUILD_ID", "ssr-csr Next.js build"));
  }

  if (selectedArchitectures.includes("jamstack")) {
    checks.push(assertFileExists("apps/jamstack/.next/BUILD_ID", "jamstack Next.js build"));
  }

  await Promise.all(checks);
}

async function checkMicroFrontendsRemotes(selectedArchitectures) {
  if (!selectedArchitectures.includes("micro-frontends")) {
    return;
  }

  const remotes = [
    "http://localhost:5111/assets/remoteEntry.js",
    "http://localhost:5112/assets/remoteEntry.js",
    "http://localhost:5113/assets/remoteEntry.js"
  ];

  for (const remoteUrl of remotes) {
    await assertHttpOk(remoteUrl, "Micro frontend remoteEntry");
  }
}

const selectedArchitectures = parseList(
  getArg("architectures", "all"),
  benchmarkTargets.map((target) => target.architecture)
);

for (const architecture of selectedArchitectures) {
  if (!benchmarkTargets.some((target) => target.architecture === architecture)) {
    throw new Error(`Unknown architecture in preflight: ${architecture}`);
  }
}

console.log("Preflight checks started...");
console.log(`Architectures: ${selectedArchitectures.join(", ")}`);

await checkBackend();
await checkFrontendTargets(selectedArchitectures);
await checkBuildArtifacts(selectedArchitectures);
await checkMicroFrontendsRemotes(selectedArchitectures);

console.log("Preflight checks passed.");

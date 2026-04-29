import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { backendApiUrl, benchmarkTargets, experimentMatrix, reportsDir, resultsDir } from "./config.js";
import { collectRuntimeMetadata } from "./runtime-metadata.js";

const defaultScenarios = ["user-flow"];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function parseList(value, fallback) {
  if (!value || value === "all") {
    return fallback;
  }

  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseNumberList(value, fallback) {
  return parseList(value, fallback.map(String)).map(Number);
}

function parseIntegerArg(name, fallback) {
  const value = Number(getArg(name, fallback));

  if (!Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer`);
  }

  return value;
}

function hashSeed(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed(items, seed) {
  const random = seededRandom(seed);
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function reportScenarioName(scenario) {
  return scenario === "user-flow" ? "common-user-flow" : scenario;
}

function runNodeScript(scriptName, args, options = {}) {
  const command = [scriptName, ...args];

  if (options.dryRun) {
    console.log(`[dry-run] node ${command.join(" ")}`);
    return;
  }

  const result = spawnSync(process.execPath, command, {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    throw new Error(`Command failed: node ${command.join(" ")}`);
  }
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await new Promise((resolve) => {
          setTimeout(resolve, 250 * attempt);
        });
      }
    }
  }

  throw lastError;
}

async function ensureTargetAvailable(target, options = {}) {
  if (options.dryRun) {
    return;
  }

  try {
    const response = await fetchWithRetry(target.url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Target ${target.architecture} is not available at ${target.url}: ${error.message}`);
  }
}

async function reseedDataset(dataSize, options = {}) {
  const seedUrl = `${backendApiUrl}/seed?size=${dataSize}`;

  if (options.dryRun) {
    console.log(`[dry-run] POST ${seedUrl}`);
    return;
  }

  const response = await fetchWithRetry(seedUrl, { method: "POST" });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Dataset reseed failed for size=${dataSize}: HTTP ${response.status} ${message}`);
  }

  const payload = await response.json();
  console.log(`Dataset reseeded: size=${payload.size}, count=${payload.count}`);
}

async function ensureBackendAvailable(options = {}) {
  if (options.dryRun) {
    return;
  }

  try {
    const response = await fetchWithRetry(`${backendApiUrl}/health`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Backend API is not available at ${backendApiUrl}: ${error.message}`);
  }
}

async function clearJsonFiles(directoryPath, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] clear *.json in ${directoryPath}`);
    return;
  }

  await fs.mkdir(directoryPath, { recursive: true });
  const files = await fs.readdir(directoryPath);
  const jsonFiles = files.filter((name) => name.endsWith(".json"));
  await Promise.all(jsonFiles.map((name) => fs.unlink(path.join(directoryPath, name))));
  console.log(`Cleared ${jsonFiles.length} JSON files in ${directoryPath}`);
}

async function archiveJsonFiles(directoryPath, archiveRootDir, archiveLabel, options = {}) {
  if (options.dryRun) {
    console.log(`[dry-run] archive *.json from ${directoryPath} to ${archiveRootDir}`);
    return;
  }

  await fs.mkdir(directoryPath, { recursive: true });
  await fs.mkdir(archiveRootDir, { recursive: true });

  const files = await fs.readdir(directoryPath);
  const jsonFiles = files.filter((name) => name.endsWith(".json"));

  if (jsonFiles.length === 0) {
    console.log(`No JSON files to archive in ${directoryPath}`);
    return;
  }

  const targetDir = path.join(archiveRootDir, archiveLabel);
  await fs.mkdir(targetDir, { recursive: true });

  for (const fileName of jsonFiles) {
    const from = path.join(directoryPath, fileName);
    const to = path.join(targetDir, fileName);
    await fs.rename(from, to);
  }

  console.log(`Archived ${jsonFiles.length} JSON files from ${directoryPath} to ${targetDir}`);
}

async function writeRunManifest(manifest, options = {}) {
  const archiveRoot = path.resolve(path.dirname(resultsDir), "archive");
  const manifestsDir = path.join(archiveRoot, "manifests");
  const filePath = path.join(manifestsDir, `${manifest.seriesId}.json`);

  if (options.dryRun) {
    console.log(`[dry-run] write run manifest ${filePath}`);
    return filePath;
  }

  await fs.mkdir(manifestsDir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(manifest, null, 2), "utf8");
  return filePath;
}

function loadBaseManifestForPipeline(seriesId) {
  const archiveRoot = path.resolve(path.dirname(resultsDir), "archive");
  const filePath = path.join(archiveRoot, "manifests", `${seriesId}.json`);
  if (!existsSync(filePath)) {
    throw new Error(
      `executionMode=pipeline: manifest for series not found: ${filePath} (set --seriesId= to a completed series, e.g. from experiments/archive/manifests).`
    );
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function matrixKey(list) {
  return [...list].map(String).sort().join("\0");
}

/**
 * Matrix fields that must match across pipeline phases (mode may differ: scenario, load, page-load).
 */
function matrixMatchesWithBase(a, b) {
  if (matrixKey(a.architectures) !== matrixKey(b.architectures)) {
    return false;
  }
  if (matrixKey(a.scenarios) !== matrixKey(b.scenarios)) {
    return false;
  }
  if (a.dataSizes.join(",") !== b.dataSizes.join(",")) {
    return false;
  }
  if (a.users.join(",") !== b.users.join(",")) {
    return false;
  }
  if (a.runs !== b.runs) {
    return false;
  }
  if (a.warmupRuns !== b.warmupRuns) {
    return false;
  }
  return true;
}

function printPlan(plan) {
  const measuredInvocations =
    plan.architectures.length * plan.scenarios.length * plan.dataSizes.length * plan.users.length * plan.runs;
  const warmupInvocations =
    plan.architectures.length * plan.scenarios.length * plan.dataSizes.length * plan.users.length * plan.warmupRuns;

  console.log("Experiment plan:");
  console.log(`  mode: ${plan.mode}`);
  console.log(`  architectures: ${plan.architectures.join(", ")}`);
  console.log(`  scenarios: ${plan.scenarios.join(", ")}`);
  console.log(`  dataSizes: ${plan.dataSizes.join(", ")}`);
  console.log(`  users: ${plan.users.join(", ")}`);
  console.log(`  runs per cell: ${plan.runs}`);
  console.log(`  warmup runs per cell: ${plan.warmupRuns}`);
  console.log(`  clean results before run: ${plan.cleanResults}`);
  console.log(`  clean reports before run: ${plan.cleanReports}`);
  console.log(`  archive before clean: ${plan.archiveBeforeClean}`);
  console.log(`  skip preflight checks: ${plan.skipPreflight}`);
  console.log(`  strict main mode: ${plan.strictMain}`);
  console.log(`  executionMode: ${plan.executionMode}`);
  if (plan.seriesId) {
    console.log(`  seriesId: ${plan.seriesId}`);
  }
  console.log(`  skipMemoryGate (export): ${plan.skipMemoryGate}`);
  console.log(`  recoveryMode: ${plan.recoveryMode}`);
  console.log(`  skipRuntimeGate (export): ${plan.skipRuntimeGate}`);
  if (plan.maxFreeMemorySpreadMb != null && plan.maxFreeMemorySpreadMb !== "") {
    console.log(`  maxFreeMemorySpreadMb (export, legacy): ${plan.maxFreeMemorySpreadMb}`);
  }
  if (plan.maxHeapMemoryMbSpread != null && plan.maxHeapMemoryMbSpread !== "") {
    console.log(`  maxHeapMemoryMbSpread (export): ${plan.maxHeapMemoryMbSpread}`);
  }
  console.log(`  allowPilot: ${plan.allowPilot}`);
  console.log(`  measured invocations: ${measuredInvocations}`);
  console.log(`  warmup invocations: ${warmupInvocations}`);
  console.log(`  total runner invocations: ${measuredInvocations + warmupInvocations}`);
  console.log(`  dryRun: ${plan.dryRun}`);
  if (plan.mode === "load") {
    console.log(`  maxConcurrency (parallel browser contexts): ${plan.maxConcurrency}`);
  }
}

const selectedArchitectureNames = parseList(
  getArg("architectures", "all"),
  benchmarkTargets.map((target) => target.architecture)
);
const selectedTargets = benchmarkTargets.filter((target) => selectedArchitectureNames.includes(target.architecture));

if (selectedTargets.length !== selectedArchitectureNames.length) {
  const known = benchmarkTargets.map((target) => target.architecture).join(", ");
  throw new Error(`Unknown architecture in "${selectedArchitectureNames.join(", ")}". Known: ${known}`);
}

const plan = {
  mode: getArg("mode", "scenario"),
  architectures: selectedTargets.map((target) => target.architecture),
  scenarios: parseList(getArg("scenarios", defaultScenarios.join(",")), defaultScenarios),
  dataSizes: parseNumberList(getArg("dataSizes", "10000"), [10000]),
  users: parseNumberList(getArg("users", "50"), [50]),
  runs: parseIntegerArg("runs", experimentMatrix.runs),
  warmupRuns: parseIntegerArg("warmupRuns", 3),
  cleanResults: getArg("cleanResults", "false") === "true",
  cleanReports: getArg("cleanReports", "false") === "true",
  archiveBeforeClean: getArg("archiveBeforeClean", "true") !== "false",
  skipPreflight: getArg("skipPreflight", "false") === "true",
  strictMain: getArg("strictMain", "true") !== "false",
  allowPilot: getArg("allowPilot", "false") === "true",
  dryRun: getArg("dryRun", "false") === "true",
  executionMode: getArg("executionMode", "single"),
  seriesId: getArg("seriesId", null),
  recoveryMode: getArg("recoveryMode", "false") === "true",
  skipMemoryGate: getArg("skipMemoryGate", "false") === "true",
  skipRuntimeGate: getArg("skipRuntimeGate", "false") === "true",
  maxFreeMemorySpreadMb: getArg("maxFreeMemorySpreadMb", null),
  maxHeapMemoryMbSpread: getArg("maxHeapMemoryMbSpread", null),
  maxConcurrency: parseIntegerArg("maxConcurrency", 10)
};

function exportMetricsSummaryExtraArgs(p) {
  const extra = [];
  if (p.skipMemoryGate) {
    extra.push("--skipMemoryGate=true");
  }
  if (p.skipRuntimeGate) {
    extra.push("--skipRuntimeGate=true");
  }
  if (p.maxFreeMemorySpreadMb != null && p.maxFreeMemorySpreadMb !== "") {
    extra.push(`--maxFreeMemorySpreadMb=${p.maxFreeMemorySpreadMb}`);
  }
  if (p.maxHeapMemoryMbSpread != null && p.maxHeapMemoryMbSpread !== "") {
    extra.push(`--maxHeapMemoryMbSpread=${p.maxHeapMemoryMbSpread}`);
  }
  if (p.recoveryMode) {
    extra.push("--recoveryMode=true");
  }
  return extra;
}

if (!["scenario", "load", "page-load"].includes(plan.mode)) {
  throw new Error('--mode must be either "scenario", "load" or "page-load"');
}

if (!["single", "pipeline"].includes(plan.executionMode)) {
  throw new Error('--executionMode must be "single" or "pipeline"');
}

if (plan.runs < 15 && !plan.allowPilot) {
  throw new Error("--runs must be at least 15 for the main experiment. Use --allowPilot=true only for smoke checks.");
}

if (plan.warmupRuns < 0) {
  throw new Error("--warmupRuns must be >= 0");
}

let baseManifest = null;
if (plan.executionMode === "pipeline" && (!plan.cleanResults || !plan.cleanReports)) {
  if (!plan.seriesId) {
    throw new Error(
      'executionMode=pipeline with --cleanResults=false and/or --cleanReports=false requires --seriesId=... (manifest of the series in experiments/archive/manifests) so phases share one seriesId and matrix is validated.'
    );
  }
  baseManifest = loadBaseManifestForPipeline(plan.seriesId);
  if (!matrixMatchesWithBase(plan, baseManifest.plan)) {
    const msg =
      "executionMode=pipeline: current --architectures/--scenarios/--dataSizes/--users/--runs/--warmupRuns do not match the plan stored in the manifest for this --seriesId.";
    throw new Error(msg);
  }
  console.log(
    `Pipeline continuation: seriesId=${plan.seriesId} (matrix matches manifest; phase=${plan.mode}, strictMain=${plan.strictMain}, cleanResults=${plan.cleanResults}, cleanReports=${plan.cleanReports})`
  );
  console.log(
    "This run appends to the same series: scenario phase is assumed to exist in results/reports; you are running a follow-up phase (load or page-load)."
  );
}

if (plan.strictMain && !plan.allowPilot) {
  if (plan.skipMemoryGate && !plan.recoveryMode) {
    throw new Error(
      "strictMain forbids --skipMemoryGate for final datasets. Use --recoveryMode=true only for recovery reruns."
    );
  }
  if (!plan.cleanResults || !plan.cleanReports) {
    if (plan.executionMode !== "pipeline" || !baseManifest) {
      throw new Error(
        "strictMain requires --cleanResults=true and --cleanReports=true for main runs, or use --executionMode=pipeline --seriesId=... with the same matrix as the first-phase manifest to continue without cleaning."
      );
    }
  }

  if (plan.warmupRuns <= 0) {
    throw new Error("strictMain requires --warmupRuns > 0 for main experiment runs.");
  }

  if (plan.skipPreflight) {
    throw new Error("strictMain requires --skipPreflight=false for main experiment runs.");
  }
}

const exportMode =
  plan.mode === "load"
    ? "parallel-playwright-load"
    : plan.mode === "page-load"
      ? "lighthouse-page-load"
      : "single-playwright-scenario";
const exportGroup = plan.mode === "load" ? "concurrency" : plan.mode === "page-load" ? "page-load" : "interaction";

printPlan(plan);

const archiveLabel = new Date().toISOString().replace(/[:.]/g, "-");
const archiveRoot = path.resolve(path.dirname(resultsDir), "archive");
const runSeeds = [];

for (const scenario of plan.scenarios) {
  for (const dataSize of plan.dataSizes) {
    for (const users of plan.users) {
      for (let warmupRun = 1; warmupRun <= plan.warmupRuns; warmupRun += 1) {
        runSeeds.push({
          stage: "warmup",
          scenario,
          dataSize,
          users,
          run: warmupRun,
          seed: hashSeed(`${scenario}:${dataSize}:${users}:warmup:${warmupRun}`)
        });
      }

      for (let run = 1; run <= plan.runs; run += 1) {
        runSeeds.push({
          stage: "measured",
          scenario,
          dataSize,
          users,
          run,
          seed: hashSeed(`${scenario}:${dataSize}:${users}:${run}`)
        });
      }
    }
  }
}

const pipelinePhase = { mode: plan.mode, at: new Date().toISOString() };
const manifest = baseManifest
  ? {
      ...baseManifest,
      plan,
      lastPhaseAt: pipelinePhase.at,
      pipeline: {
        phases: [...(baseManifest.pipeline?.phases || []), pipelinePhase]
      },
      runtime: collectRuntimeMetadata({
        runner: "orchestrator",
        runnerMode: plan.mode
      }),
      seedSchedule: runSeeds
    }
  : {
      seriesId: `series-${archiveLabel}`,
      createdAt: new Date().toISOString(),
      plan,
      pipeline: plan.executionMode === "pipeline" ? { phases: [pipelinePhase] } : undefined,
      runtime: collectRuntimeMetadata({
        runner: "orchestrator",
        runnerMode: plan.mode
      }),
      seedSchedule: runSeeds
    };
const manifestPath = await writeRunManifest(manifest, { dryRun: plan.dryRun });
console.log(`Run manifest: ${manifestPath}`);

if (plan.cleanResults) {
  if (plan.archiveBeforeClean) {
    await archiveJsonFiles(resultsDir, path.join(archiveRoot, "results"), archiveLabel, { dryRun: plan.dryRun });
  }
  await clearJsonFiles(resultsDir, { dryRun: plan.dryRun });
}

if (plan.cleanReports) {
  if (plan.archiveBeforeClean) {
    await archiveJsonFiles(reportsDir, path.join(archiveRoot, "reports"), archiveLabel, { dryRun: plan.dryRun });
  }
  await clearJsonFiles(reportsDir, { dryRun: plan.dryRun });
}

if (!plan.skipPreflight) {
  runNodeScript(
    "src/preflight-check.js",
    [`--architectures=${plan.architectures.join(",")}`],
    { dryRun: plan.dryRun }
  );
}

for (const target of selectedTargets) {
  await ensureTargetAvailable(target, { dryRun: plan.dryRun });
}
await ensureBackendAvailable({ dryRun: plan.dryRun });

for (const scenario of plan.scenarios) {
  for (const dataSize of plan.dataSizes) {
    for (const users of plan.users) {
      for (let warmupRun = 1; warmupRun <= plan.warmupRuns; warmupRun += 1) {
        const warmupSeed = hashSeed(`${scenario}:${dataSize}:${users}:warmup:${warmupRun}`);
        const warmupTargets = shuffleWithSeed(selectedTargets, warmupSeed);
        console.log(
          `Warm-up ${warmupRun}/${plan.warmupRuns} order (seed=${warmupSeed}): ${warmupTargets
            .map((target) => target.architecture)
            .join(" -> ")}`
        );

        for (const target of warmupTargets) {
          await reseedDataset(dataSize, { dryRun: plan.dryRun });
          if (plan.mode === "page-load") {
            runNodeScript(
              "src/run-lighthouse.js",
              [
                `--architecture=${target.architecture}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                "--runs=1",
                "--allowPilot=true",
                `--seriesId=${manifest.seriesId}`,
                "--isWarmup=true"
              ],
              { dryRun: plan.dryRun }
            );
          } else if (plan.mode === "load") {
            runNodeScript(
              "src/run-load.js",
              [
                `--architecture=${target.architecture}`,
                `--scenario=${scenario}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                `--run=${warmupRun}`,
                `--seriesId=${manifest.seriesId}`,
                `--maxConcurrency=${plan.maxConcurrency}`,
                "--isWarmup=true"
              ],
              { dryRun: plan.dryRun }
            );
          } else {
            runNodeScript(
              "src/run-scenario.js",
              [
                `--architecture=${target.architecture}`,
                `--scenario=${scenario}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                `--run=${warmupRun}`,
                `--seriesId=${manifest.seriesId}`,
                "--isWarmup=true"
              ],
              { dryRun: plan.dryRun }
            );
          }
        }
      }

      for (let run = 1; run <= plan.runs; run += 1) {
        const shuffleSeed = hashSeed(`${scenario}:${dataSize}:${users}:${run}`);
        const runTargets = shuffleWithSeed(selectedTargets, shuffleSeed);
        console.log(
          `Run ${run}/${plan.runs} randomized architecture order (seed=${shuffleSeed}): ${runTargets
            .map((target) => target.architecture)
            .join(" -> ")}`
        );

        for (const target of runTargets) {
          await reseedDataset(dataSize, { dryRun: plan.dryRun });
          console.log(
            `Running ${plan.mode}: ${target.architecture}, scenario=${scenario}, dataSize=${dataSize}, users=${users}, run=${run}/${plan.runs}`
          );
          if (plan.mode === "page-load") {
            runNodeScript(
              "src/run-lighthouse.js",
              [
                `--architecture=${target.architecture}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                "--runs=1",
                `--runOffset=${run - 1}`,
                "--allowPilot=true",
                `--seriesId=${manifest.seriesId}`
              ],
              { dryRun: plan.dryRun }
            );
          } else if (plan.mode === "load") {
            runNodeScript(
              "src/run-load.js",
              [
                `--architecture=${target.architecture}`,
                `--scenario=${scenario}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                `--run=${run}`,
                `--seriesId=${manifest.seriesId}`,
                `--maxConcurrency=${plan.maxConcurrency}`
              ],
              { dryRun: plan.dryRun }
            );
          } else {
            runNodeScript(
              "src/run-scenario.js",
              [
                `--architecture=${target.architecture}`,
                `--scenario=${scenario}`,
                `--dataSize=${dataSize}`,
                `--users=${users}`,
                `--run=${run}`,
                `--seriesId=${manifest.seriesId}`
              ],
              { dryRun: plan.dryRun }
            );
          }
        }
      }

      console.log(`Analyzing filtered reports: scenario=${scenario}, dataSize=${dataSize}, users=${users}`);
      const reportScenario = reportScenarioName(scenario);
      runNodeScript(
        "src/analyze-all.js",
        [
          `--scenario=${reportScenario}`,
          `--dataSize=${dataSize}`,
          `--users=${users}`,
          `--mode=${exportMode}`,
          "--runMin=1",
          `--runMax=${plan.runs}`
        ],
        { dryRun: plan.dryRun }
      );
      console.log(`Exporting metrics summary: scenario=${scenario}, dataSize=${dataSize}, users=${users}`);
      runNodeScript(
        "src/export-metrics-summary.js",
        [
          `--scenario=${reportScenario}`,
          `--dataSize=${dataSize}`,
          `--users=${users}`,
          `--mode=${exportMode}`,
          `--group=${exportGroup}`,
          "--runMin=1",
          `--runMax=${plan.runs}`,
          "--format=json",
          ...exportMetricsSummaryExtraArgs(plan)
        ],
        { dryRun: plan.dryRun }
      );
      runNodeScript(
        "src/export-metrics-summary.js",
        [
          `--scenario=${reportScenario}`,
          `--dataSize=${dataSize}`,
          `--users=${users}`,
          `--mode=${exportMode}`,
          `--group=${exportGroup}`,
          "--runMin=1",
          `--runMax=${plan.runs}`,
          "--format=csv",
          ...exportMetricsSummaryExtraArgs(plan)
        ],
        { dryRun: plan.dryRun }
      );
    }
  }
}

console.log("Experiment finished.");

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const metricsByMode = {
  "single-playwright-scenario": [
    "requests",
    "memoryMb",
    "scenarioDurationMs",
    "longTasksCount",
    "maxTaskDuration",
    "totalLongTaskDuration",
    "webVitalsLcp",
    "webVitalsFcp",
    "webVitalsCls",
    "webVitalsInp",
    "webVitalsTtfb",
    "mfWaterfallRequests",
    "mfWaterfallDurationMs",
    "mfRemoteEntryRequests",
    "mfRemoteScriptRequests",
    "mfBackendRequests",
    "mfTimeToFirstModuleMs",
    "mfCompositionTimeMs"
  ],
  "parallel-playwright-load": [
    "requests",
    "memoryMb",
    "scenarioDurationMs",
    "p95ScenarioDurationMs",
    "wallClockDurationMs",
    "scenarioDurationMsFailurePenalized",
    "p95ScenarioDurationMsFailurePenalized",
    "wallClockDurationMsFailurePenalized",
    "successfulSessions",
    "failedSessions",
    "successRate",
    "longTasksCount",
    "maxTaskDuration",
    "totalLongTaskDuration",
    "webVitalsLcp",
    "webVitalsFcp",
    "webVitalsCls",
    "webVitalsInp",
    "webVitalsTtfb"
  ],
  "lighthouse-page-load": [
    "lcp",
    "fcp",
    "tti",
    "tbt",
    "cls",
    "jsBundleKb",
    "totalByteWeightKb",
    "requests",
    "performanceScore"
  ]
};
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extraArgs = process.argv.slice(2);
const modeArg = extraArgs.find((arg) => arg.startsWith("--mode="));
const mode = modeArg ? modeArg.slice("--mode=".length) : null;

if (!mode || !metricsByMode[mode]) {
  throw new Error(
    `--mode is required and must be one of: ${Object.keys(metricsByMode).join(", ")}`
  );
}

for (const metric of metricsByMode[mode]) {
  const result = spawnSync(process.execPath, ["src/analyze-results.js", `--metric=${metric}`, ...extraArgs], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

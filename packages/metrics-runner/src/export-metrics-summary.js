import fs from "node:fs/promises";
import path from "node:path";
import { mean, median, quantile, sampleStandardDeviation } from "simple-statistics";
import { experimentMatrix, reportsDir, resultsDir } from "./config.js";

const metricsByGroup = {
  "page-load": [
    "lcp",
    "fcp",
    "tti",
    "tbt",
    "cls",
    "jsBundleKb",
    "totalByteWeightKb",
    "requests",
    "performanceScore"
  ],
  interaction: [
    "scenarioDurationMs",
    "longTasksCount",
    "maxTaskDuration",
    "totalLongTaskDuration",
    "memoryMb",
    "requests",
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
  concurrency: [
    "scenarioDurationMs",
    "p95ScenarioDurationMs",
    "maxScenarioDurationMs",
    "wallClockDurationMs",
    "scenarioDurationMsFailurePenalized",
    "p95ScenarioDurationMsFailurePenalized",
    "wallClockDurationMsFailurePenalized",
    "successfulSessions",
    "failedSessions",
    "successRate",
    "requests",
    "memoryMb",
    "longTasksCount",
    "maxTaskDuration",
    "totalLongTaskDuration"
  ],
  "code-scalability": [
    "codeLoc",
    "moduleCount",
    "dependencyEdges",
    "avgDependenciesPerModule",
    "buildChunkCount"
  ]
};

const metrics = [
  "lcp",
  "fcp",
  "tti",
  "tbt",
  "cls",
  "jsBundleKb",
  "totalByteWeightKb",
  "performanceScore",
  "requests",
  "memoryMb",
  "scenarioDurationMs",
  "p95ScenarioDurationMs",
  "maxScenarioDurationMs",
  "wallClockDurationMs",
  "scenarioDurationMsFailurePenalized",
  "p95ScenarioDurationMsFailurePenalized",
  "wallClockDurationMsFailurePenalized",
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
  "mfCompositionTimeMs",
  "successfulSessions",
  "failedSessions",
  "successRate",
  "codeLoc",
  "moduleCount",
  "dependencyEdges",
  "avgDependenciesPerModule",
  "buildChunkCount"
];

const pageLoadMetrics = new Set(metricsByGroup["page-load"]);
const codeScalabilityMetrics = new Set(metricsByGroup["code-scalability"]);

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function parseIntegerArg(name, fallback) {
  const value = Number(getArg(name, fallback));

  if (!Number.isInteger(value)) {
    throw new Error(`--${name} must be an integer`);
  }

  return value;
}

function validateResult(result, options) {
  if (!result.mode) {
    return "missing-mode";
  }

  if (result.status === "stalled") {
    return "stalled-run";
  }

  if (!Number.isInteger(result.run)) {
    return "invalid-run";
  }

  if (result.run < options.runMin || result.run > options.runMax) {
    return "run-out-of-range";
  }

  return null;
}

function matchesFilters(result, filters) {
  if (filters.scenario && result.scenario !== filters.scenario) {
    return false;
  }

  if (filters.dataSize && result.dataSize !== Number(filters.dataSize)) {
    return false;
  }

  if (filters.users && result.users !== Number(filters.users)) {
    return false;
  }

  if (filters.mode && result.mode !== filters.mode) {
    return false;
  }

  return true;
}

function matchesDataFilters(result, filters) {
  if (filters.dataSize && result.dataSize !== Number(filters.dataSize)) {
    return false;
  }

  if (filters.users && result.users !== Number(filters.users)) {
    return false;
  }

  if (filters.mode && result.mode !== filters.mode) {
    return false;
  }

  return true;
}

function matchesPageLoadFilters(result, filters) {
  if (filters.dataSize && result.dataSize !== Number(filters.dataSize)) {
    return false;
  }

  if (filters.users && result.users !== Number(filters.users)) {
    return false;
  }

  if (filters.mode && result.mode !== filters.mode) {
    return false;
  }

  return true;
}

function getMetric(result, metric) {
  const value = result.metrics?.[metric];
  return typeof value === "number" ? value : null;
}

function summarize(values) {
  const numericValues = values.filter((value) => typeof value === "number" && Number.isFinite(value));

  if (!numericValues.length) {
    return {
      n: 0,
      mean: null,
      median: null,
      sd: null,
      p75: null,
      p95: null,
      min: null,
      max: null
    };
  }

  return {
    n: numericValues.length,
    mean: mean(numericValues),
    median: median(numericValues),
    sd: numericValues.length > 1 ? sampleStandardDeviation(numericValues) : 0,
    p75: quantile(numericValues, 0.75),
    p95: quantile(numericValues, 0.95),
    min: Math.min(...numericValues),
    max: Math.max(...numericValues)
  };
}

function assertSingleGitCommit(results) {
  const commitSet = new Set(
    results
      .map((result) => result.runtime?.gitCommit)
      .filter((value) => typeof value === "string" && value.length > 0)
  );

  if (commitSet.size > 1) {
    throw new Error(`Runtime quality gate failed: mixed git commits detected (${[...commitSet].join(", ")}).`);
  }
}

/**
 * Diagnostic only (never throws): spread of `metrics.memoryMb` (JS heap) across runs —
 * comparable frontend signal vs host free RAM.
 */
function evaluateHeapMemoryStabilityAcrossRuns(results, thresholdSpreadMb) {
  const byArchitecture = {};
  for (const result of results) {
    const mb = result.metrics?.memoryMb;
    if (!Number.isFinite(mb)) {
      continue;
    }
    if (!byArchitecture[result.architecture]) {
      byArchitecture[result.architecture] = [];
    }
    byArchitecture[result.architecture].push(mb);
  }

  /** @type {Record<string, { memoryGate: string, status?: string|null, heapSpreadMbAcrossRuns?: number|null, heapMemoryMbSpreadThresholdMb?: number }>} */
  const out = {};

  for (const [architecture, values] of Object.entries(byArchitecture)) {
    if (values.length < 2) {
      out[architecture] = {
        memoryGate: "skipped",
        status: null,
        sampleCount: values.length,
        heapMemoryMbMean: values.length ? mean(values) : null,
        heapMemoryMbMedian: values.length ? median(values) : null,
        heapMemoryMbSd: values.length > 1 ? sampleStandardDeviation(values) : 0,
        heapMemoryMbP95: values.length ? quantile(values, 0.95) : null,
        heapMemoryMbSpreadAcrossRuns: null,
        heapMemoryMbSpreadThresholdMb: thresholdSpreadMb,
        skipReason: "fewer_than_two_measurements_with_memoryMb"
      };
      continue;
    }

    const min = Math.min(...values);
    const max = Math.max(...values);
    const spread = max - min;

    const violated = spread > thresholdSpreadMb;
    out[architecture] = {
      memoryGate: violated ? "violated" : "passed",
      status: violated ? "unstable" : "stable",
      sampleCount: values.length,
      heapMemoryMbMean: mean(values),
      heapMemoryMbMedian: median(values),
      heapMemoryMbSd: values.length > 1 ? sampleStandardDeviation(values) : 0,
      heapMemoryMbP95: quantile(values, 0.95),
      heapMemoryMbSpreadAcrossRuns: spread,
      heapMemoryMbSpreadThresholdMb: thresholdSpreadMb,
      heapMemoryMbAcrossRunsMin: min,
      heapMemoryMbAcrossRunsMax: max
    };
  }

  return out;
}

function checkSeriesConsistency(results) {
  const seriesSet = new Set(
    results
      .map((result) => result.seriesId)
      .filter((value) => typeof value === "string" && value.length > 0)
  );
  const missingSeriesCount = results.filter((result) => !result.seriesId).length;

  if (missingSeriesCount > 0) {
    throw new Error(`Quality gate failed: ${missingSeriesCount} samples have no seriesId.`);
  }

  if (seriesSet.size > 1) {
    throw new Error(`Quality gate failed: mixed seriesId values detected (${[...seriesSet].join(", ")}).`);
  }
}

/**
 * When the same (architecture, run, …) appears twice (e.g. pipeline re-ran a cell),
 * keep the row with the latest `timestamp` so export stays strict and matrix-complete.
 * `scenario` is part of the key (empty for page-load only payloads).
 */
function dedupeByRunMatrixKey(list) {
  const byKey = new Map();
  for (const result of list) {
    const key = `${result.architecture}\0${result.run}\0${result.dataSize}\0${result.users}\0${result.mode}\0${result.scenario ?? ""}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, result);
      continue;
    }
    const tNew = result.timestamp && String(result.timestamp) > (current.timestamp && String(current.timestamp)) ? 1 : 0;
    if (tNew > 0) {
      byKey.set(key, result);
    }
  }
  return [...byKey.values()];
}

function checkRunMatrixCompleteness(results, architectures, runMin, runMax) {
  const runCountExpected = runMax - runMin + 1;
  const runMapByArchitecture = new Map(
    architectures.map((architecture) => [architecture, new Map()])
  );

  for (const result of results) {
    const runValue = result.run;
    if (!Number.isInteger(runValue) || runValue < runMin || runValue > runMax) {
      continue;
    }

    const architectureMap = runMapByArchitecture.get(result.architecture);
    if (!architectureMap) {
      continue;
    }

    architectureMap.set(runValue, (architectureMap.get(runValue) ?? 0) + 1);
  }

  const errors = [];
  for (const [architecture, runMap] of runMapByArchitecture.entries()) {
    const missingRuns = [];
    const duplicateRuns = [];

    for (let run = runMin; run <= runMax; run += 1) {
      const occurrences = runMap.get(run) ?? 0;
      if (occurrences === 0) {
        missingRuns.push(run);
      } else if (occurrences > 1) {
        duplicateRuns.push(`${run}x${occurrences}`);
      }
    }

    if (missingRuns.length || duplicateRuns.length || runMap.size !== runCountExpected) {
      errors.push({
        architecture,
        missingRuns,
        duplicateRuns
      });
    }
  }

  if (errors.length > 0) {
    const details = errors
      .map(
        (error) =>
          `${error.architecture} missing=[${error.missingRuns.join(",")}], duplicates=[${error.duplicateRuns.join(",")}]`
      )
      .join("; ");
    throw new Error(`Quality gate failed: run matrix is incomplete or duplicated. ${details}`);
  }
}

function round(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return value;
  }

  return Math.round(value * 1000) / 1000;
}

function sanitizeFilePart(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function makeFilterSuffix(filters) {
  return Object.entries(filters)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}-${sanitizeFilePart(value)}`)
    .join("-");
}

function toCsv(rows) {
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value) => {
    if (value === null || value === undefined) {
      return "";
    }

    const stringValue = String(value);
    return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  };

  return [headers.join(","), ...rows.map((row) => headers.map((header) => escape(row[header])).join(","))].join("\n");
}

function toMarkdown(rows) {
  const headers = Object.keys(rows[0] ?? {});

  if (!headers.length) {
    return "No data.\n";
  }

  const header = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${headers.map((key) => row[key] ?? "").join(" | ")} |`);

  return [header, separator, ...body].join("\n");
}

const filters = {
  scenario: getArg("scenario"),
  dataSize: getArg("dataSize"),
  users: getArg("users"),
  mode: getArg("mode"),
  group: getArg("group", "all")
};
const strict = getArg("strict", "true") !== "false";
const skipRuntimeGate = getArg("skipRuntimeGate", "false") === "true";
const skipMemoryGate = getArg("skipMemoryGate", "false") === "true";
const recoveryMode = getArg("recoveryMode", "false") === "true";
function resolveHeapSpreadThresholdMbArg() {
  const heapMbArg = getArg("maxHeapMemoryMbSpread", null);
  const legacyHostArg = getArg("maxFreeMemorySpreadMb", null);
  const raw = heapMbArg ?? legacyHostArg ?? "512";
  const n = Number(raw);
  if (!Number.isInteger(n)) {
    throw new Error(
      "--maxHeapMemoryMbSpread must be an integer MB threshold for spread(metrics.memoryMb) across runs (legacy CLI: maxFreeMemorySpreadMb is aliased)."
    );
  }
  return n;
}
const maxHeapMemoryMbSpread = resolveHeapSpreadThresholdMbArg();
const runMin = parseIntegerArg("runMin", 1);
const runMax = parseIntegerArg("runMax", experimentMatrix.runs);
const format = getArg("format", "json");

if (!["json", "csv", "md"].includes(format)) {
  throw new Error("--format must be one of: json, csv, md");
}

if (!["all", ...Object.keys(metricsByGroup)].includes(filters.group)) {
  throw new Error(`--group must be one of: all, ${Object.keys(metricsByGroup).join(", ")}`);
}

if (runMin < 1 || runMax < runMin) {
  throw new Error("Invalid run range. Expected 1 <= runMin <= runMax.");
}

if (maxHeapMemoryMbSpread < 0) {
  throw new Error("--maxHeapMemoryMbSpread must be >= 0");
}

if ((filters.group === "interaction" || filters.group === "concurrency") && !filters.mode) {
  throw new Error(`--mode is required for group=${filters.group} to avoid mode mixing.`);
}

if (filters.group === "page-load" && !filters.mode) {
  throw new Error("--mode=lighthouse-page-load is required for group=page-load.");
}

const selectedMetrics = filters.group === "all" ? metrics : metricsByGroup[filters.group];

const files = await fs.readdir(resultsDir);
const resultsPre = [];
const pageLoadResultsPre = [];
const codeResults = [];
const rejected = {
  "missing-mode": 0,
  "stalled-run": 0,
  "invalid-run": 0,
  "run-out-of-range": 0
};

for (const file of files.filter((name) => name.endsWith(".json"))) {
  const result = JSON.parse(await fs.readFile(path.join(resultsDir, file), "utf8"));
  const isCodeScalability = result.mode === "code-scalability";

  if (!isCodeScalability) {
    const rejectionReason = validateResult(result, { runMin, runMax });
    if (rejectionReason) {
      rejected[rejectionReason] += 1;
      continue;
    }
  }

  if (isCodeScalability) {
    codeResults.push(result);
  }

  if (result.scenario && matchesFilters(result, filters)) {
    resultsPre.push(result);
  }

  if (result.mode === "lighthouse-page-load" && matchesPageLoadFilters(result, filters)) {
    pageLoadResultsPre.push(result);
  }
}

const results = dedupeByRunMatrixKey(resultsPre);
const pageLoadResults = dedupeByRunMatrixKey(pageLoadResultsPre);

const architectureSources =
  filters.group === "code-scalability"
    ? [codeResults]
    : filters.group === "page-load"
      ? [pageLoadResults]
      : filters.group === "interaction" || filters.group === "concurrency"
        ? [results]
        : [results, pageLoadResults, codeResults];
const allArchitectureNames = new Set(architectureSources.flat().map((result) => result.architecture));
const grouped = [...allArchitectureNames].reduce((groups, architecture) => {
  groups[architecture] = {
    scenario: results.filter((result) => result.architecture === architecture),
    pageLoad: pageLoadResults.filter((result) => result.architecture === architecture),
    code: codeResults.filter((result) => result.architecture === architecture)
  };
  return groups;
}, {});

const rows = Object.entries(grouped)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([architecture, architectureResults]) => {
    const scenarioResults =
      filters.group === "page-load" || filters.group === "code-scalability" ? [] : architectureResults.scenario;
    const architecturePageLoadResults =
      filters.group === "interaction" || filters.group === "concurrency" || filters.group === "code-scalability"
        ? []
        : architectureResults.pageLoad;
    const architectureCodeResults = filters.group === "code-scalability" || filters.group === "all" ? architectureResults.code : [];
    const uniqueSamples = new Set([
      ...scenarioResults.map((result) => result.timestamp),
      ...architecturePageLoadResults.map((result) => result.timestamp),
      ...architectureCodeResults.map((result) => result.timestamp)
    ]);
    const row = {
      architecture,
      samples: uniqueSamples.size,
      scenarioSamples: scenarioResults.length,
      pageLoadSamples: architecturePageLoadResults.length,
      scenario: filters.scenario ?? "mixed",
      dataSize: filters.dataSize ?? "mixed",
      users: filters.users ?? "mixed",
      mode: filters.mode ?? "mixed"
    };

    for (const metric of selectedMetrics) {
      const sourceResults = codeScalabilityMetrics.has(metric)
        ? architectureCodeResults
        : pageLoadMetrics.has(metric)
          ? architecturePageLoadResults
          : scenarioResults;
      const summary = summarize(sourceResults.map((result) => getMetric(result, metric)));
      row[`${metric}_n`] = summary.n;
      row[`${metric}_mean`] = round(summary.mean);
      row[`${metric}_median`] = round(summary.median);
      row[`${metric}_sd`] = round(summary.sd);
      row[`${metric}_p75`] = round(summary.p75);
      row[`${metric}_p95`] = round(summary.p95);
      row[`${metric}_min`] = round(summary.min);
      row[`${metric}_max`] = round(summary.max);
    }

    return row;
  });

if (strict && (filters.group === "interaction" || filters.group === "concurrency" || filters.group === "page-load")) {
  const samplesByArchitecture = rows.map((row) => ({
    architecture: row.architecture,
    samples:
      filters.group === "page-load"
        ? row.pageLoadSamples
        : row.scenarioSamples
  }));
  const distinctCounts = new Set(samplesByArchitecture.map((entry) => entry.samples));

  if (distinctCounts.size > 1 || [...distinctCounts][0] === 0) {
    const details = samplesByArchitecture.map((entry) => `${entry.architecture}:${entry.samples}`).join(", ");
    throw new Error(`Quality gate failed: unbalanced or empty sample counts (${details}).`);
  }

  checkRunMatrixCompleteness(
    filters.group === "page-load" ? pageLoadResults : results,
    Object.keys(grouped),
    runMin,
    runMax
  );

  if (!skipRuntimeGate) {
    const runtimeSourceStrict =
      filters.group === "page-load"
        ? pageLoadResults
        : filters.group === "interaction" || filters.group === "concurrency"
          ? results
          : [];
    checkSeriesConsistency(runtimeSourceStrict);
    assertSingleGitCommit(runtimeSourceStrict);
  }
}

const heapStoryEligibleGroups = new Set(["interaction", "concurrency", "page-load"]);
let heapArchitectureDiagnosticsPayload = {};
if (!skipMemoryGate && heapStoryEligibleGroups.has(filters.group)) {
  const heapSource =
    filters.group === "page-load"
      ? pageLoadResults
      : results;
  heapArchitectureDiagnosticsPayload = evaluateHeapMemoryStabilityAcrossRuns(heapSource, maxHeapMemoryMbSpread);
  for (const row of rows) {
    const diag = heapArchitectureDiagnosticsPayload[row.architecture];
    if (!diag) {
      continue;
    }
    row.memoryGate = diag.memoryGate;
    row.status = diag.status ?? null;
    row.heapMemoryMbN = diag.sampleCount ?? null;
    row.heapMemoryMbMeanAcrossRuns = round(diag.heapMemoryMbMean ?? null);
    row.heapMemoryMbMedianAcrossRuns = round(diag.heapMemoryMbMedian ?? null);
    row.heapMemoryMbSdAcrossRuns = round(diag.heapMemoryMbSd ?? null);
    row.heapMemoryMbP95AcrossRuns = round(diag.heapMemoryMbP95 ?? null);
    row.heapMemoryMbSpreadAcrossRuns = diag.heapMemoryMbSpreadAcrossRuns ?? null;
    row.heapMemoryMbSpreadThresholdMbDiagnostics = diag.heapMemoryMbSpreadThresholdMb ?? null;
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  filters,
  runRange: { runMin, runMax },
  strict,
  runtimeGate: {
    enabled: strict && !skipRuntimeGate,
    diagnostics: {
      skipMemoryDiagnostics: skipMemoryGate,
      recoveryMode,
      heapMbSpreadAcrossRuns: {
        enabled: heapStoryEligibleGroups.has(filters.group) && !skipMemoryGate,
        metricDescription: "max-min of result.metrics.memoryMb (average JS heap per run) across run replicates — comparable across architectures.",
        thresholdSpreadMb: maxHeapMemoryMbSpread,
        legacyCliAlias: "--maxFreeMemorySpreadMb semantics now map to this heap diagnostic (host free RAM is no longer gated)"
      },
      hostFreeRamMb: "no longer enforced on export — was machine noise unrelated to frontend architecture deltas"
    }
  },
  heapArchitectureDiagnostics: skipMemoryGate ? null : heapArchitectureDiagnosticsPayload,
  deduplication: {
    scenario: { before: resultsPre.length, after: results.length },
    pageLoad: { before: pageLoadResultsPre.length, after: pageLoadResults.length }
  },
  group: filters.group,
  rejectedSamples: rejected,
  totalResults: results.length,
  pageLoadResults: pageLoadResults.length,
  codeResults: codeResults.length,
  note: "Page-load, interaction, concurrency and code-scalability metrics are selected with --group to avoid mixing measurement modes.",
  metrics: selectedMetrics,
  rows
};

await fs.mkdir(reportsDir, { recursive: true });
const filterSuffix = makeFilterSuffix(filters);
const fileName = `metrics-summary${filterSuffix ? `-${filterSuffix}` : ""}.${format}`;
const filePath = path.join(reportsDir, fileName);

if (format === "json") {
  await fs.writeFile(filePath, JSON.stringify(report, null, 2), "utf8");
} else if (format === "csv") {
  await fs.writeFile(filePath, toCsv(rows), "utf8");
} else {
  await fs.writeFile(filePath, toMarkdown(rows), "utf8");
}

console.log(`Saved ${filePath}`);
const rawCountForGroup =
  filters.group === "page-load"
    ? pageLoadResults.length
    : filters.group === "code-scalability"
      ? codeResults.length
      : results.length;
console.log(`Rows: ${rows.length}, raw results: ${rawCountForGroup}`);

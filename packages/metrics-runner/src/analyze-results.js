import fs from "node:fs/promises";
import path from "node:path";
import jStatPackage from "jstat";
import { mean, sampleStandardDeviation, tTestTwoSample } from "simple-statistics";
import { experimentMatrix, reportsDir, resultsDir } from "./config.js";

const { jStat } = jStatPackage;

function getMetric(result, metricName) {
  return result.metrics?.[metricName];
}

function groupByArchitecture(results, metricName) {
  return results.reduce((groups, result) => {
    const value = getMetric(result, metricName);

    if (typeof value !== "number") {
      return groups;
    }

    groups[result.architecture] ??= [];
    groups[result.architecture].push(value);
    return groups;
  }, {});
}

function cohensD(a, b) {
  const sdA = sampleStandardDeviation(a);
  const sdB = sampleStandardDeviation(b);
  const pooled = Math.sqrt(((a.length - 1) * sdA ** 2 + (b.length - 1) * sdB ** 2) / (a.length + b.length - 2));
  return (mean(a) - mean(b)) / pooled;
}

function twoTailedPValue(tStatistic, degreesOfFreedom) {
  const probability = jStat.studentt.cdf(Math.abs(tStatistic), degreesOfFreedom);
  const pValue = 2 * (1 - probability);
  return Math.min(Math.max(pValue, 0), 1);
}

function holmBonferroniAdjust(comparisons) {
  const indexed = comparisons
    .map((comparison, index) => ({ index, pValue: comparison.pValue }))
    .sort((left, right) => left.pValue - right.pValue);
  const m = indexed.length;
  const adjusted = new Array(m).fill(1);
  let runningMax = 0;

  for (let i = 0; i < m; i += 1) {
    const raw = indexed[i].pValue;
    const scaled = Math.min(1, raw * (m - i));
    runningMax = Math.max(runningMax, scaled);
    adjusted[i] = runningMax;
  }

  for (let i = 0; i < indexed.length; i += 1) {
    comparisons[indexed[i].index].pValueHolm = adjusted[i];
    comparisons[indexed[i].index].significant05Holm = adjusted[i] < 0.05;
  }
}

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

  if (result.mode !== options.mode) {
    return "mode-mismatch";
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

  return true;
}

const metricName = getArg("metric", "lcp");
const mode = getArg("mode");

if (!mode) {
  throw new Error("--mode is required to prevent mixing measurement modes.");
}

const runMin = parseIntegerArg("runMin", 1);
const runMax = parseIntegerArg("runMax", experimentMatrix.runs);

if (runMin < 1 || runMax < runMin) {
  throw new Error("Invalid run range. Expected 1 <= runMin <= runMax.");
}

const filters = {
  scenario: getArg("scenario"),
  dataSize: getArg("dataSize"),
  users: getArg("users"),
  mode
};
const files = await fs.readdir(resultsDir);
const results = [];
const rejected = {
  "missing-mode": 0,
  "stalled-run": 0,
  "mode-mismatch": 0,
  "invalid-run": 0,
  "run-out-of-range": 0
};

for (const file of files.filter((name) => name.endsWith(".json"))) {
  const payload = await fs.readFile(path.join(resultsDir, file), "utf8");
  const result = JSON.parse(payload);
  const rejectionReason = validateResult(result, { mode, runMin, runMax });

  if (rejectionReason) {
    rejected[rejectionReason] += 1;
    continue;
  }

  if (matchesFilters(result, filters)) {
    results.push(result);
  }
}

const groups = groupByArchitecture(results, metricName);
const architectures = Object.keys(groups);
const summary = architectures.map((architecture) => ({
  architecture,
  n: groups[architecture].length,
  mean: mean(groups[architecture]),
  sd: groups[architecture].length > 1 ? sampleStandardDeviation(groups[architecture]) : 0
}));

const comparisons = [];
for (let i = 0; i < architectures.length; i += 1) {
  for (let j = i + 1; j < architectures.length; j += 1) {
    const left = groups[architectures[i]];
    const right = groups[architectures[j]];

    if (left.length < 2 || right.length < 2) {
      continue;
    }

    const tStatistic = tTestTwoSample(left, right, 0);
    const degreesOfFreedom = left.length + right.length - 2;

    comparisons.push({
      left: architectures[i],
      right: architectures[j],
      tStatistic,
      degreesOfFreedom,
      pValue: twoTailedPValue(tStatistic, degreesOfFreedom),
      cohensD: cohensD(left, right)
    });
  }
}

holmBonferroniAdjust(comparisons);

await fs.mkdir(reportsDir, { recursive: true });
const report = {
  metric: metricName,
  filters,
  runRange: { runMin, runMax },
  generatedAt: new Date().toISOString(),
  acceptedSamples: results.length,
  rejectedSamples: rejected,
  summary,
  comparisons
};

const filterSuffix = Object.entries(filters)
  .filter(([, value]) => value)
  .map(([key, value]) => `${key}-${value}`)
  .join("-");
const reportPath = path.join(reportsDir, `analysis-${metricName}${filterSuffix ? `-${filterSuffix}` : ""}.json`);
await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
console.log(`Saved ${reportPath}`);

import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import {
  benchmarkTargets,
  scenarioPath,
  scenariosDir,
  throttling,
  backendApiUrl
} from "./config.js";
import { collectRuntimeMetadata } from "./runtime-metadata.js";
import { writeResult } from "./result-writer.js";

const benchmarkBackendOrigin = new URL(backendApiUrl).origin;

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

function percentile(values, percentileValue) {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function average(values) {
  if (!values.length) {
    return null;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function penalizeByFailureRate(value, successfulSessions, totalSessions) {
  if (value === null || !Number.isFinite(value) || totalSessions <= 0) {
    return null;
  }

  const successRate = successfulSessions / totalSessions;
  if (successRate <= 0) {
    return null;
  }

  return value / successRate;
}

/**
 * Run `logicalUsersCount` logical sessions using at most `maxConcurrency` concurrently active contexts.
 * `rampUpMs` is spread across logical user indexes (staging), not masked by pooling.
 */
async function runSessionsWithConcurrency(
  logicalUsersCount,
  rampTotalMs,
  maxConcurrencySlots,
  runOne
) {
  const tasks = [];
  for (let index = 0; index < logicalUsersCount; index += 1) {
    const sessionId = index + 1;
    const delay = rampTotalMs > 0 ? Math.floor((rampTotalMs / logicalUsersCount) * index) : 0;
    tasks.push(() => runOne(sessionId, delay));
  }
  const concurrency = Math.min(Math.max(1, Math.floor(maxConcurrencySlots)), logicalUsersCount);
  const results = new Array(logicalUsersCount);
  let nextSlot = 0;

  async function worker() {
    while (true) {
      const slot = nextSlot;
      nextSlot += 1;
      if (slot >= logicalUsersCount) {
        return;
      }
      results[slot] = await tasks[slot]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function executeStep(page, step) {
  const timeout = step.timeoutMs ?? 120000;

  if (step.action === "goto") {
    await page.goto(step.target, { timeout });
  }

  if (step.action === "fill") {
    await page.locator(step.target).fill(step.value, { timeout });
  }

  if (step.action === "select") {
    await page.locator(step.target).selectOption(step.value, { timeout });
  }

  if (step.action === "click") {
    await page.locator(step.target).click({ timeout });
  }

  if (step.action === "clickFirst") {
    await page.locator(step.target).first().click({ timeout });
  }

  if (step.action === "wait") {
    await page.waitForTimeout(step.ms);
  }

  if (step.waitFor) {
    await page.locator(step.waitFor).waitFor({ timeout });
  }
}

async function createSession(browser, targetUrl, sessionId) {
  const context = await browser.newContext({
    baseURL: targetUrl,
    javaScriptEnabled: true
  });

  await context.addInitScript(() => {
    window.__benchmarkLongTasks = [];

    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          window.__benchmarkLongTasks.push(
            ...list.getEntries().map((entry) => ({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration
            }))
          );
        });
        observer.observe({ type: "longtask", buffered: true });
      } catch (_error) {
        window.__benchmarkLongTasks = [];
      }
    }
  });

  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.setDefaultNavigationTimeout(120000);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const targetOrigin = new URL(targetUrl).origin;

    if (requestUrl.origin !== targetOrigin && requestUrl.origin !== benchmarkBackendOrigin) {
      await route.continue();
      return;
    }

    await route.continue({
      headers: {
        ...request.headers(),
        "cache-control": "no-cache"
      }
    });
  });

  const client = await context.newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Performance.enable");
  const browserVersionInfo = await client.send("Browser.getVersion");
  const chromeVersion = browserVersionInfo.product ?? null;
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: throttling.rttMs,
    downloadThroughput: (throttling.throughputKbps * 1024) / 8,
    uploadThroughput: (throttling.throughputKbps * 1024) / 8
  });
  await client.send("Emulation.setCPUThrottlingRate", {
    rate: throttling.cpuSlowdownMultiplier
  });

  let requests = 0;
  page.on("request", () => {
    requests += 1;
  });

  return { client, context, page, requests: () => requests, sessionId, chromeVersion };
}

async function runSession(browser, targetUrl, scenario, sessionId, rampDelayMs) {
  let session = null;

  try {
    if (rampDelayMs > 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, rampDelayMs);
      });
    }

    session = await createSession(browser, targetUrl, sessionId);
    const startedAt = performance.now();

    for (const step of scenario.steps) {
      await executeStep(session.page, step);
    }

    const durationMs = performance.now() - startedAt;
    const performanceMetrics = await session.client.send("Performance.getMetrics");
    const jsHeapUsedMetric = performanceMetrics.metrics.find((metric) => metric.name === "JSHeapUsedSize");
    const memoryMb = jsHeapUsedMetric ? Math.round(jsHeapUsedMetric.value / 1024 / 1024) : null;
    const longTasks = await session.page.evaluate(() => window.__benchmarkLongTasks ?? []);
    const webVitals = await session.page.evaluate(() => window.__benchmarkWebVitals ?? {});
    const maxTaskDuration = longTasks.reduce((max, task) => Math.max(max, task.duration), 0);
    const totalLongTaskDuration = longTasks.reduce((sum, task) => sum + task.duration, 0);

    return {
      sessionId,
      ok: true,
      scenarioDurationMs: Math.round(durationMs),
      requests: session.requests(),
      memoryMb,
      longTasksCount: longTasks.length,
      maxTaskDuration: Math.round(maxTaskDuration),
      totalLongTaskDuration: Math.round(totalLongTaskDuration),
      webVitalsLcp: webVitals.lcp?.value ?? null,
      webVitalsFcp: webVitals.fcp?.value ?? null,
      webVitalsCls: webVitals.cls?.value ?? null,
      webVitalsInp: webVitals.inp?.value ?? null,
      webVitalsTtfb: webVitals.ttfb?.value ?? null,
      webVitals,
      chromeVersion: session.chromeVersion
    };
  } catch (error) {
    return {
      sessionId,
      ok: false,
      error: error.message
    };
  } finally {
    if (session) {
      await session.context.close();
    }
  }
}

const architecture = getArg("architecture", "spa-redux");
const dataSize = Number(getArg("dataSize", 1000));
const users = Number(getArg("users", 50));
const run = Number(getArg("run", 1));
const scenarioName = getArg("scenario", "user-flow");
const rampUpMs = Number(getArg("rampUpMs", 0));
let maxConcurrency = Number(getArg("maxConcurrency", "10"));
if (!Number.isFinite(maxConcurrency)) {
  maxConcurrency = 10;
}
maxConcurrency = Math.max(1, Math.floor(maxConcurrency));
if (users < 1) {
  throw new Error("--users must be >= 1");
}
maxConcurrency = Math.min(maxConcurrency, users);
const isWarmup = getArg("isWarmup", "false") === "true";
const seriesId = getArg("seriesId", null);
const target = benchmarkTargets.find((item) => item.architecture === architecture);

if (!target) {
  throw new Error(`Unknown architecture: ${architecture}`);
}

const selectedScenarioPath =
  scenarioName === "user-flow" ? scenarioPath : path.join(scenariosDir, `${scenarioName}.json`);
const scenario = JSON.parse(await fs.readFile(selectedScenarioPath, "utf8"));
const browser = await chromium.launch({ headless: true });

try {
  const startedAt = performance.now();
  const sessions = await runSessionsWithConcurrency(users, rampUpMs, maxConcurrency, (sessionId, delay) =>
    runSession(browser, target.url, scenario, sessionId, delay)
  );
  const wallClockDurationMs = Math.round(performance.now() - startedAt);
  const successfulSessions = sessions.filter((session) => session.ok);
  const failedSessions = sessions.filter((session) => !session.ok);
  const durations = successfulSessions.map((session) => session.scenarioDurationMs);
  const requestCounts = successfulSessions.map((session) => session.requests);
  const memoryValues = successfulSessions
    .map((session) => session.memoryMb)
    .filter((value) => typeof value === "number");
  const longTaskCounts = successfulSessions.map((session) => session.longTasksCount);
  const maxTaskDurations = successfulSessions.map((session) => session.maxTaskDuration);
  const totalLongTaskDurations = successfulSessions.map((session) => session.totalLongTaskDuration);
  const webVitalsLcpValues = successfulSessions
    .map((session) => session.webVitalsLcp)
    .filter((value) => typeof value === "number");
  const webVitalsFcpValues = successfulSessions
    .map((session) => session.webVitalsFcp)
    .filter((value) => typeof value === "number");
  const webVitalsClsValues = successfulSessions
    .map((session) => session.webVitalsCls)
    .filter((value) => typeof value === "number");
  const webVitalsInpValues = successfulSessions
    .map((session) => session.webVitalsInp)
    .filter((value) => typeof value === "number");
  const webVitalsTtfbValues = successfulSessions
    .map((session) => session.webVitalsTtfb)
    .filter((value) => typeof value === "number");
  const chromeVersions = [
    ...new Set(
      successfulSessions
        .map((session) => session.chromeVersion)
        .filter((value) => typeof value === "string" && value.length > 0)
    )
  ];

  const result = {
    architecture,
    url: target.url,
    dataSize,
    users,
    run,
    scenario: scenario.name,
    mode: "parallel-playwright-load",
    seriesId,
    metrics: {
      scenarioDurationMs: Math.round(average(durations) ?? 0),
      p95ScenarioDurationMs: percentile(durations, 95),
      maxScenarioDurationMs: durations.length ? Math.max(...durations) : null,
      wallClockDurationMs,
      requests: Math.round(average(requestCounts) ?? 0),
      memoryMb: Math.round(average(memoryValues) ?? 0),
      longTasksCount: Math.round(average(longTaskCounts) ?? 0),
      maxTaskDuration: maxTaskDurations.length ? Math.max(...maxTaskDurations) : null,
      totalLongTaskDuration: Math.round(average(totalLongTaskDurations) ?? 0),
      webVitalsLcp: average(webVitalsLcpValues),
      webVitalsFcp: average(webVitalsFcpValues),
      webVitalsCls: average(webVitalsClsValues),
      webVitalsInp: average(webVitalsInpValues),
      webVitalsTtfb: average(webVitalsTtfbValues),
      successfulSessions: successfulSessions.length,
      failedSessions: failedSessions.length,
      successRate: users > 0 ? successfulSessions.length / users : null,
      scenarioDurationMsFailurePenalized: penalizeByFailureRate(
        average(durations),
        successfulSessions.length,
        users
      ),
      p95ScenarioDurationMsFailurePenalized: penalizeByFailureRate(
        percentile(durations, 95),
        successfulSessions.length,
        users
      ),
      wallClockDurationMsFailurePenalized: penalizeByFailureRate(
        wallClockDurationMs,
        successfulSessions.length,
        users
      )
    },
    sessions,
    environment: {
      cache: "disabled",
      cpuThrottling: `${throttling.cpuSlowdownMultiplier}x`,
      network: {
        rttMs: throttling.rttMs,
        throughputKbps: throttling.throughputKbps
      },
      load: {
        logicalUsers: users,
        maxConcurrentBrowserContexts: maxConcurrency,
        rampUpMs
      }
    },
    runtime: collectRuntimeMetadata({
      runner: "playwright",
      runnerMode: "parallel-playwright-load",
      chromeVersion: chromeVersions.length === 1 ? chromeVersions[0] : chromeVersions.join(" | "),
      warmup: isWarmup
    }),
    timestamp: new Date().toISOString()
  };

  if (!isWarmup) {
    const filePath = await writeResult(result);
    console.log(`Saved ${filePath}`);
    console.log(
      `Load result: ${successfulSessions.length}/${users} logical users ok (${maxConcurrency} concurrent max), mean duration ${result.metrics.scenarioDurationMs} ms`
    );
  } else {
    console.log(
      `Warm-up completed: ${architecture}, scenario=${scenario.name}, users=${users}, dataSize=${dataSize}, run=${run}`
    );
  }
} finally {
  await browser.close();
}

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

const architecture = getArg("architecture", "spa-redux");
const dataSize = Number(getArg("dataSize", 1000));
const users = Number(getArg("users", 50));
const run = Number(getArg("run", 1));
const scenarioName = getArg("scenario", "user-flow");
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
const context = await browser.newContext({
  baseURL: target.url,
  javaScriptEnabled: true
});

try {
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
    const targetOrigin = new URL(target.url).origin;

    if (requestUrl.origin !== targetOrigin && requestUrl.origin !== benchmarkBackendOrigin) {
      await route.continue();
      return;
    }

    const headers = {
      ...request.headers(),
      "cache-control": "no-cache"
    };
    await route.continue({ headers });
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
  const requestStartedAt = new WeakMap();
  const requestEvents = [];
  page.on("request", () => {
    requests += 1;
  });
  page.on("request", (request) => {
    requestStartedAt.set(request, performance.now());
  });
  function registerRequestEvent(request, status) {
    const startedAt = requestStartedAt.get(request);
    if (typeof startedAt !== "number") {
      return;
    }

    const finishedAt = performance.now();
    requestEvents.push({
      url: request.url(),
      resourceType: request.resourceType(),
      startedAtMs: startedAt,
      finishedAtMs: finishedAt,
      durationMs: finishedAt - startedAt,
      status
    });
  }
  page.on("requestfinished", (request) => {
    registerRequestEvent(request, "finished");
  });
  page.on("requestfailed", (request) => {
    registerRequestEvent(request, "failed");
  });
  page.on("pageerror", (error) => {
    console.error(`[pageerror] ${error.message}`);
  });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      console.error(`[browser:${message.type()}] ${message.text()}`);
    }
  });

  const startedAt = performance.now();
  for (const step of scenario.steps) {
    await executeStep(page, step);
  }
  const durationMs = performance.now() - startedAt;

  const performanceMetrics = await client.send("Performance.getMetrics");
  const jsHeapUsedMetric = performanceMetrics.metrics.find((metric) => metric.name === "JSHeapUsedSize");
  const memory = jsHeapUsedMetric ? Math.round(jsHeapUsedMetric.value / 1024 / 1024) : null;
  const longTasks = await page.evaluate(() => window.__benchmarkLongTasks ?? []);
  const webVitals = await page.evaluate(() => window.__benchmarkWebVitals ?? {});
  const microFrontendMetrics = await page.evaluate(() => window.__benchmarkMicroFrontend ?? null);
  const maxTaskDuration = longTasks.reduce((max, task) => Math.max(max, task.duration), 0);
  const totalLongTaskDuration = longTasks.reduce((sum, task) => sum + task.duration, 0);
  const relevantRequestEvents = requestEvents.filter((event) => {
    const requestUrl = new URL(event.url);
    const targetOrigin = new URL(target.url).origin;
    return requestUrl.origin === targetOrigin || requestUrl.origin === benchmarkBackendOrigin;
  });
  const requestStarts = relevantRequestEvents.map((event) => event.startedAtMs);
  const requestEnds = relevantRequestEvents.map((event) => event.finishedAtMs);
  const waterfallDurationMs =
    requestStarts.length && requestEnds.length ? Math.max(...requestEnds) - Math.min(...requestStarts) : null;
  const remoteEntryRequests = relevantRequestEvents.filter((event) => event.url.includes("remoteEntry.js")).length;
  const remoteScriptRequests = relevantRequestEvents.filter((event) => {
    const parsed = new URL(event.url);
    return parsed.pathname.includes("/assets/") && parsed.pathname.endsWith(".js");
  }).length;
  const backendRequests = relevantRequestEvents.filter((event) => event.url.startsWith(backendApiUrl)).length;
  const firstModuleMs =
    architecture === "micro-frontends" && typeof microFrontendMetrics?.firstModuleMs === "number"
      ? Math.round(microFrontendMetrics.firstModuleMs)
      : null;
  const compositionTimeMs =
    architecture === "micro-frontends" && typeof microFrontendMetrics?.compositionReadyMs === "number"
      ? Math.round(microFrontendMetrics.compositionReadyMs)
      : null;

  const result = {
    architecture,
    url: target.url,
    dataSize,
    users,
    run,
    scenario: scenario.name,
    mode: "single-playwright-scenario",
    seriesId,
    metrics: {
      scenarioDurationMs: Math.round(durationMs),
      requests,
      memoryMb: memory,
      longTasksCount: longTasks.length,
      maxTaskDuration: Math.round(maxTaskDuration),
      totalLongTaskDuration: Math.round(totalLongTaskDuration),
      webVitalsLcp: webVitals.lcp?.value ?? null,
      webVitalsFcp: webVitals.fcp?.value ?? null,
      webVitalsCls: webVitals.cls?.value ?? null,
      webVitalsInp: webVitals.inp?.value ?? null,
      webVitalsTtfb: webVitals.ttfb?.value ?? null,
      mfWaterfallRequests: architecture === "micro-frontends" ? relevantRequestEvents.length : null,
      mfWaterfallDurationMs:
        architecture === "micro-frontends" && typeof waterfallDurationMs === "number"
          ? Math.round(waterfallDurationMs)
          : null,
      mfRemoteEntryRequests: architecture === "micro-frontends" ? remoteEntryRequests : null,
      mfRemoteScriptRequests: architecture === "micro-frontends" ? remoteScriptRequests : null,
      mfBackendRequests: architecture === "micro-frontends" ? backendRequests : null,
      mfTimeToFirstModuleMs: firstModuleMs,
      mfCompositionTimeMs: compositionTimeMs
    },
    webVitals,
    environment: {
      cache: "disabled",
      cpuThrottling: `${throttling.cpuSlowdownMultiplier}x`,
      network: {
        rttMs: throttling.rttMs,
        throughputKbps: throttling.throughputKbps
      }
    },
    runtime: collectRuntimeMetadata({
      runner: "playwright",
      runnerMode: "single-playwright-scenario",
      chromeVersion,
      warmup: isWarmup
    }),
    timestamp: new Date().toISOString()
  };

  if (!isWarmup) {
    const filePath = await writeResult(result);
    console.log(`Saved ${filePath}`);
  } else {
    console.log(
      `Warm-up completed: ${architecture}, scenario=${scenario.name}, dataSize=${dataSize}, users=${users}, run=${run}`
    );
  }
} finally {
  await browser.close();
}

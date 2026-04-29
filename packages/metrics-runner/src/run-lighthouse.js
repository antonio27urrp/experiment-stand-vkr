import { launch } from "chrome-launcher";
import { benchmarkTargets, experimentMatrix, throttling } from "./config.js";
import { collectLighthouseMetrics } from "./lighthouse-metrics.js";
import { collectRuntimeMetadata } from "./runtime-metadata.js";
import { writeResult } from "./result-writer.js";

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const architectureFilter = getArg("architecture", null);
const dataSize = Number(getArg("dataSize", 1000));
const users = Number(getArg("users", 50));
const runs = Number(getArg("runs", experimentMatrix.runs));
const runOffset = Number(getArg("runOffset", 0));
const allowPilot = getArg("allowPilot", "false") === "true";
const isWarmup = getArg("isWarmup", "false") === "true";
const seriesId = getArg("seriesId", null);

if (runs < 15 && !allowPilot) {
  throw new Error("--runs must be at least 15 for the main experiment. Use --allowPilot=true only for smoke checks.");
}

if (!Number.isInteger(runOffset) || runOffset < 0) {
  throw new Error("--runOffset must be an integer >= 0");
}

const targets = architectureFilter
  ? benchmarkTargets.filter((target) => target.architecture === architectureFilter)
  : benchmarkTargets;

for (const target of targets) {
  for (let run = 1; run <= runs; run += 1) {
    const chrome = await launch({
      chromeFlags: [
        "--headless=new",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--no-sandbox",
        "--disable-application-cache",
        "--disk-cache-size=0"
      ]
    });

    try {
      const browserVersionProbe = await fetch(`http://localhost:${chrome.port}/json/version`);
      const browserVersionPayload = browserVersionProbe.ok ? await browserVersionProbe.json() : null;
      const chromeVersion = browserVersionPayload?.Browser ?? null;
      const metrics = await collectLighthouseMetrics(target.url, chrome.port);
      const result = {
        architecture: target.architecture,
        url: target.url,
        dataSize,
        users,
        run: runOffset + run,
        mode: "lighthouse-page-load",
        seriesId,
        metrics,
        environment: {
          cache: "disabled",
          cpuThrottling: `${throttling.cpuSlowdownMultiplier}x`,
          network: {
            rttMs: throttling.rttMs,
            throughputKbps: throttling.throughputKbps
          }
        },
        runtime: collectRuntimeMetadata({
          runner: "lighthouse",
          runnerMode: "lighthouse-page-load",
          chromeBinaryPath: chrome.chromePath ?? null,
          chromeVersion,
          warmup: isWarmup
        }),
        timestamp: new Date().toISOString()
      };

      if (!isWarmup) {
        const filePath = await writeResult(result);
        console.log(`Saved ${filePath}`);
      } else {
        console.log(`Warm-up completed: ${target.architecture}, dataSize=${dataSize}, users=${users}, run=${run}`);
      }
    } finally {
      await chrome.kill();
    }
  }
}

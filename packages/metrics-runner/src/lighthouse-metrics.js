import lighthouse from "lighthouse";

function auditValue(audits, key) {
  return audits[key]?.numericValue ?? null;
}

function getNetworkRequests(audits) {
  return audits["network-requests"]?.details?.items ?? [];
}

function bytesToKb(bytes) {
  return Math.round((bytes / 1024) * 100) / 100;
}

function calculateJavaScriptBundleKb(requests) {
  const scriptBytes = requests
    .filter((request) => request.resourceType === "Script")
    .reduce((sum, request) => sum + (request.transferSize ?? 0), 0);

  return bytesToKb(scriptBytes);
}

export async function collectLighthouseMetrics(url, chromePort) {
  const result = await lighthouse(
    url,
    {
      port: chromePort,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance"]
    },
    {
      extends: "lighthouse:default",
      settings: {
        disableStorageReset: false,
        throttlingMethod: "simulate",
        onlyAudits: [
          "first-contentful-paint",
          "largest-contentful-paint",
          "interactive",
          "total-blocking-time",
          "cumulative-layout-shift",
          "total-byte-weight",
          "network-requests"
        ]
      }
    }
  );

  const audits = result.lhr.audits;
  const requests = getNetworkRequests(audits);

  return {
    fcp: auditValue(audits, "first-contentful-paint"),
    lcp: auditValue(audits, "largest-contentful-paint"),
    tti: auditValue(audits, "interactive"),
    tbt: auditValue(audits, "total-blocking-time"),
    cls: auditValue(audits, "cumulative-layout-shift"),
    jsBundleKb: calculateJavaScriptBundleKb(requests),
    totalByteWeightKb: bytesToKb(auditValue(audits, "total-byte-weight") ?? 0),
    requests: requests.length,
    performanceScore: result.lhr.categories.performance.score
  };
}

import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";

let isRegistered = false;

function storeMetric(metric) {
  if (typeof window === "undefined") {
    return;
  }

  window.__benchmarkWebVitals ??= {};
  window.__benchmarkWebVitals[metric.name.toLowerCase()] = {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType
  };
}

export function registerWebVitalsCollector() {
  if (typeof window === "undefined" || isRegistered) {
    return;
  }

  isRegistered = true;
  window.__benchmarkWebVitals = {};

  onCLS(storeMetric);
  onFCP(storeMetric);
  onINP(storeMetric);
  onLCP(storeMetric);
  onTTFB(storeMetric);
}

export function readWebVitalsSnapshot() {
  if (typeof window === "undefined") {
    return {};
  }

  return window.__benchmarkWebVitals ?? {};
}

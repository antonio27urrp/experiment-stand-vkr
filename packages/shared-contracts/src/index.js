export const DATASET_SIZES = [100, 1000, 10000];

export const SORT_FIELDS = ["id", "title", "category", "score", "createdAt"];

export const API_ROUTES = {
  health: "/health",
  items: "/items",
  itemById: (id) => `/items/${id}`,
  seed: "/seed",
  uiSchema: "/ui-schema"
};

export const ARCHITECTURES = [
  "spa-redux",
  "micro-frontends",
  "ssr-csr",
  "jamstack"
];

export const PERFORMANCE_METRICS = [
  "lcp",
  "fcp",
  "tti",
  "tbt",
  "cls",
  "jsBundleKb",
  "requests",
  "memoryMb"
];

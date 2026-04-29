import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");

export const resultsDir = path.join(workspaceRoot, "experiments", "results");
export const reportsDir = path.join(workspaceRoot, "experiments", "reports");
export const scenariosDir = path.join(workspaceRoot, "experiments", "scenarios");
export const scenarioPath = path.join(scenariosDir, "user-flow.json");
export const backendApiUrl = "http://localhost:4000";

export const benchmarkTargets = [
  { architecture: "spa-redux", url: "http://localhost:5102" },
  { architecture: "micro-frontends", url: "http://localhost:5103" },
  { architecture: "ssr-csr", url: "http://localhost:5104" },
  { architecture: "jamstack", url: "http://localhost:5105" }
];

export const experimentMatrix = {
  users: [50, 100, 500],
  dataSizes: [100, 1000, 10000],
  runs: 15
};

export const throttling = {
  cpuSlowdownMultiplier: 4,
  rttMs: 150,
  throughputKbps: 1600
};

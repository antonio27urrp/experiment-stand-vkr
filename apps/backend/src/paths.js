import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const backendRoot = path.resolve(__dirname, "..");
export const dataDir = path.join(backendRoot, "data");
export const activeDatasetPath = path.join(dataDir, "items.active.json");

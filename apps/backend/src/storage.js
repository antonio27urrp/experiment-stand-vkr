import fs from "node:fs/promises";
import { activeDatasetPath, dataDir } from "./paths.js";
import { generateItems } from "./generate-data.js";

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

export async function writeDataset(size) {
  await ensureDataDir();
  const items = generateItems(size);
  const payload = JSON.stringify({ size, generatedAt: new Date().toISOString(), items }, null, 2);
  await fs.writeFile(activeDatasetPath, payload, "utf8");
  return items;
}

export async function readDataset() {
  await ensureDataDir();

  try {
    const payload = await fs.readFile(activeDatasetPath, "utf8");
    return JSON.parse(payload).items;
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    return writeDataset(100);
  }
}

export async function replaceDataset(items) {
  await ensureDataDir();
  await fs.writeFile(
    activeDatasetPath,
    JSON.stringify({ size: items.length, generatedAt: new Date().toISOString(), items }, null, 2),
    "utf8"
  );
}

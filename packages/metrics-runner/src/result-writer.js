import fs from "node:fs/promises";
import path from "node:path";
import { resultsDir } from "./config.js";

export async function writeResult(result) {
  await fs.mkdir(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${timestamp}-${result.architecture}-${result.dataSize}-${result.users}-run-${result.run}.json`;
  const filePath = path.join(resultsDir, fileName);
  await fs.writeFile(filePath, JSON.stringify(result, null, 2), "utf8");
  return filePath;
}

import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../../..");

function readGitCommit() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function readGitBranch() {
  const result = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

export function collectRuntimeMetadata(extra = {}) {
  return {
    nodeVersion: process.version,
    gitCommit: readGitCommit(),
    gitBranch: readGitBranch(),
    host: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? null,
      cpuCores: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024)
    },
    ...extra
  };
}

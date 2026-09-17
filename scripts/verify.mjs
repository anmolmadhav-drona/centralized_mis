import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDirectory = path.join(projectRoot, "node_modules", ".bin");
const isWindows = process.platform === "win32";

function resolveBunExecutable() {
  if (!isWindows) {
    return "bun";
  }

  const result = spawnSync("where.exe", ["bun"], { encoding: "utf8" });
  const executable = result.stdout
    ?.split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate && !candidate.endsWith(".cmd") && !candidate.endsWith(".ps1"));

  if (executable) {
    const bundledExecutable = path.join(path.dirname(executable), "node_modules", "bun", "bin", "bun.exe");
    if (fs.existsSync(bundledExecutable)) {
      return bundledExecutable;
    }
  }

  return executable ?? "bun";
}

const bunExecutable = resolveBunExecutable();

function commandPath(command) {
  return isWindows ? command : path.join(binDirectory, command);
}

function runStep(label, command, args, executable = commandPath(command)) {
  console.log(`\n▶ ${label}`);
  const startedAt = Date.now();
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: isWindows && executable !== bunExecutable,
    windowsHide: true,
  });

  if (result.error) {
    console.error(`✗ ${label} — FAILED: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    const status = result.status ?? "unknown exit status";
    console.error(`✗ ${label} — FAILED (exit code: ${status})`);
    process.exit(status === "unknown exit status" ? 1 : status);
  }

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  console.log(`✓ passed (${seconds}s)`);
}

console.log("NPL MIS Portal — verification");

// next dev can leave route types for paths that no longer exist.
fs.rmSync(path.join(projectRoot, ".next", "dev"), { recursive: true, force: true });

runStep("TypeScript (tsc --noEmit)", "tsc", ["--noEmit"]);
runStep("ESLint", "eslint", ["."]);
runStep(
  "Unit tests — business identity (46)",
  "bun",
  ["scripts/business-key-test.ts"],
  bunExecutable,
);
runStep(
  "Unit tests — formula engine (42)",
  "bun",
  ["scripts/formula-test.ts"],
  bunExecutable,
);
runStep("Production build (next build)", "bun", ["run", "build"], bunExecutable);

console.log("\nVerification summary");
console.log("  TypeScript   : ok");
console.log("  ESLint       : ok");
console.log("  Unit tests   : 46 business-key + 42 formula checks ok");
console.log("  Build        : production standalone ok");
console.log("  ALL CHECKS PASSED");
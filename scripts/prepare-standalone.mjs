import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const nextDirectory = path.join(projectRoot, ".next");
const staticDirectory = path.join(nextDirectory, "static");
const standaloneDirectory = path.join(nextDirectory, "standalone");
const standaloneNextDirectory = path.join(standaloneDirectory, ".next");

function requireDirectory(directory, description) {
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Required build output is missing: ${description} (${directory})`);
  }
}

try {
  requireDirectory(staticDirectory, ".next/static");
  requireDirectory(standaloneDirectory, ".next/standalone");

  fs.mkdirSync(standaloneNextDirectory, { recursive: true });
  fs.cpSync(staticDirectory, path.join(standaloneNextDirectory, "static"), {
    recursive: true,
  });

  const publicDirectory = path.join(projectRoot, "public");
  if (fs.existsSync(publicDirectory)) {
    requireDirectory(publicDirectory, "public");
    fs.cpSync(publicDirectory, path.join(standaloneDirectory, "public"), {
      recursive: true,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[prepare-standalone] ${message}`);
  process.exitCode = 1;
}
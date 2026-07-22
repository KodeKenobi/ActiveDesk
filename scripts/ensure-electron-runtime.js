#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const electronPackagePath = path.join(ROOT, "node_modules", "electron", "package.json");

if (!fs.existsSync(electronPackagePath)) {
  process.exit(0);
}

const electronPackage = JSON.parse(fs.readFileSync(electronPackagePath, "utf8"));
const electronRoot = path.dirname(electronPackagePath);
const distDir = path.join(electronRoot, "dist");
const pathFile = path.join(electronRoot, "path.txt");
const versionFile = path.join(distDir, "version");
const version = electronPackage.version;
const platformPath = process.platform === "darwin"
  ? "Electron.app/Contents/MacOS/Electron"
  : process.platform === "win32"
    ? "electron.exe"
    : "electron";
const executablePath = path.join(distDir, platformPath);

function isHealthy() {
  if (!fs.existsSync(executablePath)) return false;
  if (!fs.existsSync(pathFile)) return false;
  if (!fs.existsSync(versionFile)) return false;

  const installedPath = fs.readFileSync(pathFile, "utf8").trim();
  const installedVersion = fs.readFileSync(versionFile, "utf8").trim().replace(/^v/, "");
  return installedPath === platformPath && installedVersion === version;
}

if (isHealthy()) {
  process.exit(0);
}

if (process.platform !== "darwin") {
  console.warn("Electron runtime metadata is incomplete. Reinstall Electron for this platform.");
  process.exit(0);
}

const cacheRoot = path.join(os.homedir(), "Library", "Caches", "electron");
const zipName = `electron-v${version}-darwin-${process.arch}.zip`;
let zipPath = null;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      if (zipPath) return;
      continue;
    }
    if (entry.isFile() && entry.name === zipName) {
      zipPath = fullPath;
      return;
    }
  }
}

if (fs.existsSync(cacheRoot)) {
  walk(cacheRoot);
}

if (!zipPath) {
  console.warn(`Could not find ${zipName} in Electron cache. Run npm install again if npm start fails.`);
  process.exit(0);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
const extraction = spawnSync("ditto", ["-x", "-k", zipPath, distDir], { stdio: "inherit" });
if (extraction.status !== 0) {
  console.warn("Could not repair Electron runtime from cache.");
  process.exit(0);
}

fs.writeFileSync(pathFile, platformPath, "utf8");
fs.writeFileSync(versionFile, `v${version}`, "utf8");
console.log("Electron runtime repaired from cache.");

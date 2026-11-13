// Desktop packager: next build -> stage standalone server -> electron-builder.
// Usage: node scripts/electron-build.mjs [--mac|--win|--linux] [--x64] [--arm64] [electron-builder args...]
// (default: current platform + host arch). Never publishes unless overridden; CI uploads artifacts.

import { spawnSync } from "child_process";
import { cpSync, copyFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const want = process.argv.find((a) => ["--mac", "--win", "--linux"].includes(a)) || {
  darwin: "--mac",
  win32: "--win",
}[process.platform] || "--linux";

console.log("==> generating icons");
run(process.execPath, ["scripts/make-icons.mjs"]);

console.log("==> next build");
run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "build"]);

console.log("==> staging standalone server for desktop");
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
copyFileSync(join(root, "package.json"), join(standalone, "package.json"));
if (!existsSync(join(standalone, "server.js"))) {
  console.error("standalone server.js missing — is next.config `output: 'standalone'`?");
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const hasPlatform = rawArgs.some((a) => ["--mac", "--win", "--linux", "-m", "-w", "-l"].includes(a));
const hasPublish = rawArgs.some((a) => a === "--publish" || a.startsWith("--publish=") || a === "-p");
const builderArgs = [
  ...(hasPlatform ? [] : [want]),
  ...rawArgs,
  ...(hasPublish ? [] : ["--publish", "never"]),
];
console.log(`==> electron-builder ${builderArgs.join(" ")}`.trim());
const builder = join(root, "node_modules", ".bin", process.platform === "win32" ? "electron-builder.cmd" : "electron-builder");
run(builder, builderArgs);
console.log("done — installers are in dist/");

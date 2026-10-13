// Desktop packager: next build -> stage standalone server -> tauri build.
// Usage: node scripts/tauri-build.mjs [cargo tauri build args...]

import { spawnSync } from "child_process";
import { cpSync, copyFileSync, existsSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const standalone = join(root, ".next", "standalone");
const resources = join(root, "src-tauri", "resources", "standalone");

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

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

console.log("==> staging standalone into src-tauri/resources");
rmSync(resources, { recursive: true, force: true });
cpSync(standalone, resources, { recursive: true });

const extra = process.argv.slice(2);
console.log(`==> cargo tauri build ${extra.join(" ")}`.trim());
run(process.platform === "win32" ? "cargo.cmd" : "cargo", ["tauri", "build", ...extra]);
console.log("done — bundles are in src-tauri/target/release/bundle/");

// Ad-hoc signs unsigned macOS .app bundles after electron-builder modifies Info.plist
// and resources, preventing broken Mach-O signatures ("damaged and can't be opened") on Apple Silicon.
const { execFileSync, spawnSync } = require("child_process");
const { existsSync } = require("fs");
const path = require("path");

/** Ad-hoc sign darwin app bundles when no Apple Developer ID signed them. */
module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;

  const check = spawnSync("codesign", ["-dvv", appPath], { encoding: "utf-8" });
  const meta = `${check.stdout || ""}\n${check.stderr || ""}`;
  if (/^Authority=/m.test(meta)) {
    execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
    return;
  }

  console.log(`==> ad-hoc signing ${appPath}`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", appPath], { stdio: "inherit" });
};

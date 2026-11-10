// 归集各平台 Tauri 产物，统一重命名为 LuckyNumber-<版本>-<平台>.<扩展名>。
// 每项的第一个元素可以是多个候选目录（按顺序取第一个命中的）。
import { readdirSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const [platform, version, outDir = "dist-release"] = process.argv.slice(2);
const root = process.env.PROJECT_ROOT || process.cwd();
const prefix = `LuckyNumber-${version}`;

const specs = {
  windows: [
    ["src-tauri/target/release/bundle/nsis", (name) => name.endsWith(".exe"), `${prefix}-windows-x64-setup.exe`],
    ["src-tauri/target/release", (name) => name === "lucky-number.exe", `${prefix}-windows-x64-portable.exe`],
  ],
  linux: [
    ["src-tauri/target/release/bundle/deb", (name) => name.endsWith(".deb"), `${prefix}-linux-amd64.deb`],
    ["src-tauri/target/release/bundle/appimage", (name) => name.endsWith(".AppImage"), `${prefix}-linux-amd64.AppImage`],
  ],
  macos: [
    [
      [
        "src-tauri/target/universal-apple-darwin/release/bundle/dmg",
        "src-tauri/target/release/bundle/dmg",
      ],
      (name) => name.endsWith(".dmg"),
      `${prefix}-macos-universal.dmg`,
    ],
  ],
};

if (!specs[platform] || !/^1\.\d+\.\d+$/.test(version || "")) {
  console.error(`[collect] 参数错误: platform=${platform} version=${version}`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const collected = [];
for (const [directories, matcher, targetName] of specs[platform]) {
  const candidates = Array.isArray(directories) ? directories : [directories];
  let source = null;
  for (const relativeDir of candidates) {
    const dir = join(root, relativeDir);
    if (!existsSync(dir)) continue;
    const match = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && matcher(entry.name))
      .map((entry) => entry.name)
      .sort()
      .pop();
    if (match) {
      source = { dir, match, relativeDir };
      break;
    }
  }
  if (!source) {
    console.error(`[collect] 缺少产物: ${candidates.join(" / ")}`);
    process.exit(1);
  }
  const destination = join(outDir, targetName);
  copyFileSync(join(source.dir, source.match), destination);
  collected.push(`${source.relativeDir}/${source.match} -> ${destination}`);
}
console.log(`[collect] ${platform} 归集完成:\n  ${collected.join("\n  ")}`);

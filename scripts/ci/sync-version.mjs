// 把版本号同步写入所有声明了版本的文件，保证产物内版本一致。
// 仅修改 CI 工作区，不产生提交。
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const version = process.argv[2];
const root = process.env.PROJECT_ROOT || process.cwd();

if (!/^1\.\d+\.\d+$/.test(version || "")) {
  console.error(`[sync-version] 非法版本号: ${version}`);
  process.exit(1);
}

function editJson(relativePath, mutate) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    console.error(`[sync-version] 文件不存在: ${relativePath}`);
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(path, "utf8"));
  mutate(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

function replaceOnce(relativePath, pattern, replacement) {
  const path = join(root, relativePath);
  const text = readFileSync(path, "utf8");
  if (!pattern.test(text)) {
    console.error(`[sync-version] 未找到版本字段: ${relativePath}`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(pattern, replacement));
}

editJson("package.json", (data) => { data.version = version; });
editJson("package-lock.json", (data) => {
  data.version = version;
  if (data.packages && data.packages[""]) data.packages[""].version = version;
});
editJson("src-tauri/tauri.conf.json", (data) => { data.version = version; });

replaceOnce("src-tauri/Cargo.toml", /^version = "[^"]+"$/m, `version = "${version}"`);
replaceOnce(
  "src-tauri/Cargo.lock",
  /(name = "lucky-number"\nversion = ")[^"]+(")/,
  `$1${version}$2`
);

console.log(`[sync-version] 已同步 ${version} 到 package.json / package-lock.json / tauri.conf.json / Cargo.toml / Cargo.lock`);

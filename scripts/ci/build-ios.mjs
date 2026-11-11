#!/usr/bin/env node
// 在 macOS runner 上构建「未签名」iOS IPA。
//
// 没有 Apple Developer 证书时，Xcode 的 exportArchive 阶段必然失败，
// 但 archive 阶段产出的 .app 是完整的。本脚本关闭代码签名、容忍导出失败，
// 再把 .app 按 IPA 规范打进 Payload/ 目录，得到可侧载的 .ipa。
// 产物交给 collect.mjs 统一重命名，本脚本不关心版本号。
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.PROJECT_ROOT || process.cwd();
const genDir = join(root, "src-tauri/gen/apple");
const outDir = join(root, "ios-artifacts");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";

/** 把 Xcode 工程的自动签名改成 Manual 并彻底关闭签名校验。 */
export function disableCodeSigning(text) {
  let next = text;
  next = next.replace(/CODE_SIGN_STYLE\s*=\s*[^;]+;/g, "CODE_SIGN_STYLE = Manual;");
  // pbxproj 里也可能写成 CODE_SIGN_IDENTITY[sdk=iphoneos*] = "...";，保留后缀再清空。
  next = next.replace(
    /CODE_SIGN_IDENTITY(\[[^\]]*\])?\s*=\s*[^;]+;/g,
    (_match, suffix = "") => `CODE_SIGN_IDENTITY${suffix} = "";`
  );
  next = next.replace(/DEVELOPMENT_TEAM\s*=\s*[^;]+;/g, 'DEVELOPMENT_TEAM = "";');
  next = next.replace(/CODE_SIGNING_REQUIRED\s*=\s*[^;]+;/g, "CODE_SIGNING_REQUIRED = NO;");
  if (/CODE_SIGNING_ALLOWED\s*=/.test(next)) {
    next = next.replace(/CODE_SIGNING_ALLOWED\s*=\s*[^;]+;/g, "CODE_SIGNING_ALLOWED = NO;");
  } else {
    next = next.replace(/(buildSettings\s*=\s*\{)/g, "$1\n\t\t\t\tCODE_SIGNING_ALLOWED = NO;");
  }
  return next;
}

/** 递归查找目录（限制深度，避免遍历 Xcode DerivedData 里的巨型缓存）。 */
export function findDirs(dirs, predicate, maxDepth = 10) {
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      if (predicate(entry.name)) {
        hits.push(path);
        continue; // .app 内部不再深入
      }
      walk(path, depth + 1);
    }
  };
  for (const dir of dirs) walk(dir, 0);
  return hits;
}

/** 从候选 .app 中挑出真机包：排除模拟器、要求 Info.plist，优先 Release-iphoneos / arm64。 */
export function pickAppBundle(paths) {
  const ranked = paths
    .filter((path) => !/sim(ulator)?/i.test(path))
    .filter((path) => existsSync(join(path, "Info.plist")))
    .map((path) => ({
      path,
      score:
        (/Release-iphoneos/.test(path) ? 2 : 0) +
        (/[\\/]arm64[\\/]/.test(path) ? 1 : 0) +
        (/[\\/]build[\\/]/.test(path) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return ranked.length ? ranked[0].path : null;
}

function fail(message) {
  console.error(`[ios] ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  console.log(`[ios] $ ${command} ${args.join(" ")}`);
  return spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function main() {
  const init = run(npx, ["tauri", "ios", "init", "--ci"]);
  if (init.status !== 0) fail("tauri ios init 失败");

  // project.pbxproj 是 .xcodeproj 目录里的文件，所以先定位工程目录再拼文件名。
  const projects = findDirs([genDir], (name) => name.endsWith(".xcodeproj"), 6)
    .map((dir) => join(dir, "project.pbxproj"))
    .filter((file) => existsSync(file));
  if (projects.length === 0) fail("未找到 Xcode 工程的 project.pbxproj");
  const pbx = projects[0];
  console.log(`[ios] Xcode 工程: ${pbx}`);
  writeFileSync(pbx, disableCodeSigning(readFileSync(pbx, "utf8")), "utf8");
  console.log("[ios] 已关闭代码签名（Manual + CODE_SIGNING_ALLOWED=NO）");

  // exportArchive 需要签名，无证书时会以非零码退出；只要 .app 生成就算成功。
  const build = run(npx, ["tauri", "ios", "build", "--target", "aarch64", "--ci"]);
  if (build.status !== 0) {
    console.log("[ios] 构建命令返回非零（无签名时 exportArchive 失败的预期行为），继续检查 .app");
  }

  const roots = [genDir, join(homedir(), "Library/Developer/Xcode/DerivedData")];
  const apps = findDirs(roots, (name) => name.endsWith(".app"));
  const app = pickAppBundle(apps);
  if (!app) fail("未找到真机 .app 产物，无法打包 IPA");
  console.log(`[ios] 选用 .app: ${app}`);

  const stage = mkdtempSync(join(tmpdir(), "lucky-ios-"));
  try {
    const payload = join(stage, "Payload");
    mkdirSync(payload, { recursive: true });
    cpSync(app, join(payload, basename(app)), { recursive: true, dereference: false });

    mkdirSync(outDir, { recursive: true });
    const ipa = join(outDir, "LuckyNumber.ipa");
    rmSync(ipa, { force: true });
    const zip = run("zip", ["-qry", ipa, "Payload"], { cwd: stage });
    if (zip.status !== 0) fail("zip 打包 IPA 失败");

    const size = statSync(ipa).size;
    if (size === 0) fail("生成的 IPA 为空");
    const listing = spawnSync("unzip", ["-l", ipa], { encoding: "utf8" });
    const entries = listing.status === 0 ? listing.stdout || "" : "";
    if (!/Payload\/[^/]+\.app\/Info\.plist/.test(entries)) {
      fail("IPA 结构异常：缺少 Payload/*.app/Info.plist");
    }
    console.log(`[ios] 未签名 IPA 已生成: ${ipa}（${size} 字节）`);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) main();

// 根据 git 历史生成 Release 说明（同时作为 release body 和附件上传）。
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const version = process.argv[2];
const output = process.argv[3] || "RELEASE_NOTES.md";
const root = process.env.PROJECT_ROOT || process.cwd();

if (!/^1\.\d+\.\d+$/.test(version || "")) {
  console.error(`[release-notes] 非法版本号: ${version}`);
  process.exit(1);
}

function git(args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const tags = git(["tag", "--list", "v1.*.*", "--sort=-v:refname"])
  .split("\n")
  .map((tag) => tag.trim())
  .filter(Boolean);
const previousTag = tags.find((tag) => tag !== `v${version}`);
const range = previousTag ? [`${previousTag}..HEAD`] : ["HEAD"];
const log = git(["log", ...range, "--no-merges", "-n", "40", "--pretty=format:%s|%h"]);

const groups = { feat: [], fix: [], other: [] };
for (const line of log.split("\n")) {
  const separator = line.lastIndexOf("|");
  if (separator < 0) continue;
  const subject = line.slice(0, separator).trim();
  const hash = line.slice(separator + 1).trim();
  if (!subject) continue;
  if (/^feat(\(|[:：]|\s)/.test(subject)) groups.feat.push(`- ${subject} (\`${hash}\`)`);
  else if (/^fix(\(|[:：]|\s)/.test(subject)) groups.fix.push(`- ${subject} (\`${hash}\`)`);
  else groups.other.push(`- ${subject} (\`${hash}\`)`);
}

function section(title, lines) {
  return lines.length ? `### ${title}\n${lines.join("\n")}\n` : "";
}

const changes =
  section("✨ 新功能", groups.feat) +
  section("🐛 修复", groups.fix) +
  section("🔧 其他", groups.other) ||
  "首个发布版本，包含完整客户端功能。\n";

const sha = (process.env.GITHUB_SHA || git(["rev-parse", "--short", "HEAD"]) || "unknown").slice(0, 7);
const prefix = `LuckyNumber-${version}`;
const body = `# Lucky Number v${version}

> 双色球 / 大乐透模拟选号桌面客户端 · 一键生成 5 注，选号由本地随机熵生成、全程离线；近期官方开奖号码可在启动时联网更新或手动刷新，失败自动回退缓存 / 内置快照。

## 本次变更

${changes}
## 下载

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows x64 | \`${prefix}-windows-x64-setup.exe\` | NSIS 安装包（推荐） |
| Windows x64 | \`${prefix}-windows-x64-portable.exe\` | 免安装主程序 |
| macOS | \`${prefix}-macos-universal.dmg\` | Intel / Apple Silicon 通用包 |
| Linux x64 | \`${prefix}-linux-amd64.AppImage\` | 免安装，需 WebKit2GTK 4.1 |
| Linux x64 | \`${prefix}-linux-amd64.deb\` | Debian / Ubuntu 安装包 |
| 校验和 | \`SHA256SUMS.txt\` | 校验下载完整性 |

## 运行要求

- Windows 需 WebView2 Runtime（Windows 10/11 通常已内置）。
- Linux 需 \`libwebkit2gtk-4.1\`，Ubuntu 22.04 / Debian 12 及以上可直接安装依赖。
- macOS 包未做开发者签名与公证，首次打开请在「系统设置 → 隐私与安全性」中允许，或右键选择「打开」。

## 构建信息

- 版本：\`${version}\`
- Commit：\`${sha}\`
- 工具链：Tauri 2.0 / Rust stable / Node 22，由 GitHub Actions 三平台并行构建

## 理性提示

本工具仅用于模拟随机选号与娱乐，不预测开奖结果、不提供投注建议。选号全程离线、不上传数据；开奖数据仅从官方公告域名读取、仅供查阅，不参与选号，请以官方发布为准。购彩有风险，未成年人不得购彩，请理性对待、量力而行。
`;

writeFileSync(output, body);
console.log(`[release-notes] 已生成 ${output}（${body.length} 字符，基于 ${previousTag || "全部历史"}）`);

<div align="center">
  <img src="src-tauri/icons/icon.png" alt="Lucky Number 图标" width="96" />

  # 幸运号码 · Lucky Number

  **双色球 / 大乐透模拟选号桌面客户端** · 一键生成 5 注 · 选号本地随机 · 内置近期开奖

  [![Tauri 2.0](https://img.shields.io/badge/Tauri-2.0-24C8DB?logo=tauri&amp;logoColor=white)](https://tauri.app/)
  [![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust&amp;logoColor=white)](https://www.rust-lang.org/)
  [![Platform](https://img.shields.io/badge/平台-Windows%20%7C%20macOS%20%7C%20Linux-5865F2)](#下载与运行)
  [![Version](https://img.shields.io/badge/版本-1.x.x-blueviolet)](#版本与自动发布)
  [![Pages](https://img.shields.io/badge/GitHub%20Pages-在线预览-5865F2)](https://jetamie.github.io/lucky-number/)
  [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE)
</div>

## 简介

一个用 **Tauri 2.0** 写的轻量桌面小工具：切换双色球或大乐透，点一下就生成 5 注号码。选号随机数来自本地系统熵源，不联网、不上传、不保存任何数据；另内置最近 10 期官方开奖号码，仅供查阅，不参与选号，也不含任何预测逻辑。

界面是深空紫黑底 + 玻璃拟态卡片 + 立体号码球，无前端框架、无构建步骤，`frontendDist` 直接指向 `src/`。直接用浏览器打开 `src/index.html` 也能看到完整界面，此时会自动降级为 Web Crypto 本地随机。

**在线站点**：<https://jetamie.github.io/lucky-number/>（项目介绍与下载入口），<https://jetamie.github.io/lucky-number/app/>（浏览器版选号，可直接试用）。站点由 [Pages 流水线](.github/workflows/pages.yml) 从 `site/` 与 `src/` 组装发布，`push` 到 `main` 相关路径时自动更新。

## 功能

| 功能 | 说明 |
| --- | --- |
| 双玩法切换 | 双色球 / 大乐透，规则常量在 Rust 侧只定义一次 |
| 一键 5 注 | 每次生成 5 注，号码球带滚动开奖动画 |
| 复制与清空 | 复制单注、复制全部、清空结果（会话热度统计保留） |
| 快捷键 | `空格` / `回车` 快速生成 |
| 热度统计 | 汇总本次会话各号码出现频次 |
| 近期开奖 | 侧栏展示最近 10 期双色球 / 大乐透官方开奖号码，跟随玩法切换，仅供查阅 |
| 玩法速览 | 内置规则说明与理性购彩提示 |
| 离线优先 | 选号过程无网络请求；桌面命令异常时前端自动降级，不会白屏 |

### 玩法规则

| 玩法 | 前区 | 后区 |
| --- | --- | --- |
| 双色球 `ssq` | 01–33 选 6（红球） | 01–16 选 1（蓝球） |
| 大乐透 `dlt` | 01–35 选 5 | 01–12 选 2 |

## 下载与运行

前往 [Releases](https://github.com/jetamie/lucky-number/releases) 下载对应平台的安装包，文件名统一为 `LuckyNumber-<版本>-<平台>.<扩展名>`：

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows x64 | `LuckyNumber-1.x.x-windows-x64-setup.exe` | NSIS 安装包（推荐） |
| Windows x64 | `LuckyNumber-1.x.x-windows-x64-portable.exe` | 免安装主程序 |
| macOS | `LuckyNumber-1.x.x-macos-universal.dmg` | Intel / Apple Silicon 通用包 |
| Linux x64 | `LuckyNumber-1.x.x-linux-amd64.AppImage` | 免安装，需 WebKit2GTK 4.1 |
| Linux x64 | `LuckyNumber-1.x.x-linux-amd64.deb` | Debian / Ubuntu 安装包 |
| 校验和 | `SHA256SUMS.txt` | 校验下载完整性 |

运行要求：

- **Windows**：需 WebView2 Runtime（Windows 10/11 通常已内置）。
- **Linux**：需 `libwebkit2gtk-4.1`，Ubuntu 22.04 / Debian 12 及以上可直接安装依赖。
- **macOS**：包未做开发者签名与公证，首次打开请在「系统设置 → 隐私与安全性」中允许，或右键选择「打开」。

## 本地开发

前置条件：**Node.js 22+**、**Rust stable**、以及 [Tauri 2 各平台系统依赖](https://v2.tauri.app/start/prerequisites/)（Windows 另需 MSVC 生成工具与 WebView2；Linux 需 `libwebkit2gtk-4.1-dev` 等；macOS 需 Xcode Command Line Tools）。

```bash
npm ci                    # 安装 @tauri-apps/cli
npm run tauri dev         # 开发模式，热更新前端
npm run tauri build       # 出包，按当前平台自动合并配置
cd src-tauri && cargo test --release --lib   # 选号算法单元测试
```

`npm run build` 等价于 `npm run tauri build`。前端是三个静态文件（`index.html` / `styles.css` / `app.js`），改完刷新即可，无需打包工具。构建产物在 `src-tauri/target/release/bundle/`。

## 项目结构

```
.
├── src/                          # 前端（纯静态，零构建）
│   ├── index.html
│   ├── styles.css
│   ├── app.js                    # 交互、动画、降级随机逻辑
│   └── data/
│       ├── history.json          # 官方开奖数据（CI 自动更新）
│       └── history.js            # 前端只读加载，避免协议兼容问题
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # Tauri Builder / 命令注册
│   │   └── lottery.rs            # 玩法规则 + 等概率抽样 + 单元测试
│   ├── tauri.conf.json           # 主配置（窗口、图标、bundle）
│   ├── tauri.windows.conf.json   # Windows: nsis
│   ├── tauri.linux.conf.json     # Linux: deb + appimage
│   ├── tauri.macos.conf.json     # macOS: dmg + app
│   ├── capabilities/default.json
│   ├── icons/                    # ico / icns / png
│   └── Cargo.toml
├── scripts/ci/                   # 发布流水线辅助脚本（Node，无第三方依赖）
└── .github/workflows/release.yml # 三平台自动发布
```

## 选号是怎么实现的

`src-tauri/src/lottery.rs` 对 `1..=max` 做**部分 Fisher-Yates 洗牌**后取前 `count` 个并升序排列，保证等概率、不放回、无重复。前端通过 `invoke("generate_tickets", { kind, count })` 调用，`kind` 取 `ssq` 或 `dlt`，`count` 省略时默认 5、上限 20。返回结构：

```json
[{ "id": 1, "kind": "ssq", "front": [3, 8, 12, 19, 26, 31], "back": [9] }]
```

规则常量、抽样算法与边界校验都有 Rust 单元测试覆盖（号码范围、升序无重复、两种玩法各 5 注、非法参数拒绝）。

## 历史开奖数据

`src/data/history.json` 是数据真相，`src/data/history.js` 把它挂到 `window.LUCKY_HISTORY` 供前端只读加载（避免 Tauri 自定义协议下 `fetch` 静态 JSON 的兼容问题）。两个文件都由 `scripts/ci/fetch-history.mjs` 生成，**不要手动编辑**。

- **来源**：中国福利彩票开奖公告（双色球）、中国体育彩票开奖公告（大乐透），各取最近 10 期。
- **更新**：`.github/workflows/history.yml` 每天北京时间 22:30 抓取，按玩法规则严格校验（号码范围、个数、升序无重复、期号递减、日期格式）后写回；无新期号则不提交。任一路失败会保留该玩法原有数据，两路全失败则不写文件并让任务失败。
- **分发**：数据文件放在 `src/` 内，Tauri 打包时自动内嵌，Pages 构建时自动复制；CI 提交后会显式触发 Pages 重新部署。网页版能拿到最新数据，**桌面端是发版时的快照**，更新数据需重新发版。
- **边界**：历史数据只用于侧栏展示，**不参与 `generate_tickets` 的随机抽样**，不做冷热号、遗漏值或任何号码推荐。数据以官方公告为准。

## 版本与自动发布

版本号固定为 **`1.x.x`**。`.github/workflows/release.yml` 支持两种触发方式：

- **手动**：Actions → `Release` → Run workflow。版本号可填 `1.1.0`，留空则按最新 `v1.*.*` tag 自动递增补丁号（无 tag 时为 `1.0.0`）；可勾选「仅生成草稿」。
- **推送 tag**：`git tag v1.1.0 && git push origin v1.1.0`，版本号以 tag 为准。

流程分三段：`prepare`（算版本 → 同步到 5 个版本文件 → 生成 Release 说明 → 建草稿）→ `build`（Windows / Linux / macOS 三平台并行，macOS 用 `universal-apple-darwin`）→ `publish`（汇总资产、生成 `SHA256SUMS.txt`、上传、去掉草稿）。**任一平台打包失败就停在草稿，不会发布残缺版本**。只使用内置 `GITHUB_TOKEN`，无需额外 secrets。

> 首次运行前请确认仓库 `Settings → Actions → General → Workflow permissions` 为 **Read and write**，否则创建 Release 会被拒绝。

`scripts/ci/` 下 6 个 Node 脚本（零依赖）分别是：`version.mjs` 版本解析、`sync-version.mjs` 版本同步、`release-notes.mjs` 按 git log 分组生成说明、`collect.mjs` 产物归集重命名、`checksums.mjs` 生成校验和、`fetch-history.mjs` 抓取并校验开奖数据。Release 说明同时作为 `RELEASE_NOTES.md` 资产上传。

## 许可与声明

[MIT](LICENSE) © 2026 jetamie

本工具**仅用于模拟随机选号与娱乐**，不预测开奖结果、不提供投注建议，也不与任何彩票机构关联。内置历史开奖数据来自官方公告、仅供查阅，可能存在延迟或遗漏，请以官方发布为准。购彩有风险，未成年人不得购彩，请理性对待、量力而行。

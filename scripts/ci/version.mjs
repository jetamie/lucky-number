// 解析本次发布版本号，约束为 1.x.x。
// push tag 时以 tag 为准；手动触发时可用 inputs.version 指定，留空则自动递增补丁号。
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const VERSION_PATTERN = /^1\.\d+\.\d+$/;
const root = process.env.PROJECT_ROOT || process.cwd();
const event = process.env.GITHUB_EVENT_NAME || "workflow_dispatch";
const ref = process.env.GITHUB_REF || "";
const input = (process.env.INPUT_VERSION || "").trim();

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`[version] ${message}`);
  process.exit(1);
}

function nextPatchVersion() {
  const tags = git(["tag", "--list", "v1.*.*", "--sort=-v:refname"])
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => VERSION_PATTERN.test(tag.replace(/^v/, "")));
  if (tags.length === 0) return "1.0.0";
  const [, minor, patch] = tags[0].replace(/^v/, "").split(".").map(Number);
  return `1.${minor}.${patch + 1}`;
}

let version;
if (event === "push" && ref.startsWith("refs/tags/")) {
  version = ref.replace(/^refs\/tags\//, "").replace(/^v/, "");
} else {
  version = input || nextPatchVersion();
}

if (!VERSION_PATTERN.test(version)) {
  fail(`版本号必须为 1.x.x，当前是 "${version}"`);
}

const tag = `v${version}`;
if (event !== "push" && git(["tag", "--list", tag])) {
  fail(`tag ${tag} 已存在，请指定一个新版本号`);
}

const draft = String(process.env.INPUT_DRAFT || "").toLowerCase() === "true" ? "true" : "false";
const result = { version, tag, draft };

if (process.env.GITHUB_OUTPUT) {
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n") + "\n"
  );
}
console.log(`[version] ${event} -> ${JSON.stringify(result)}`);

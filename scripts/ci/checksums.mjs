// 为 Release 资产生成 SHA256SUMS.txt。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const dir = process.argv[2];
// 第二个参数可指定输出文件名：iOS 是独立可选任务，用它生成 SHA256SUMS-ios.txt，
// 避免与桌面端 publish 任务上传的 SHA256SUMS.txt 重名互相覆盖。
const outputName = process.argv[3] || "SHA256SUMS.txt";
if (!dir) {
  console.error("[checksums] 请传入产物目录");
  process.exit(1);
}
const files = readdirSync(dir, { withFileTypes: true })
  // 排除所有校验和文件：重跑或 iOS 独立任务留下的 SHA256SUMS*.txt 都不应被再次校验。
  .filter((entry) => entry.isFile() && !/^SHA256SUMS.*\.txt$/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

if (files.length === 0) {
  console.error("[checksums] 目录中没有可校验的文件");
  process.exit(1);
}

const lines = files.map((name) => {
  const digest = createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  return `${digest}  ${name}`;
});
writeFileSync(join(dir, outputName), lines.join("\n") + "\n");
console.log(`[checksums] 已为 ${files.length} 个文件生成 ${outputName}`);

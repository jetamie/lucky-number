// 为 Release 资产生成 SHA256SUMS.txt。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("[checksums] 请传入产物目录");
  process.exit(1);
}
const files = readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name !== "SHA256SUMS.txt")
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
writeFileSync(join(dir, "SHA256SUMS.txt"), lines.join("\n") + "\n");
console.log(`[checksums] 已为 ${files.length} 个文件生成 SHA256SUMS.txt`);

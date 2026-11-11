/* 抓取官方开奖公告，生成随包发布的静态历史数据。
 * 输出 src/data/history.json（数据真相）与 src/data/history.js（前端直接引入，避免 Tauri 自定义协议下 fetch 静态文件）。
 * 任何一路解析/校验失败都保留该玩法原有数据；两路全部失败则报错退出，不写文件。
 * --check 只抓取校验不落盘，用于本地与 CI 预检。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.env.PROJECT_ROOT || process.cwd();
const OUT_DIR = join(ROOT, "src", "data");
const JSON_PATH = join(OUT_DIR, "history.json");
const JS_PATH = join(OUT_DIR, "history.js");
const CHECK_ONLY = process.argv.includes("--check");
const LIMIT = 10;
const TIMEOUT_MS = 20000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const SOURCES = {
  ssq: {
    label: "中国福利彩票开奖公告",
    url: "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=10&pageNo=1&pageSize=10&systemType=PC",
    headers: { "User-Agent": UA, Referer: "https://www.cwl.gov.cn/" },
  },
  dlt: {
    label: "中国体育彩票开奖公告",
    url: "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=10&isVerify=1&pageNo=1",
    headers: {
      "User-Agent": UA,
      Referer: "https://www.lottery.gov.cn/",
      Origin: "https://www.lottery.gov.cn",
      Accept: "application/json, text/plain, */*",
    },
  },
};

/* 与 src-tauri/src/lottery.rs 的规则保持一致；输出数据必须能被现有玩法规则解释。 */
const RULES = {
  ssq: { frontMax: 33, frontCount: 6, backMax: 16, backCount: 1 },
  dlt: { frontMax: 35, frontCount: 5, backMax: 12, backCount: 2 },
};

const log = (message) => console.log(`[history] ${message}`);
const warn = (message) => console.warn(`[history] ${message}`);

function today() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchPayload(kind) {
  const source = SOURCES[kind];
  const response = await fetch(source.url, {
    headers: source.headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function sortedNumbers(values) {
  const numbers = values.map((value) => Number(String(value).trim()));
  numbers.sort((left, right) => left - right);
  return numbers;
}

function parseSsq(payload) {
  if (payload.state !== 0 || !Array.isArray(payload.result)) {
    throw new Error("福彩响应结构异常");
  }
  return payload.result.map((row) => ({
    issue: String(row.code),
    date: String(row.date).replace(/\(.*\)$/, "").trim(),
    front: sortedNumbers(String(row.red).split(",")),
    back: sortedNumbers(String(row.blue).split(",").filter(Boolean)),
  }));
}

function parseDlt(payload) {
  const list = payload && payload.value && payload.value.list;
  if (!payload.success || !Array.isArray(list)) {
    throw new Error("体彩响应结构异常");
  }
  return list.map((row) => {
    const numbers = String(row.lotteryDrawResult).trim().split(/\s+/).map(Number);
    return {
      issue: String(row.lotteryDrawNum),
      date: String(row.lotteryDrawTime).slice(0, 10),
      front: sortedNumbers(numbers.slice(0, 5)),
      back: sortedNumbers(numbers.slice(5, 7)),
    };
  });
}

function assertZone(numbers, max, count, label) {
  if (numbers.length !== count) {
    throw new Error(`${label}个数应为 ${count}，实际 ${numbers.length}`);
  }
  if (new Set(numbers).size !== count) {
    throw new Error(`${label}存在重复号码`);
  }
  for (const number of numbers) {
    if (!Number.isInteger(number) || number < 1 || number > max) {
      throw new Error(`${label}号码越界: ${number}`);
    }
  }
  for (let index = 1; index < numbers.length; index += 1) {
    if (numbers[index] <= numbers[index - 1]) {
      throw new Error(`${label}未严格升序`);
    }
  }
}

function validate(kind, rows) {
  const rule = RULES[kind];
  if (rows.length === 0) throw new Error("返回空列表");
  const seen = new Set();
  let previous = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    if (!/^\d{5,7}$/.test(row.issue)) throw new Error(`期号异常: ${row.issue}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw new Error(`日期异常: ${row.date}`);
    if (seen.has(row.issue)) throw new Error(`期号重复: ${row.issue}`);
    seen.add(row.issue);
    const current = Number(row.issue);
    if (current >= previous) throw new Error(`期号未按时间递减: ${row.issue}`);
    previous = current;
    assertZone(row.front, rule.frontMax, rule.frontCount, "前区");
    assertZone(row.back, rule.backMax, rule.backCount, "后区");
  }
}

function loadExisting() {
  const empty = { updatedAt: "", source: {}, ssq: [], dlt: [] };
  if (!existsSync(JSON_PATH)) return empty;
  try {
    const data = JSON.parse(readFileSync(JSON_PATH, "utf8"));
    return {
      updatedAt: data.updatedAt || "",
      source: data.source || {},
      ssq: Array.isArray(data.ssq) ? data.ssq : [],
      dlt: Array.isArray(data.dlt) ? data.dlt : [],
    };
  } catch (error) {
    warn(`现有数据无法解析，按空数据处理: ${error.message}`);
    return empty;
  }
}

function mergeRows(existing, fresh) {
  const byIssue = new Map();
  for (const row of existing) byIssue.set(row.issue, row);
  for (const row of fresh) byIssue.set(row.issue, row);
  const rows = Array.from(byIssue.values());
  rows.sort((left, right) => Number(right.issue) - Number(left.issue));
  return rows.slice(0, LIMIT);
}

const existing = loadExisting();
const result = {
  updatedAt: today(),
  source: { ssq: SOURCES.ssq.label, dlt: SOURCES.dlt.label },
  ssq: existing.ssq,
  dlt: existing.dlt,
};

let success = 0;
for (const kind of ["ssq", "dlt"]) {
  try {
    const payload = await fetchPayload(kind);
    const rows = kind === "ssq" ? parseSsq(payload) : parseDlt(payload);
    validate(kind, rows);
    result[kind] = mergeRows(existing[kind], rows);
    success += 1;
    log(`${kind}: 抓取 ${rows.length} 期，合并后 ${result[kind].length} 期`);
  } catch (error) {
    warn(`${kind} 更新失败（${error.message}），保留原有 ${existing[kind].length} 期`);
  }
}

if (success === 0) {
  console.error("[history] 两路数据源均失败，未写入任何文件");
  process.exit(1);
}
if (CHECK_ONLY && success !== 2) {
  console.error("[history] 校验模式下要求两路数据源都可用");
  process.exit(1);
}

const jsonText = JSON.stringify(result, null, 2) + "\n";
const jsText = `/* 由 scripts/ci/fetch-history.mjs 自动生成，请勿手动编辑。 */\nwindow.LUCKY_HISTORY = ${JSON.stringify(result, null, 2)};\n`;

if (CHECK_ONLY) {
  log(`校验通过：ssq ${result.ssq.length} 期 / dlt ${result.dlt.length} 期（未写文件）`);
} else {
  mkdirSync(OUT_DIR, { recursive: true });
  let changed = false;
  if (!existsSync(JSON_PATH) || readFileSync(JSON_PATH, "utf8") !== jsonText) {
    writeFileSync(JSON_PATH, jsonText);
    changed = true;
  }
  if (!existsSync(JS_PATH) || readFileSync(JS_PATH, "utf8") !== jsText) {
    writeFileSync(JS_PATH, jsText);
    changed = true;
  }
  log(changed ? `已写入 ${JSON_PATH} 与 ${JS_PATH}` : "数据无变化，未改写文件");
  log(`changed=${changed}`);
}

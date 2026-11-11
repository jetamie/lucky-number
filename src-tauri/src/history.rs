//! 官方开奖公告抓取与本地缓存。
//! 请求由 Rust 侧发出：既不经过 WebView（无 CORS 问题），也无需开放 capabilities 的 http 权限。
//! 任一路失败保留该玩法缓存；两路全失败时返回缓存或错误，由前端回退到内置快照。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Manager;

use crate::lottery::{rule_of, DLT, SSQ};

const SSQ_URL: &str = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice?name=ssq&issueCount=10&pageNo=1&pageSize=10&systemType=PC";
const DLT_URL: &str = "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=10&isVerify=1&pageNo=1";
const SSQ_REFERER: &str = "https://www.cwl.gov.cn/";
const DLT_REFERER: &str = "https://www.lottery.gov.cn/";
const DLT_ORIGIN: &str = "https://www.lottery.gov.cn";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const ACCEPT_JSON: &str = "application/json, text/plain, */*";
const TIMEOUT_SECS: u64 = 15;
const CACHE_FILE: &str = "history.json";
const SSQ_SOURCE: &str = "中国福利彩票开奖公告";
const DLT_SOURCE: &str = "中国体育彩票开奖公告";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Draw {
    pub issue: String,
    pub date: String,
    pub front: Vec<u32>,
    pub back: Vec<u32>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct HistorySource {
    pub ssq: String,
    pub dlt: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HistoryData {
    pub updated_at: String,
    pub online: bool,
    pub source: HistorySource,
    pub ssq: Vec<Draw>,
    pub dlt: Vec<Draw>,
}

fn split_numbers(value: &str) -> Result<Vec<u32>, String> {
    let mut numbers = Vec::new();
    for part in value.split(|character: char| character == ',' || character.is_whitespace()) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let number = trimmed
            .parse::<u32>()
            .map_err(|_| format!("非法号码: {}", trimmed))?;
        numbers.push(number);
    }
    Ok(numbers)
}

fn sorted(mut numbers: Vec<u32>) -> Vec<u32> {
    numbers.sort_unstable();
    numbers
}

fn clean_date(value: &str) -> String {
    value.split('(').next().unwrap_or(value).trim().to_string()
}

fn is_date(value: &str) -> bool {
    let parts: Vec<&str> = value.split('-').collect();
    if parts.len() != 3 {
        return false;
    }
    parts[0].len() == 4
        && parts[1].len() == 2
        && parts[2].len() == 2
        && parts
            .iter()
            .all(|part| part.bytes().all(|byte| byte.is_ascii_digit()))
}

fn as_str<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少字段: {}", key))
}

fn parse_ssq(payload: &Value) -> Result<Vec<Draw>, String> {
    if payload.get("state").and_then(Value::as_i64) != Some(0) {
        return Err("福彩响应状态异常".into());
    }
    let rows = payload
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| "福彩响应缺少 result".to_string())?;
    let mut draws = Vec::with_capacity(rows.len());
    for row in rows {
        let front = sorted(split_numbers(as_str(row, "red")?)?);
        let back = sorted(split_numbers(as_str(row, "blue")?)?);
        draws.push(Draw {
            issue: as_str(row, "code")?.to_string(),
            date: clean_date(as_str(row, "date")?),
            front,
            back,
        });
    }
    Ok(draws)
}

fn parse_dlt(payload: &Value) -> Result<Vec<Draw>, String> {
    if payload.get("success").and_then(Value::as_bool) != Some(true) {
        return Err("体彩响应状态异常".into());
    }
    let rows = payload
        .get("value")
        .and_then(|value| value.get("list"))
        .and_then(Value::as_array)
        .ok_or_else(|| "体彩响应缺少 value.list".to_string())?;
    let mut draws = Vec::with_capacity(rows.len());
    for row in rows {
        let numbers = split_numbers(as_str(row, "lotteryDrawResult")?)?;
        if numbers.len() != 7 {
            return Err(format!("大乐透开奖号码个数异常: {}", numbers.len()));
        }
        draws.push(Draw {
            issue: as_str(row, "lotteryDrawNum")?.to_string(),
            date: clean_date(as_str(row, "lotteryDrawTime")?),
            front: sorted(numbers[..5].to_vec()),
            back: sorted(numbers[5..].to_vec()),
        });
    }
    Ok(draws)
}

fn assert_zone(numbers: &[u32], max: u32, count: usize, label: &str) -> Result<(), String> {
    if numbers.len() != count {
        return Err(format!("{}个数应为 {}，实际 {}", label, count, numbers.len()));
    }
    for (index, number) in numbers.iter().enumerate() {
        if *number < 1 || *number > max {
            return Err(format!("{}号码越界: {}", label, number));
        }
        if index > 0 && numbers[index - 1] >= *number {
            return Err(format!("{}未严格升序", label));
        }
    }
    Ok(())
}

fn validate(kind: &str, rows: &[Draw]) -> Result<(), String> {
    let rule = rule_of(kind).ok_or_else(|| format!("不支持的玩法: {}", kind))?;
    if rows.is_empty() {
        return Err("返回空列表".into());
    }
    let mut seen = HashSet::new();
    let mut previous: Option<u64> = None;
    for row in rows {
        if !is_date(&row.date) {
            return Err(format!("日期异常: {}", row.date));
        }
        let issue = row
            .issue
            .parse::<u64>()
            .map_err(|_| format!("期号异常: {}", row.issue))?;
        if !seen.insert(issue) {
            return Err(format!("期号重复: {}", row.issue));
        }
        if let Some(last) = previous {
            if issue >= last {
                return Err(format!("期号未按时间递减: {}", row.issue));
            }
        }
        previous = Some(issue);
        assert_zone(&row.front, rule.front_max, rule.front_count, "前区")?;
        assert_zone(&row.back, rule.back_max, rule.back_count, "后区")?;
    }
    Ok(())
}

fn apply_headers(request: reqwest::RequestBuilder, kind: &str) -> reqwest::RequestBuilder {
    let request = request.header("User-Agent", USER_AGENT);
    if kind == SSQ {
        request.header("Referer", SSQ_REFERER)
    } else {
        request
            .header("Referer", DLT_REFERER)
            .header("Origin", DLT_ORIGIN)
            .header("Accept", ACCEPT_JSON)
    }
}

async fn fetch_rows(client: &reqwest::Client, kind: &str) -> Result<Vec<Draw>, String> {
    let url = if kind == SSQ { SSQ_URL } else { DLT_URL };
    let response = apply_headers(client.get(url), kind)
        .send()
        .await
        .map_err(|error| format!("{} 请求失败: {}", kind, error))?;
    if !response.status().is_success() {
        return Err(format!("{} HTTP {}", kind, response.status()));
    }
    let body = response
        .text()
        .await
        .map_err(|error| format!("{} 读取响应失败: {}", kind, error))?;
    let payload: Value = serde_json::from_str(&body)
        .map_err(|error| format!("{} 响应不是 JSON: {}", kind, error))?;
    let rows = if kind == SSQ {
        parse_ssq(&payload)?
    } else {
        parse_dlt(&payload)?
    };
    validate(kind, &rows)?;
    Ok(rows)
}

fn cache_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录: {}", error))?;
    Ok(directory.join(CACHE_FILE))
}

fn read_cache(path: &Path) -> Option<HistoryData> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_cache(path: &Path, data: &HistoryData) {
    if let Some(parent) = path.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if let Ok(text) = serde_json::to_string_pretty(data) {
        let _ = fs::write(path, text);
    }
}

fn source_label(kind: &str, online: bool, had_cache: bool) -> String {
    let name = if kind == SSQ { SSQ_SOURCE } else { DLT_SOURCE };
    if online {
        return format!("{}（在线更新）", name);
    }
    if had_cache {
        return format!("{}（本地缓存）", name);
    }
    name.to_string()
}

/// 启动时或手动刷新时调用。`today` 由前端提供，避免为此引入日期/时区依赖。
#[tauri::command]
pub async fn refresh_history(app: tauri::AppHandle, today: String) -> Result<HistoryData, String> {
    let path = cache_path(&app)?;
    let cached = read_cache(&path);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("HTTP 客户端初始化失败: {}", error))?;

    /* 两路接口互不依赖，并发请求把最坏等待从 2×超时降到 1×超时。 */
    let ssq_client = client.clone();
    let dlt_client = client.clone();
    let ssq_task = tauri::async_runtime::spawn(async move { fetch_rows(&ssq_client, SSQ).await });
    let dlt_task = tauri::async_runtime::spawn(async move { fetch_rows(&dlt_client, DLT).await });
    let ssq_result = ssq_task
        .await
        .unwrap_or_else(|error| Err(format!("{} 任务异常: {}", SSQ, error)));
    let dlt_result = dlt_task
        .await
        .unwrap_or_else(|error| Err(format!("{} 任务异常: {}", DLT, error)));
    let ssq_online = ssq_result.is_ok();
    let dlt_online = dlt_result.is_ok();

    if !ssq_online && !dlt_online {
        if let Some(mut data) = cached {
            data.online = false;
            data.source = HistorySource {
                ssq: source_label(SSQ, false, true),
                dlt: source_label(DLT, false, true),
            };
            return Ok(data);
        }
        return Err("官方开奖数据暂不可用，已使用内置数据".into());
    }

    let fallback = cached.as_ref();
    let ssq = ssq_result.unwrap_or_else(|_| {
        fallback
            .map(|data| data.ssq.clone())
            .unwrap_or_default()
    });
    let dlt = dlt_result.unwrap_or_else(|_| {
        fallback
            .map(|data| data.dlt.clone())
            .unwrap_or_default()
    });

    let updated_at = if is_date(&today) {
        today
    } else {
        String::new()
    };
    let data = HistoryData {
        updated_at,
        online: true,
        source: HistorySource {
            ssq: source_label(SSQ, ssq_online, fallback.is_some()),
            dlt: source_label(DLT, dlt_online, fallback.is_some()),
        },
        ssq,
        dlt,
    };
    write_cache(&path, &data);
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ssq_draw(issue: &str, date: &str, front: Vec<u32>, back: Vec<u32>) -> Draw {
        Draw {
            issue: issue.to_string(),
            date: date.to_string(),
            front,
            back,
        }
    }

    #[test]
    fn parses_ssq_payload() {
        let payload = json!({
            "state": 0,
            "result": [{
                "code": "2026129", "date": "2026-11-10(二)",
                "red": "03,09,16,20,25,30", "blue": "05"
            }]
        });
        let rows = parse_ssq(&payload).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].issue, "2026129");
        assert_eq!(rows[0].date, "2026-11-10");
        assert_eq!(rows[0].front, vec![3, 9, 16, 20, 25, 30]);
        assert_eq!(rows[0].back, vec![5]);
        assert!(validate(SSQ, &rows).is_ok());
    }

    #[test]
    fn parses_dlt_payload() {
        let payload = json!({
            "success": true,
            "value": { "list": [{
                "lotteryDrawNum": "26128", "lotteryDrawTime": "2026-11-09",
                "lotteryDrawResult": "03 13 20 25 34 09 12"
            }] }
        });
        let rows = parse_dlt(&payload).unwrap();
        assert_eq!(rows[0].front, vec![3, 13, 20, 25, 34]);
        assert_eq!(rows[0].back, vec![9, 12]);
        assert!(validate(DLT, &rows).is_ok());
    }

    #[test]
    fn rejects_invalid_draws() {
        let duplicated = vec![ssq_draw(
            "2026129",
            "2026-11-10",
            vec![3, 3, 9, 16, 20, 25],
            vec![5],
        )];
        assert!(validate(SSQ, &duplicated).is_err());

        let out_of_range = vec![ssq_draw(
            "2026129",
            "2026-11-10",
            vec![1, 2, 3, 4, 5, 34],
            vec![5],
        )];
        assert!(validate(SSQ, &out_of_range).is_err());

        let bad_date = vec![ssq_draw(
            "2026129",
            "bad",
            vec![1, 2, 3, 4, 5, 6],
            vec![5],
        )];
        assert!(validate(SSQ, &bad_date).is_err());
    }

    #[test]
    fn rejects_reversed_issue_order() {
        let rows = vec![
            ssq_draw("2026128", "2026-11-08", vec![1, 2, 3, 4, 5, 6], vec![5]),
            ssq_draw("2026129", "2026-11-10", vec![1, 2, 3, 4, 5, 6], vec![5]),
        ];
        assert!(validate(SSQ, &rows).is_err());
    }

    #[test]
    fn dlt_rules_reject_ssq_shape() {
        let rows = vec![ssq_draw(
            "26128",
            "2026-11-09",
            vec![3, 13, 20, 25, 34],
            vec![9, 12],
        )];
        assert!(validate(DLT, &rows).is_ok());
        assert!(validate(SSQ, &rows).is_err());
    }
}

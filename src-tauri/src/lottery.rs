use rand::Rng;
use serde::Serialize;

const SSQ: &str = "ssq";
const DLT: &str = "dlt";
const DEFAULT_COUNT: usize = 5;
const MAX_COUNT: usize = 20;

/// 玩法规则：前区/后区的号码上限与选取个数，全局只定义一次。
#[derive(Clone, Copy)]
struct Rule {
    front_max: u32,
    front_count: usize,
    back_max: u32,
    back_count: usize,
}

const SSQ_RULE: Rule = Rule {
    front_max: 33,
    front_count: 6,
    back_max: 16,
    back_count: 1,
};

const DLT_RULE: Rule = Rule {
    front_max: 35,
    front_count: 5,
    back_max: 12,
    back_count: 2,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ticket {
    pub id: usize,
    pub kind: String,
    pub front: Vec<u32>,
    pub back: Vec<u32>,
}

fn rule_of(kind: &str) -> Option<Rule> {
    match kind {
        SSQ => Some(SSQ_RULE),
        DLT => Some(DLT_RULE),
        _ => None,
    }
}

/// 等概率不放回抽样：对 1..=max 做部分 Fisher-Yates 洗牌，取前 count 个后升序排列。
fn draw<R: Rng + ?Sized>(rng: &mut R, max: u32, count: usize) -> Vec<u32> {
    let mut pool: Vec<u32> = (1..=max).collect();
    for index in 0..count {
        let swap_with = rng.random_range(index..pool.len());
        pool.swap(index, swap_with);
    }
    let mut picked = pool[..count].to_vec();
    picked.sort_unstable();
    picked
}

/// 生成指定玩法的若干注号码。随机数来自本地系统熵源，全程离线，不上传任何数据。
#[tauri::command]
pub fn generate_tickets(kind: String, count: Option<u32>) -> Result<Vec<Ticket>, String> {
    let rule = rule_of(kind.as_str()).ok_or_else(|| format!("不支持的玩法: {}", kind))?;
    let total = count.unwrap_or(DEFAULT_COUNT as u32) as usize;
    if total == 0 || total > MAX_COUNT {
        return Err(format!("单次生成注数需在 1~{} 之间", MAX_COUNT));
    }

    let mut rng = rand::rng();
    let mut tickets = Vec::with_capacity(total);
    for index in 0..total {
        tickets.push(Ticket {
            id: index + 1,
            kind: kind.clone(),
            front: draw(&mut rng, rule.front_max, rule.front_count),
            back: draw(&mut rng, rule.back_max, rule.back_count),
        });
    }
    Ok(tickets)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_match_official_number_ranges() {
        let ssq = rule_of(SSQ).unwrap();
        assert_eq!((ssq.front_max, ssq.front_count), (33, 6));
        assert_eq!((ssq.back_max, ssq.back_count), (16, 1));

        let dlt = rule_of(DLT).unwrap();
        assert_eq!((dlt.front_max, dlt.front_count), (35, 5));
        assert_eq!((dlt.back_max, dlt.back_count), (12, 2));

        assert!(rule_of("unknown").is_none());
    }

    #[test]
    fn draw_never_repeats_and_stays_sorted() {
        let mut rng = rand::rng();
        for _ in 0..500 {
            let picked = draw(&mut rng, 33, 6);
            assert_eq!(picked.len(), 6);
            assert!(picked.iter().all(|n| (1..=33).contains(n)));
            assert!(picked.windows(2).all(|pair| pair[0] < pair[1]));
        }
    }

    #[test]
    fn generate_five_valid_tickets_for_both_games() {
        let ssq = generate_tickets(String::from(SSQ), None).unwrap();
        assert_eq!(ssq.len(), DEFAULT_COUNT);
        assert!(ssq.iter().all(|t| t.front.len() == 6 && t.back.len() == 1));

        let dlt = generate_tickets(String::from(DLT), Some(5)).unwrap();
        assert_eq!(dlt.len(), 5);
        assert!(dlt.iter().all(|t| t.front.len() == 5 && t.back.len() == 2));
        assert!(dlt
            .iter()
            .all(|t| t.front.iter().all(|n| (1..=35).contains(n))
                && t.back.iter().all(|n| (1..=12).contains(n))));
    }

    #[test]
    fn invalid_arguments_are_rejected() {
        assert!(generate_tickets(String::from("foo"), Some(5)).is_err());
        assert!(generate_tickets(String::from(SSQ), Some(0)).is_err());
        assert!(generate_tickets(String::from(SSQ), Some(21)).is_err());
    }
}

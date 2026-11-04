//! Real API spend, from each vendor's own cost report. Needs an Admin key (Keychain only);
//! without one the popover says "not available" rather than a number.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const KEYCHAIN_SERVICE: &str = "AureliaCode";
const DAY: i64 = 24 * 3600;
/// Cost reports move slowly; opening the popover shouldn't call them every time.
const REFRESH: Duration = Duration::from_secs(15 * 60);

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    if !matches!(provider, "anthropic" | "openai") {
        return Err(format!("unknown provider '{provider}'"));
    }
    keyring::Entry::new(KEYCHAIN_SERVICE, &format!("{provider}-admin-key")).map_err(|e| e.to_string())
}

fn key(provider: &str) -> Option<String> {
    entry(provider).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

#[tauri::command]
pub fn spend_key_set(provider: String, key: String) -> Result<(), String> {
    let e = entry(&provider)?;
    if let Some(m) = CACHE.lock().unwrap().as_mut() {
        m.remove(&provider);
    }
    if key.trim().is_empty() {
        return match e.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(err.to_string()),
        };
    }
    e.set_password(key.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spend_key_has(provider: String) -> bool {
    key(&provider).is_some()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Spend {
    provider: &'static str,
    /// USD for the last 1, 7 and 30 days; None when there's no key or the call failed.
    days: Option<[f64; 3]>,
    /// Why there is no number: "no key" or the vendor's error.
    note: Option<String>,
}

/// Daily buckets (start, USD) from Anthropic's cost report; `amount` is a decimal string in cents.
fn anthropic_days(v: &Value) -> Vec<(i64, f64)> {
    let buckets = v["data"].as_array().map(Vec::as_slice).unwrap_or_default();
    buckets
        .iter()
        .filter_map(|b| {
            let at = crate::ledger::parse_time(b["starting_at"].as_str()?)? / 1000;
            let cents: f64 = b["results"].as_array()?.iter().filter_map(|r| r["amount"].as_str()?.parse::<f64>().ok()).sum();
            Some((at, cents / 100.0))
        })
        .collect()
}

/// Daily buckets (start, USD) from OpenAI's costs endpoint.
fn openai_days(v: &Value) -> Vec<(i64, f64)> {
    let buckets = v["data"].as_array().map(Vec::as_slice).unwrap_or_default();
    buckets
        .iter()
        .filter_map(|b| {
            let usd = b["results"].as_array()?.iter().filter_map(|r| r["amount"]["value"].as_f64()).sum();
            Some((b["start_time"].as_i64()?, usd))
        })
        .collect()
}

/// Buckets are whole UTC days, so each window is the days that started inside it.
fn totals(days: &[(i64, f64)], now: i64) -> [f64; 3] {
    [1, 7, 30].map(|n| days.iter().filter(|(at, _)| *at >= now - n * DAY).map(|(_, usd)| usd).sum())
}

fn rfc3339_day(unix: i64) -> String {
    // Civil from days (Howard Hinnant's algorithm).
    let z = unix.div_euclid(DAY) + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}T00:00:00Z")
}

async fn fetch(provider: &'static str, key: &str, now: i64) -> Result<[f64; 3], String> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|e| e.to_string())?;
    let start = now - 31 * DAY;
    let req = match provider {
        "anthropic" => client
            .get("https://api.anthropic.com/v1/organizations/cost_report")
            .query(&[("starting_at", rfc3339_day(start)), ("bucket_width", "1d".into()), ("limit", "31".into())])
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        _ => client
            .get("https://api.openai.com/v1/organization/costs")
            .query(&[("start_time", start.to_string()), ("bucket_width", "1d".into()), ("limit", "31".into())])
            .bearer_auth(key),
    };
    let res = req.send().await.map_err(|e| e.without_url().to_string())?;
    let status = res.status();
    if !status.is_success() {
        return Err(format!("{provider} answered {status}"));
    }
    let v: Value = res.json().await.map_err(|e| e.without_url().to_string())?;
    let days = if provider == "anthropic" { anthropic_days(&v) } else { openai_days(&v) };
    Ok(totals(&days, now))
}

static CACHE: Mutex<Option<HashMap<String, (Instant, Spend)>>> = Mutex::new(None);

#[tauri::command]
pub async fn real_spend() -> Vec<Spend> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let mut out = vec![];
    for provider in ["anthropic", "openai"] {
        let hit = CACHE.lock().unwrap().as_ref().and_then(|m| m.get(provider).filter(|(t, _)| t.elapsed() < REFRESH).map(|(_, s)| s.clone()));
        if let Some(s) = hit {
            out.push(s);
            continue;
        }
        let Some(k) = key(provider) else {
            out.push(Spend { provider, days: None, note: Some("no key".into()) });
            continue;
        };
        let s = match fetch(provider, &k, now).await {
            Ok(days) => Spend { provider, days: Some(days), note: None },
            Err(e) => Spend { provider, days: None, note: Some(e) },
        };
        CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(provider.into(), (Instant::now(), s.clone()));
        out.push(s);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn anthropic_amounts_are_cents_as_text() {
        let v = json!({ "data": [{ "starting_at": "2026-11-01T00:00:00Z", "ending_at": "2026-11-02T00:00:00Z",
            "results": [{ "amount": "150.5", "currency": "USD" }, { "amount": "49.5", "currency": "USD" }] }] });
        assert_eq!(anthropic_days(&v), vec![(crate::ledger::parse_time("2026-11-01T00:00:00Z").unwrap() / 1000, 2.0)]);
    }

    #[test]
    fn openai_amounts_are_dollars() {
        let v = json!({ "data": [{ "start_time": 1000, "end_time": 2000, "results": [{ "amount": { "value": 0.25, "currency": "usd" } }, { "amount": { "value": 1.0, "currency": "usd" } }] }] });
        assert_eq!(openai_days(&v), vec![(1000, 1.25)]);
    }

    #[test]
    fn totals_add_up_each_window() {
        let now = 100 * DAY;
        let days = [(now - 40 * DAY, 100.0), (now - 20 * DAY, 10.0), (now - 3 * DAY, 2.0), (now - DAY, 1.0)];
        assert_eq!(totals(&days, now), [1.0, 3.0, 13.0]);
    }

    #[test]
    fn report_dates_are_midnight_utc() {
        assert_eq!(rfc3339_day(0), "1970-01-01T00:00:00Z");
        assert_eq!(rfc3339_day(1_793_635_200), "2026-11-02T00:00:00Z");
    }

    #[test]
    fn only_known_vendors_have_a_key_slot() {
        assert!(entry("evil").is_err());
    }
}

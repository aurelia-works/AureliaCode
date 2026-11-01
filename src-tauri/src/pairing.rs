//! Phone pairing for the remote: the QR code carries a one-time code (valid 15 minutes,
//! gone once used). Redeeming it gives that phone its own token, kept in a cookie, so each
//! phone shows up in Settings → Remote and can be unpaired on its own.
//! Phones paired before this existed (one shared `remote-token`) are kept as one device.

use serde::{Deserialize, Serialize};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::watch;

const CODE_TTL: u64 = 15 * 60;
/// last_seen is written to disk at most this often per device.
const SEEN_EVERY: u64 = 60;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub token: String,
    pub paired_at: u64,
    pub last_seen: u64,
}

/// A device as Settings sees it (no token).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub paired_at: u64,
    pub last_seen: u64,
}

#[derive(Default)]
pub struct Registry {
    pub devices: Vec<Device>,
    code: Option<(String, u64)>,
}

fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// "iPhone", "Android phone", ... from a User-Agent, numbered when the name is taken.
pub fn device_name(user_agent: &str, taken: &[Device]) -> String {
    let base = if user_agent.contains("iPhone") {
        "iPhone"
    } else if user_agent.contains("iPad") {
        "iPad"
    } else if user_agent.contains("Android") {
        "Android phone"
    } else if user_agent.contains("Macintosh") {
        "Mac"
    } else if user_agent.contains("Windows") {
        "Windows PC"
    } else if user_agent.contains("Linux") {
        "Linux computer"
    } else {
        "Browser"
    };
    let used = |n: &str| taken.iter().any(|d| d.name == n);
    if !used(base) {
        return base.to_string();
    }
    (2..).map(|i| format!("{base} {i}")).find(|n| !used(n)).unwrap()
}

impl Registry {
    /// The current code, made fresh when there's none or it expired.
    pub fn code(&mut self, now: u64, fresh: impl FnOnce() -> String) -> (String, u64) {
        match &self.code {
            Some((c, exp)) if *exp > now => (c.clone(), exp - now),
            _ => {
                let c = fresh();
                self.code = Some((c.clone(), now + CODE_TTL));
                (c, CODE_TTL)
            }
        }
    }

    /// Uses up the code and pairs a new device; returns its token.
    pub fn redeem(&mut self, code: &str, user_agent: &str, now: u64, token: String, id: String) -> Option<String> {
        let (c, exp) = self.code.as_ref()?;
        if *exp <= now || !same(c, code) {
            return None;
        }
        self.code = None;
        let name = device_name(user_agent, &self.devices);
        self.devices.push(Device { id, name, token: token.clone(), paired_at: now, last_seen: now });
        Some(token)
    }

    /// The device holding `token`; bumps its last_seen. The bool says whether to save.
    pub fn check(&mut self, token: &str, now: u64) -> Option<(String, bool)> {
        let d = self.devices.iter_mut().find(|d| same(&d.token, token))?;
        let save = now.saturating_sub(d.last_seen) >= SEEN_EVERY;
        if save {
            d.last_seen = now;
        }
        Some((d.id.clone(), save))
    }

    pub fn unpair(&mut self, id: &str) -> bool {
        let before = self.devices.len();
        self.devices.retain(|d| d.id != id);
        before != self.devices.len()
    }

    pub fn unpair_all(&mut self) {
        self.devices.clear();
        self.code = None;
    }

    pub fn views(&self) -> Vec<DeviceView> {
        self.devices.iter().map(|d| DeviceView { id: d.id.clone(), name: d.name.clone(), paired_at: d.paired_at, last_seen: d.last_seen }).collect()
    }
}

// ---------------------------------------------------------------- the app's registry

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

pub fn random_hex(bytes: usize) -> String {
    use std::io::Read;
    let mut buf = vec![0u8; bytes];
    if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut buf)).is_err() {
        // Never reached on macOS; still no panic on the main thread.
        let n = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        buf.iter_mut().enumerate().for_each(|(i, b)| *b = (n >> ((i % 16) * 8)) as u8 ^ i as u8);
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

fn devices_path() -> std::path::PathBuf {
    crate::config::app_dir().join("remote-devices.json")
}

fn load() -> Registry {
    let devices = match std::fs::read_to_string(devices_path()) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(devices) => devices,
            Err(e) => {
                // Never silently unpair every phone: keep the broken file so a human can
                // recover tokens from it, and start with no devices.
                let path = devices_path();
                let backup = path.with_extension("json.corrupt");
                let _ = std::fs::rename(&path, &backup);
                eprintln!("[aurelia] remote-devices.json is invalid ({e}); moved to {}", backup.display());
                Vec::new()
            }
        },
        Err(_) => {
            // First run with per-phone pairing: keep phones paired with the old shared token.
            let old = std::fs::read_to_string(crate::config::app_dir().join("remote-token")).ok().map(|t| t.trim().to_string()).filter(|t| t.len() >= 32);
            old.map(|token| vec![Device { id: random_hex(6), name: "Phone paired before".into(), token, paired_at: now(), last_seen: 0 }]).unwrap_or_default()
        }
    };
    Registry { devices, code: None }
}

fn save(reg: &Registry) {
    let path = devices_path();
    if let Ok(value) = serde_json::to_value(&reg.devices) {
        let _ = crate::config::write_private_json(&path, &value);
    }
}

static REG: LazyLock<Mutex<Registry>> = LazyLock::new(|| Mutex::new(load()));
/// Bumped on every unpair; open sessions re-check their token and close if it's gone.
pub static REVOKED: LazyLock<watch::Sender<u64>> = LazyLock::new(|| watch::channel(0).0);

/// The code for the QR link, and seconds until it expires.
pub fn code() -> (String, u64) {
    REG.lock().unwrap().code(now(), || random_hex(16))
}

pub fn redeem(code: &str, user_agent: &str) -> Option<String> {
    let mut reg = REG.lock().unwrap();
    let token = reg.redeem(code, user_agent, now(), random_hex(24), random_hex(6))?;
    save(&reg);
    Some(token)
}

pub fn check(token: &str) -> bool {
    let mut reg = REG.lock().unwrap();
    match reg.check(token, now()) {
        Some((_, true)) => {
            save(&reg);
            true
        }
        Some(_) => true,
        None => false,
    }
}

pub fn devices() -> Vec<DeviceView> {
    REG.lock().unwrap().views()
}

pub fn unpair(id: &str) {
    let mut reg = REG.lock().unwrap();
    if reg.unpair(id) {
        save(&reg);
        REVOKED.send_modify(|n| *n += 1);
    }
}

pub fn unpair_all() {
    let mut reg = REG.lock().unwrap();
    reg.unpair_all();
    save(&reg);
    REVOKED.send_modify(|n| *n += 1);
}

#[cfg(test)]
mod tests {
    use super::*;

    const IPHONE: &str = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X)";

    #[test]
    fn a_code_pairs_one_phone_once() {
        let mut r = Registry::default();
        let (code, left) = r.code(1000, || "abc".into());
        assert_eq!(left, CODE_TTL);
        let tok = r.redeem(&code, IPHONE, 1001, "tok1".into(), "d1".into());
        assert_eq!(tok.as_deref(), Some("tok1"));
        assert_eq!(r.redeem(&code, IPHONE, 1002, "tok2".into(), "d2".into()), None, "used up");
        assert_eq!(r.devices.len(), 1);
        assert_eq!(r.devices[0].name, "iPhone");
        assert_eq!(r.code(1003, || "def".into()).0, "def", "a new code after use");
    }

    #[test]
    fn wrong_or_expired_codes_pair_nothing() {
        let mut r = Registry::default();
        let (code, _) = r.code(0, || "abc".into());
        assert_eq!(r.redeem("abd", IPHONE, 1, "t".into(), "d".into()), None);
        assert_eq!(r.redeem(&code, IPHONE, CODE_TTL, "t".into(), "d".into()), None, "expired");
        assert!(r.devices.is_empty());
    }

    #[test]
    fn each_phone_is_checked_and_unpaired_on_its_own() {
        let mut r = Registry::default();
        for (t, id) in [("tokA", "a"), ("tokB", "b")] {
            let (c, _) = r.code(0, || format!("code-{id}"));
            r.redeem(&c, IPHONE, 0, t.into(), id.into()).unwrap();
        }
        assert_eq!(r.devices[1].name, "iPhone 2");
        assert_eq!(r.check("tokA", 10), Some(("a".into(), false)));
        assert_eq!(r.check("tokA", 10 + SEEN_EVERY), Some(("a".into(), true)), "last_seen saved once a minute");
        assert!(r.unpair("a"));
        assert_eq!(r.check("tokA", 200), None);
        assert!(r.check("tokB", 200).is_some());
        r.unpair_all();
        assert_eq!(r.check("tokB", 300), None);
    }

    #[test]
    fn device_names_come_from_the_browser() {
        assert_eq!(device_name("Mozilla/5.0 (Linux; Android 16; Pixel 10)", &[]), "Android phone");
        assert_eq!(device_name("Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0)", &[]), "Mac");
        assert_eq!(device_name("curl/8", &[]), "Browser");
    }
}

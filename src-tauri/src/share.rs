//! Read-only share links for one thread (Theo, 2026-11-04 03:22: share a thread with someone without giving them the
//! machine). A link is `/s/<token>` on the phone remote's server (remote.rs), so it works over the same Tailscale
//! routes and the same address allowlist. A guest token:
//! - reads one thread's conversation, the one it was made for, and nothing else;
//! - is not a pairing token: it opens no terminal, no socket and no other page;
//! - can ask something, but the ask only waits here until you send or decline it on the Mac;
//! - dies after `TTL_SECS`, when you stop sharing, or when the app quits (links live in memory only).

use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

pub const TTL_SECS: u64 = 24 * 60 * 60;
/// Longest guest message, in characters.
pub const MAX_ASK: usize = 2000;
/// Unanswered guest messages per thread; more are refused until you answer.
pub const MAX_PENDING: usize = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ask {
    pub id: String,
    pub pane: String,
    pub text: String,
    pub at: u64,
}

#[derive(Debug, PartialEq)]
pub enum AskError {
    /// Unknown, revoked or expired token.
    NoShare,
    Empty,
    TooLong,
    TooMany,
}

struct Link {
    pane: String,
    expires: u64,
}

#[derive(Default)]
pub struct Shares {
    links: HashMap<String, Link>,
    /// What a guest sees, pushed by the frontend for shared threads only.
    feeds: HashMap<String, Value>,
    asks: Vec<Ask>,
}

impl Shares {
    /// A new link for `pane`; it replaces the thread's old link, so an old URL stops working.
    pub fn create(&mut self, pane: &str, token: String, now: u64) -> String {
        self.links.retain(|_, l| l.pane != pane);
        self.links.insert(token.clone(), Link { pane: pane.into(), expires: now + TTL_SECS });
        token
    }

    /// Stops sharing `pane`: its link, its feed and any unanswered asks go.
    pub fn revoke(&mut self, pane: &str) {
        self.links.retain(|_, l| l.pane != pane);
        self.feeds.remove(pane);
        self.asks.retain(|a| a.pane != pane);
    }

    /// The pane a live token was made for.
    pub fn pane_of(&self, token: &str, now: u64) -> Option<&str> {
        self.links.get(token).filter(|l| l.expires > now).map(|l| l.pane.as_str())
    }

    /// Shared panes and when their links expire.
    pub fn shared(&self, now: u64) -> Vec<(String, u64)> {
        self.links.values().filter(|l| l.expires > now).map(|l| (l.pane.clone(), l.expires)).collect()
    }

    /// Stores a feed only for a pane that is shared right now.
    pub fn set_feed(&mut self, pane: &str, feed: Value, now: u64) -> bool {
        if !self.links.values().any(|l| l.pane == pane && l.expires > now) {
            return false;
        }
        self.feeds.insert(pane.into(), feed);
        true
    }

    /// The token's own thread, and only that one.
    pub fn feed(&self, token: &str, now: u64) -> Option<Value> {
        let pane = self.pane_of(token, now)?;
        Some(self.feeds.get(pane).cloned().unwrap_or(Value::Null))
    }

    /// A guest's message waits here; nothing reaches the thread until `take` hands it to the Mac's side.
    pub fn ask(&mut self, token: &str, text: &str, id: String, now: u64) -> Result<(), AskError> {
        let pane = self.pane_of(token, now).ok_or(AskError::NoShare)?.to_string();
        let text = text.trim();
        if text.is_empty() {
            return Err(AskError::Empty);
        }
        if text.chars().count() > MAX_ASK {
            return Err(AskError::TooLong);
        }
        if self.asks.iter().filter(|a| a.pane == pane).count() >= MAX_PENDING {
            return Err(AskError::TooMany);
        }
        self.asks.push(Ask { id, pane, text: text.into(), at: now });
        Ok(())
    }

    pub fn pending(&self) -> Vec<Ask> {
        self.asks.clone()
    }

    /// Removes an ask (sent or declined) and returns it.
    pub fn take(&mut self, id: &str) -> Option<Ask> {
        let i = self.asks.iter().position(|a| a.id == id)?;
        Some(self.asks.remove(i))
    }

    pub fn pending_for(&self, token: &str, now: u64) -> usize {
        self.pane_of(token, now).map(|p| self.asks.iter().filter(|a| a.pane == p).count()).unwrap_or(0)
    }
}

pub static SHARES: LazyLock<Mutex<Shares>> = LazyLock::new(Default::default);

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareLink {
    pub pane: String,
    /// One URL per way in (Tailscale HTTPS first), like the pairing links.
    pub urls: Vec<String>,
    pub expires: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shared {
    pub pane: String,
    pub expires: u64,
}

#[tauri::command]
pub async fn share_create(pane: String) -> Result<ShareLink, String> {
    let bases = tauri::async_runtime::spawn_blocking(crate::remote::share_bases).await.map_err(|e| e.to_string())?.ok_or("Turn on Remote in Settings first: share links use its server")?;
    let token = crate::pairing::random_hex(24);
    let now = now();
    SHARES.lock().unwrap().create(&pane, token.clone(), now);
    Ok(ShareLink { pane, urls: bases.into_iter().map(|b| format!("{b}/s/{token}")).collect(), expires: now + TTL_SECS })
}

#[tauri::command]
pub fn share_revoke(pane: String) {
    SHARES.lock().unwrap().revoke(&pane);
}

#[tauri::command]
pub fn share_list() -> Vec<Shared> {
    SHARES.lock().unwrap().shared(now()).into_iter().map(|(pane, expires)| Shared { pane, expires }).collect()
}

#[tauri::command]
pub fn share_feed(pane: String, feed: Value) -> bool {
    SHARES.lock().unwrap().set_feed(&pane, feed, now())
}

#[tauri::command]
pub fn share_asks() -> Vec<Ask> {
    SHARES.lock().unwrap().pending()
}

#[tauri::command]
pub fn share_take(id: String) -> Option<Ask> {
    SHARES.lock().unwrap().take(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn two_threads() -> Shares {
        let mut s = Shares::default();
        s.create("a", "tok-a".into(), 100);
        s.create("b", "tok-b".into(), 100);
        assert!(s.set_feed("a", json!({ "title": "thread A", "items": ["secret plan A"] }), 100));
        assert!(s.set_feed("b", json!({ "title": "thread B", "items": ["secret plan B"] }), 100));
        s
    }

    #[test]
    fn a_token_reads_only_its_own_thread() {
        let s = two_threads();
        let a = s.feed("tok-a", 101).unwrap().to_string();
        assert!(a.contains("secret plan A"));
        assert!(!a.contains("secret plan B"), "token A must never see thread B");
        assert!(s.feed("tok-c", 101).is_none());
        assert!(s.feed("", 101).is_none());
    }

    #[test]
    fn a_guest_message_waits_and_only_take_releases_it() {
        let mut s = two_threads();
        s.ask("tok-a", "  can you add tests?  ", "q1".into(), 101).unwrap();
        // Waiting, for thread A only; nothing else happened to it.
        let p = s.pending();
        assert_eq!(p.len(), 1);
        assert_eq!((p[0].pane.as_str(), p[0].text.as_str()), ("a", "can you add tests?"));
        // Taking it (send or decline) is the only way out, and only once.
        assert_eq!(s.take("q1").unwrap().pane, "a");
        assert!(s.take("q1").is_none());
        assert!(s.pending().is_empty());
    }

    #[test]
    fn asks_are_refused_for_bad_tokens_and_bad_text_and_capped() {
        let mut s = two_threads();
        assert_eq!(s.ask("nope", "hi", "x".into(), 101), Err(AskError::NoShare));
        assert_eq!(s.ask("tok-a", "   ", "x".into(), 101), Err(AskError::Empty));
        assert_eq!(s.ask("tok-a", &"x".repeat(MAX_ASK + 1), "x".into(), 101), Err(AskError::TooLong));
        for n in 0..MAX_PENDING {
            s.ask("tok-a", "hi", format!("q{n}"), 101).unwrap();
        }
        assert_eq!(s.ask("tok-a", "hi", "over".into(), 101), Err(AskError::TooMany));
        // Thread B's cap is its own.
        s.ask("tok-b", "hi", "b1".into(), 101).unwrap();
    }

    #[test]
    fn links_expire_and_revoking_or_resharing_kills_the_old_url() {
        let mut s = two_threads();
        assert!(s.feed("tok-a", 100 + TTL_SECS).is_none(), "expired");
        assert_eq!(s.ask("tok-a", "hi", "x".into(), 100 + TTL_SECS), Err(AskError::NoShare));
        s.create("a", "tok-a2".into(), 200);
        assert!(s.feed("tok-a", 201).is_none(), "the old link died when a new one was made");
        assert!(s.feed("tok-a2", 201).is_some());
        s.ask("tok-a2", "hi", "q".into(), 201).unwrap();
        s.revoke("a");
        assert!(s.feed("tok-a2", 202).is_none());
        assert!(s.pending().is_empty(), "revoking drops its unanswered asks");
        assert!(!s.set_feed("a", json!({}), 202), "no feed is kept for a thread that isn't shared");
        assert!(s.feed("tok-b", 202).is_some(), "other shares are untouched");
    }
}

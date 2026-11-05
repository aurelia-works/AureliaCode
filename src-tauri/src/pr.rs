//! The pull request for a pane's branch, read with `gh pr view`, so a thread can show its
//! PR and wake its agent when checks fail, a review lands or the branch conflicts.

use crate::config::expand_path;
use crate::which;
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub number: u64,
    pub url: String,
    pub title: String,
    /// "OPEN" | "MERGED" | "CLOSED"
    pub state: String,
    pub draft: bool,
    /// "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "" (no review rule)
    pub review: String,
    pub conflicts: bool,
    /// "none" | "pending" | "pass" | "fail"
    pub checks: String,
    /// Names of the checks that failed.
    pub failing: Vec<String>,
    /// Reviews plus conversation comments; a rise means new feedback.
    pub feedback: u64,
}

const FAILED: [&str; 6] = ["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"];

/// Turns `gh pr view --json …` output into a PrInfo.
fn summarise(v: &Value) -> Option<PrInfo> {
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_string();
    let mut failing = Vec::new();
    let mut pending = false;
    let rollup = v["statusCheckRollup"].as_array().cloned().unwrap_or_default();
    for c in &rollup {
        // CheckRun: status + conclusion; StatusContext: state.
        let name = c["name"].as_str().or(c["context"].as_str()).unwrap_or("check").to_string();
        let conclusion = c["conclusion"].as_str().or(c["state"].as_str()).unwrap_or_default();
        let status = c["status"].as_str().unwrap_or("COMPLETED");
        if FAILED.contains(&conclusion) {
            failing.push(name);
        } else if status != "COMPLETED" || conclusion == "PENDING" || conclusion == "EXPECTED" || conclusion.is_empty() {
            pending = true;
        }
    }
    let checks = if rollup.is_empty() {
        "none"
    } else if !failing.is_empty() {
        "fail"
    } else if pending {
        "pending"
    } else {
        "pass"
    };
    let count = |k: &str| v[k].as_array().map_or(0, |a| a.len() as u64);
    Some(PrInfo {
        number: v["number"].as_u64()?,
        url: s("url"),
        title: s("title"),
        state: s("state"),
        draft: v["isDraft"].as_bool().unwrap_or(false),
        review: s("reviewDecision"),
        conflicts: v["mergeable"].as_str() == Some("CONFLICTING"),
        checks: checks.into(),
        failing,
        feedback: count("reviews") + count("comments"),
    })
}

/// The PR for the branch checked out in `dir`, or None when it has none (or gh is missing
/// or signed out: a thread just shows no PR then).
pub(crate) fn view_pr(dir: &Path) -> Result<Option<PrInfo>, String> {
    let Some(gh) = which::locate("gh") else { return Ok(None) };
    let out = Command::new(gh)
        .current_dir(dir)
        .args(["pr", "view", "--json", "number,url,title,state,isDraft,reviewDecision,mergeable,statusCheckRollup,reviews,comments"])
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|e| format!("gh: {e}"))?;
    if !out.status.success() {
        return Ok(None);
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    Ok(summarise(&v))
}

#[tauri::command]
pub async fn pr_status(cwd: String) -> Result<Option<PrInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || view_pr(&PathBuf::from(expand_path(&cwd))))
        .await
        .map_err(|e| e.to_string())?
}

/// The last `limit` merged PRs of the repo at `cwd`, as `gh pr list` JSON, for the human-time stats
/// (src/lib/humanStats.ts does the counting). Empty when gh is missing, signed out, or it isn't a GitHub repo.
#[tauri::command]
pub async fn pr_history(cwd: String, limit: Option<u32>) -> Result<Value, String> {
    let limit = limit.unwrap_or(50).clamp(1, 200).to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let Some(gh) = which::locate("gh") else { return Ok(Value::Array(vec![])) };
        let out = Command::new(gh)
            .current_dir(PathBuf::from(expand_path(&cwd)))
            .args(["pr", "list", "--state", "merged", "--limit", &limit, "--json", "number,title,body,author,createdAt,mergedAt,labels,reviews,comments"])
            .env("GH_PROMPT_DISABLED", "1")
            .output()
            .map_err(|e| format!("gh: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---- Merge queue (src/lib/mergeQueue.ts, src/store/mergeQueue.ts) ----

#[derive(Debug, Serialize, PartialEq)]
pub struct Synced {
    /// The head commit after the rebase (and push).
    pub sha: String,
    /// Rebasing conflicted; it was aborted and nothing was pushed.
    pub conflict: bool,
}

fn git_in(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git").current_dir(dir).args(args).output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(format!("git {}: {}", args.join(" "), String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Rebases the branch checked out in `dir` on `origin/<base>` and pushes it (with lease). A conflict aborts the
/// rebase and leaves the branch as it was. Refuses when the worktree has uncommitted changes.
pub(crate) fn sync_branch(dir: &Path, base: &str, push: bool) -> Result<Synced, String> {
    if !git_in(dir, &["status", "--porcelain"])?.is_empty() {
        return Err("The worktree has uncommitted changes".into());
    }
    git_in(dir, &["fetch", "-q", "origin", base])?;
    if let Err(e) = git_in(dir, &["rebase", "-q", &format!("origin/{base}")]) {
        let _ = git_in(dir, &["rebase", "--abort"]);
        // Only a real conflict is "conflicts"; anything else (a ref lock, a hook) is reported as it is.
        if !e.to_lowercase().contains("conflict") {
            return Err(e);
        }
        return Ok(Synced { sha: git_in(dir, &["rev-parse", "HEAD"])?, conflict: true });
    }
    if push {
        git_in(dir, &["push", "-q", "--force-with-lease", "origin", "HEAD"])?;
    }
    Ok(Synced { sha: git_in(dir, &["rev-parse", "HEAD"])?, conflict: false })
}

fn gh_json(dir: &Path, args: &[&str]) -> Result<Value, String> {
    let gh = which::locate("gh").ok_or("gh isn't installed")?;
    let out = Command::new(gh).current_dir(dir).args(args).env("GH_PROMPT_DISABLED", "1").output().map_err(|e| format!("gh: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pr_sync(cwd: String) -> Result<Synced, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(expand_path(&cwd));
        let v = gh_json(&dir, &["pr", "view", "--json", "baseRefName"])?;
        let base = v["baseRefName"].as_str().filter(|b| !b.is_empty()).ok_or("The PR has no base branch")?.to_string();
        sync_branch(&dir, &base, true)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The PR's head commit and its conversation comments, so the queue can find the reviewer verdict for that commit.
#[tauri::command]
pub async fn pr_comments(cwd: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || gh_json(&PathBuf::from(expand_path(&cwd)), &["pr", "view", "--json", "headRefOid,headRefName,comments"]))
        .await
        .map_err(|e| e.to_string())?
}

/// Squash-merges the PR only if its head is still `sha`, then deletes the remote branch. The local branch stays: a
/// worktree may have it checked out.
#[tauri::command]
pub async fn pr_merge(cwd: String, sha: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = PathBuf::from(expand_path(&cwd));
        let gh = which::locate("gh").ok_or("gh isn't installed")?;
        let out = Command::new(&gh)
            .current_dir(&dir)
            .args(["pr", "merge", "--squash", "--match-head-commit", &sha])
            .env("GH_PROMPT_DISABLED", "1")
            .output()
            .map_err(|e| format!("gh: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        if let Ok(v) = gh_json(&dir, &["pr", "view", "--json", "headRefName"]) {
            if let Some(branch) = v["headRefName"].as_str() {
                let _ = git_in(&dir, &["push", "-q", "origin", "--delete", branch]);
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A scratch origin with `main`, and a clone on branch `feat` one commit ahead.
    fn scratch(name: &str) -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("aurelia-mq-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let (origin, work) = (root.join("origin.git"), root.join("work"));
        std::fs::create_dir_all(&root).unwrap();
        let g = |dir: &Path, args: &[&str]| git_in(dir, args).unwrap();
        g(&root, &["init", "-q", "--bare", "-b", "main", origin.to_str().unwrap()]);
        g(&root, &["clone", "-q", origin.to_str().unwrap(), work.to_str().unwrap()]);
        for (k, v) in [("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")] {
            g(&work, &["config", k, v]);
        }
        g(&work, &["checkout", "-q", "-b", "main"]);
        std::fs::write(work.join("a.txt"), "one\n").unwrap();
        g(&work, &["add", "."]);
        g(&work, &["commit", "-qm", "init"]);
        g(&work, &["push", "-q", "origin", "main"]);
        g(&work, &["checkout", "-q", "-b", "feat"]);
        std::fs::write(work.join("b.txt"), "feature\n").unwrap();
        g(&work, &["add", "."]);
        g(&work, &["commit", "-qm", "feat"]);
        (root, work)
    }

    /// Moves origin/main on from a second clone, writing `a.txt`.
    fn advance_main(root: &Path, text: &str) {
        let other = root.join("other");
        let g = |dir: &Path, args: &[&str]| git_in(dir, args).unwrap();
        g(root, &["clone", "-q", "-b", "main", root.join("origin.git").to_str().unwrap(), other.to_str().unwrap()]);
        for (k, v) in [("user.name", "t"), ("user.email", "t@t"), ("commit.gpgsign", "false")] {
            g(&other, &["config", k, v]);
        }
        std::fs::write(other.join("a.txt"), text).unwrap();
        g(&other, &["commit", "-qam", "main moves"]);
        g(&other, &["push", "-q", "origin", "main"]);
    }

    #[test]
    fn sync_rebases_on_the_new_base() {
        let (root, work) = scratch("clean");
        advance_main(&root, "two\n");
        let r = sync_branch(&work, "main", false).unwrap();
        assert!(!r.conflict);
        assert_eq!(git_in(&work, &["rev-parse", "HEAD~1"]).unwrap(), git_in(&work, &["rev-parse", "origin/main"]).unwrap(), "feat sits on the new main");
        assert_eq!(r.sha, git_in(&work, &["rev-parse", "HEAD"]).unwrap());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn a_conflict_aborts_and_leaves_the_branch_alone() {
        let (root, work) = scratch("conflict");
        std::fs::write(work.join("a.txt"), "mine\n").unwrap();
        git_in(&work, &["commit", "-qam", "touch a"]).unwrap();
        let before = git_in(&work, &["rev-parse", "HEAD"]).unwrap();
        advance_main(&root, "theirs\n");
        let r = sync_branch(&work, "main", false).unwrap();
        assert!(r.conflict);
        assert_eq!(r.sha, before);
        assert_eq!(git_in(&work, &["status", "--porcelain"]).unwrap(), "", "no rebase left half done");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn sync_refuses_uncommitted_work() {
        let (root, work) = scratch("dirty");
        std::fs::write(work.join("b.txt"), "edited\n").unwrap();
        assert!(sync_branch(&work, "main", false).unwrap_err().contains("uncommitted"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn failing_check_wins_over_pending() {
        let v = json!({
            "number": 12, "url": "u", "title": "t", "state": "OPEN", "isDraft": false,
            "reviewDecision": "CHANGES_REQUESTED", "mergeable": "CONFLICTING",
            "statusCheckRollup": [
                {"__typename": "CheckRun", "name": "test", "status": "COMPLETED", "conclusion": "FAILURE"},
                {"__typename": "CheckRun", "name": "lint", "status": "IN_PROGRESS", "conclusion": ""},
                {"__typename": "StatusContext", "context": "ci/other", "state": "SUCCESS"}
            ],
            "reviews": [{}, {}], "comments": [{}]
        });
        let p = summarise(&v).unwrap();
        assert_eq!(p.checks, "fail");
        assert_eq!(p.failing, vec!["test".to_string()]);
        assert!(p.conflicts);
        assert_eq!(p.feedback, 3);
        assert_eq!(p.review, "CHANGES_REQUESTED");
    }

    #[test]
    fn checks_pending_then_pass_then_none() {
        let pending = json!({"number": 1, "statusCheckRollup": [{"context": "ci", "state": "PENDING"}]});
        assert_eq!(summarise(&pending).unwrap().checks, "pending");
        let pass = json!({"number": 1, "statusCheckRollup": [{"name": "a", "status": "COMPLETED", "conclusion": "SUCCESS"}, {"name": "b", "status": "COMPLETED", "conclusion": "SKIPPED"}]});
        assert_eq!(summarise(&pass).unwrap().checks, "pass");
        let none = json!({"number": 1, "statusCheckRollup": []});
        let p = summarise(&none).unwrap();
        assert_eq!(p.checks, "none");
        assert!(!p.conflicts);
        assert_eq!(p.feedback, 0);
    }

    #[test]
    fn no_number_is_no_pr() {
        assert_eq!(summarise(&json!({"state": "OPEN"})), None);
    }
}

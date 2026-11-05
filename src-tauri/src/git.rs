//! Git helpers for pane headers (branch / worktree), per-agent worktrees, and the
//! diff review panel. Branch info is read straight from `.git` so polling it for
//! every pane never forks a process.

use crate::config::expand_path;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitInfo {
    pub root: String,
    /// Branch name, or a short commit hash when HEAD is detached.
    pub branch: String,
    pub detached: bool,
    /// True when `root` is a linked worktree rather than the main checkout.
    pub worktree: bool,
    /// The main checkout's root (same as `root` outside a linked worktree), so a project's
    /// worktrees group under it.
    pub repo: String,
}

/// Nearest ancestor with a `.git` entry, plus the resolved git dir.
fn find_repo(start: &Path) -> Option<(PathBuf, PathBuf)> {
    let mut dir = start;
    loop {
        let dotgit = dir.join(".git");
        if dotgit.is_dir() {
            return Some((dir.to_path_buf(), dotgit));
        }
        if dotgit.is_file() {
            let text = fs::read_to_string(&dotgit).ok()?;
            let target = text.trim().strip_prefix("gitdir:")?.trim();
            let gitdir = if Path::new(target).is_absolute() { PathBuf::from(target) } else { dir.join(target) };
            return Some((dir.to_path_buf(), gitdir));
        }
        dir = dir.parent()?;
    }
}

#[tauri::command]
pub fn git_info(cwd: String) -> Option<GitInfo> {
    let (root, gitdir) = find_repo(Path::new(&expand_path(&cwd)))?;
    let head = fs::read_to_string(gitdir.join("HEAD")).ok()?;
    let head = head.trim();
    let (branch, detached) = match head.strip_prefix("ref: ") {
        Some(r) => (r.strip_prefix("refs/heads/").unwrap_or(r).to_string(), false),
        None => (head.chars().take(7).collect(), true),
    };
    let worktree = gitdir.parent().and_then(|p| p.file_name()).is_some_and(|n| n == "worktrees");
    // <repo>/.git/worktrees/<name> → <repo>
    let repo = if worktree { gitdir.parent().and_then(Path::parent).and_then(Path::parent).map(Path::to_path_buf) } else { None }.unwrap_or_else(|| root.clone());
    Some(GitInfo { root: root.to_string_lossy().into_owned(), branch, detached, worktree, repo: repo.to_string_lossy().into_owned() })
}

/// Unix time of the newest commit on HEAD, or None when there is no repo or no commit yet.
#[tauri::command]
pub fn git_last_commit(cwd: String) -> Option<i64> {
    let (root, _) = find_repo(Path::new(&expand_path(&cwd)))?;
    git_ok(&root, &["log", "-1", "--format=%ct"]).ok()?.parse().ok()
}

fn git(dir: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    Command::new("git").arg("-C").arg(dir).args(["-c", "core.quotepath=false"]).args(args).output().map_err(|e| format!("git: {e}"))
}

fn git_ok(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = git(dir, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

fn slug(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
        if out.len() >= 32 {
            break;
        }
    }
    let out = out.trim_end_matches('-').to_string();
    if out.is_empty() { "agent".into() } else { out }
}

/// Creates a new worktree on branch `aurelia/<label>-<n>` from the current HEAD, in
/// `<repo parent>/<repo>.worktrees/`, and returns its path.
#[tauri::command]
pub fn create_worktree(cwd: String, label: String) -> Result<String, String> {
    // Canonical, so it lines up with git's (symlink-resolved) toplevel below.
    let start = fs::canonicalize(expand_path(&cwd)).map_err(|e| e.to_string())?;
    let top = PathBuf::from(git_ok(&start, &["rev-parse", "--show-toplevel"]).map_err(|_| "not inside a git repository".to_string())?);
    let repo = top.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "repo".into());
    let base_dir = top.parent().unwrap_or(&top).join(format!("{repo}.worktrees"));
    fs::create_dir_all(&base_dir).map_err(|e| e.to_string())?;

    let base = slug(&label);
    let (name, path) = (1..1000)
        .map(|n| if n == 1 { base.clone() } else { format!("{base}-{n}") })
        .map(|name| (name.clone(), base_dir.join(&name)))
        .find(|(name, path)| {
            !path.exists() && git(&top, &["show-ref", "--verify", "--quiet", &format!("refs/heads/aurelia/{name}")]).map(|o| !o.status.success()).unwrap_or(true)
        })
        .ok_or("could not pick a worktree name")?;

    let path_str = path.to_string_lossy().into_owned();
    git_ok(&top, &["worktree", "add", "-b", &format!("aurelia/{name}"), &path_str])?;
    // Keep the agent in the same subdirectory it was started from.
    let rel = start.strip_prefix(&top).ok().filter(|r| !r.as_os_str().is_empty());
    Ok(match rel {
        Some(r) if path.join(r).is_dir() => path.join(r).to_string_lossy().into_owned(),
        _ => path_str,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: String,
    /// Uncommitted or untracked files: removing it would lose work.
    pub dirty: bool,
}

/// `<repo parent>/<repo>.worktrees/`, where create_worktree puts them. Only worktrees in
/// here are offered for cleanup, so one made by hand elsewhere is never touched.
fn worktrees_dir(repo: &Path) -> Option<PathBuf> {
    let name = repo.file_name()?.to_string_lossy().into_owned();
    Some(repo.parent()?.join(format!("{name}.worktrees")))
}

/// The main checkout of the repository `dir` belongs to (worktree or not).
fn main_checkout(dir: &Path) -> Result<PathBuf, String> {
    let common = git_ok(dir, &["rev-parse", "--path-format=absolute", "--git-common-dir"]).map_err(|_| "not inside a git repository".to_string())?;
    let common = PathBuf::from(common);
    let repo = if common.file_name().is_some_and(|n| n == ".git") { common.parent().map(Path::to_path_buf) } else { None };
    repo.ok_or_else(|| "bare repositories aren't supported".into())
}

/// Parses `git worktree list --porcelain` into (path, branch) pairs, skipping the main checkout.
fn parse_worktrees(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for block in text.split("\n\n").skip(1) {
        let mut path = None;
        let mut branch = String::new();
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                path = Some(p.to_string());
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = b.strip_prefix("refs/heads/").unwrap_or(b).to_string();
            } else if line == "detached" {
                branch = "(detached)".into();
            }
        }
        if let Some(p) = path {
            out.push((p, branch));
        }
    }
    out
}

/// The repository's AureliaSpace worktrees (the ones under `<repo>.worktrees/`).
#[tauri::command]
pub fn list_worktrees(cwd: String) -> Result<Vec<WorktreeEntry>, String> {
    let repo = main_checkout(&PathBuf::from(expand_path(&cwd)))?;
    let Some(home) = worktrees_dir(&repo) else { return Ok(vec![]) };
    let home = fs::canonicalize(&home).unwrap_or(home);
    let text = git_ok(&repo, &["worktree", "list", "--porcelain"])?;
    Ok(parse_worktrees(&text)
        .into_iter()
        .filter(|(p, _)| Path::new(p).starts_with(&home))
        .map(|(path, branch)| {
            // A folder deleted by hand counts as clean: there is nothing left to lose.
            let dirty = Path::new(&path).is_dir() && git_ok(Path::new(&path), &["status", "--porcelain"]).map(|s| !s.is_empty()).unwrap_or(true);
            WorktreeEntry { path, branch, dirty }
        })
        .collect())
}

/// Removes one of AureliaSpace's worktrees and its `aurelia/*` branch when that is merged.
/// Refuses a worktree with uncommitted changes, and anything outside `<repo>.worktrees/`.
#[tauri::command]
pub fn remove_worktree(path: String) -> Result<(), String> {
    let path = PathBuf::from(expand_path(&path));
    let listed = list_worktrees(path.to_string_lossy().into_owned()).map_err(|_| "not one of AureliaSpace's worktrees".to_string())?;
    let canon = fs::canonicalize(&path).unwrap_or(path.clone());
    let entry = listed
        .into_iter()
        .find(|w| Path::new(&w.path) == canon || Path::new(&w.path) == path)
        .ok_or("not one of AureliaSpace's worktrees")?;
    if entry.dirty {
        return Err(format!("{} has uncommitted changes", Path::new(&entry.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()));
    }
    let repo = main_checkout(&canon)?;
    git_ok(&repo, &["worktree", "remove", &entry.path])?;
    // -d, not -D: an unmerged branch stays (a squash-merged one too; GitHub keeps the PR).
    if entry.branch.starts_with("aurelia/") {
        let _ = git_ok(&repo, &["branch", "-d", &entry.branch]);
    }
    let _ = git_ok(&repo, &["worktree", "prune"]);
    Ok(())
}

const MAX_DIFF: usize = 2 * 1024 * 1024;
const MAX_UNTRACKED: usize = 40;
const MAX_UNTRACKED_BYTES: u64 = 200 * 1024;

#[derive(Serialize)]
pub struct Diff {
    pub(crate) root: String,
    pub(crate) diff: String,
    pub(crate) truncated: bool,
}

/// Uncommitted changes (staged + unstaged + untracked) relative to HEAD.
#[tauri::command]
pub fn git_diff(cwd: String) -> Result<Diff, String> {
    let start = PathBuf::from(expand_path(&cwd));
    let top = PathBuf::from(git_ok(&start, &["rev-parse", "--show-toplevel"]).map_err(|_| "not inside a git repository".to_string())?);
    let base = ["diff", "--no-color", "--no-ext-diff", "-U3"];
    let tracked = match git_ok(&top, &[&base[..], &["HEAD"]].concat()) {
        Ok(d) => d,
        Err(_) => git_ok(&top, &base)?, // no commits yet
    };
    let mut diff = tracked;
    let untracked = git_ok(&top, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    for file in untracked.split('\0').filter(|l| !l.is_empty()).take(MAX_UNTRACKED) {
        if fs::metadata(top.join(file)).map(|m| m.len() > MAX_UNTRACKED_BYTES).unwrap_or(true) {
            continue;
        }
        // Exits 1 when the files differ, which is always the case here.
        let out = git(&top, &["diff", "--no-color", "--no-ext-diff", "--no-index", "--", "/dev/null", file])?;
        if !diff.is_empty() {
            diff.push('\n');
        }
        diff.push_str(String::from_utf8_lossy(&out.stdout).trim_end());
        if diff.len() > MAX_DIFF {
            break;
        }
    }
    Ok(capped(&top, diff))
}

/// A diff cut to MAX_DIFF bytes (on a char boundary), so a huge change can't flood the UI.
pub(crate) fn capped(root: &Path, mut diff: String) -> Diff {
    let truncated = diff.len() > MAX_DIFF;
    if truncated {
        let mut cut = MAX_DIFF;
        while !diff.is_char_boundary(cut) {
            cut -= 1;
        }
        diff.truncate(cut);
    }
    Diff { root: root.to_string_lossy().into_owned(), diff, truncated }
}

/// What a thread has changed so far: uncommitted files and lines against HEAD, untracked
/// files included (the `+42 −7 · 3 files` on thread rows and cards).
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiffStat {
    pub files: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// Sums `git diff --numstat` output. Binary files ("-\t-\tpath") count as a file with no lines.
pub(crate) fn parse_numstat(out: &str) -> DiffStat {
    let mut s = DiffStat::default();
    for line in out.lines().filter(|l| !l.trim().is_empty()) {
        let mut parts = line.splitn(3, '\t');
        let (a, d) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        s.files += 1;
        s.additions += a.parse::<u32>().unwrap_or(0);
        s.deletions += d.parse::<u32>().unwrap_or(0);
    }
    s
}

#[tauri::command]
pub fn git_diffstat(cwd: String) -> Result<DiffStat, String> {
    let top = toplevel(&PathBuf::from(expand_path(&cwd)))?;
    let tracked = git_ok(&top, &["diff", "--numstat", "HEAD"]).or_else(|_| git_ok(&top, &["diff", "--numstat"]))?;
    let mut stat = parse_numstat(&tracked);
    let untracked = git_ok(&top, &["ls-files", "-z", "--others", "--exclude-standard"])?;
    for file in untracked.split('\0').filter(|l| !l.is_empty()) {
        stat.files += 1;
        let small = fs::metadata(top.join(file)).map(|m| m.len() <= MAX_UNTRACKED_BYTES).unwrap_or(false);
        if small {
            if let Ok(text) = fs::read_to_string(top.join(file)) {
                stat.additions += text.lines().count() as u32;
            }
        }
    }
    Ok(stat)
}

// ---------- The commit / push / PR / merge loop ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeStatus {
    /// Uncommitted or untracked files: merging or removing it would lose work.
    pub dirty: bool,
    pub branch: String,
    /// Unresolved merge conflicts in this worktree.
    pub conflicts: bool,
}

fn worktree_status_at(path: &Path) -> Result<WorktreeStatus, String> {
    let branch = git_ok(path, &["rev-parse", "--abbrev-ref", "HEAD"]).map_err(|_| "not inside a git worktree".to_string())?;
    let dirty = !git_ok(path, &["status", "--porcelain"])?.is_empty();
    let conflicts = !git_ok(path, &["diff", "--name-only", "--diff-filter=U"])?.is_empty();
    Ok(WorktreeStatus { dirty, branch, conflicts })
}

fn tree_name(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

fn toplevel(dir: &Path) -> Result<PathBuf, String> {
    git_ok(dir, &["rev-parse", "--show-toplevel"]).map(PathBuf::from).map_err(|_| "not inside a git repository".to_string())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitChange {
    pub path: String,
    /// For a rename/copy, the path it came from. Both are staged and committed together.
    pub old_path: Option<String>,
    /// M, A, D, R, C, U or ? for untracked.
    pub status: String,
    pub staged: bool,
    pub untracked: bool,
}

/// Working-tree changes, parsed from porcelain v1. The commit dialog shows these so a
/// person chooses what goes in instead of every stray file in the folder.
#[tauri::command]
pub fn git_changes(cwd: String) -> Result<Vec<GitChange>, String> {
    let top = toplevel(&PathBuf::from(expand_path(&cwd)))?;
    // -z keeps spaces and newlines in paths literal and makes renames two NUL fields.
    // Read raw stdout: the leading space in " D path" is part of the status, and trim() eats it.
    let out = git(&top, &["status", "--porcelain=v1", "-z", "--untracked-files=all"])?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut fields = text.split('\0').filter(|f| !f.is_empty());
    let mut out = Vec::new();
    while let Some(entry) = fields.next() {
        if entry.len() < 4 {
            continue;
        }
        let xy = &entry[..2];
        let path = entry[3..].to_string();
        let old_path = if xy.starts_with('R') || xy.starts_with('C') { fields.next().map(String::from) } else { None };
        if path.is_empty() {
            continue;
        }
        let untracked = xy == "??";
        let staged = !untracked && xy.as_bytes()[0] != b' ';
        let status = if untracked {
            "?"
        } else if xy.as_bytes()[0] != b' ' {
            &xy[..1]
        } else {
            &xy[1..2]
        };
        out.push(GitChange { path, old_path, status: status.to_string(), staged, untracked });
    }
    Ok(out)
}

/// Stages only the selected paths, commits, and returns the short SHA.
#[tauri::command]
pub fn git_commit(cwd: String, message: String, paths: Vec<String>) -> Result<String, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("a commit message is required".into());
    }
    if paths.is_empty() {
        return Err("select at least one file to commit".into());
    }
    let top = toplevel(&PathBuf::from(expand_path(&cwd)))?;
    // Stage one path at a time. `git add -A -- old` errors when a rename's old path is
    // already staged as deleted (it is no longer in the worktree), so a missing path is
    // allowed to fail: the deletion/rename is already in the index.
    // `:(literal)` stops git from treating a filename like `star*.txt` or `:notes.txt` as
    // a glob or pathspec magic. It applies to both the add and the commit pathspec.
    let literal: Vec<String> = paths.iter().map(|p| format!(":(literal){p}")).collect();
    for path in &literal {
        let mut add = Command::new("git");
        add.arg("-C").arg(&top).args(["-c", "core.quotepath=false", "add", "-A", "--", path]);
        let out = add.output().map_err(|e| format!("git: {e}"))?;
        if !out.status.success() {
            let raw = path.strip_prefix(":(literal)").unwrap_or(path);
            if top.join(raw).exists() {
                return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
            }
        }
    }
    // Commit only the selected paths: other pre-staged files stay in the index.
    let mut commit = Command::new("git");
    commit.arg("-C").arg(&top).args(["commit", "-m", message, "--"]).args(&literal);
    let out = commit.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    git_ok(&top, &["rev-parse", "--short", "HEAD"])
}

/// Pushes the branch checked out in `cwd`, setting its upstream on the first push.
fn push(cwd: String) -> Result<String, String> {
    let top = toplevel(&PathBuf::from(expand_path(&cwd)))?;
    let branch = git_ok(&top, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if branch == "HEAD" {
        return Err("cannot push a detached HEAD".into());
    }
    let out = git(&top, &["push", "--set-upstream", "origin", &branch])?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(format!("Pushed {branch} to origin"))
}

/// Network-bound: keep it off the command thread.
#[tauri::command]
pub async fn git_push(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || push(cwd)).await.map_err(|e| e.to_string())?
}

/// Creates a PR with `gh`, then reads it back in the same shape as `pr_status`.
fn create_pr(cwd: String, title: String, body: String, draft: bool) -> Result<crate::pr::PrInfo, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("a PR title is required".into());
    }
    let dir = PathBuf::from(expand_path(&cwd));
    let Some(gh) = crate::which::locate("gh") else {
        return Err("GitHub CLI (gh) is not installed".into());
    };
    let mut cmd = Command::new(gh);
    cmd.current_dir(&dir)
        .args(["pr", "create", "--title", title, "--body", body.as_str()])
        .env("GH_PROMPT_DISABLED", "1");
    if draft {
        cmd.arg("--draft");
    }
    let out = cmd.output().map_err(|e| format!("gh: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    crate::pr::view_pr(&dir)?.ok_or_else(|| "the PR was created but gh could not read it back".to_string())
}

/// Network-bound: keep it off the command thread.
#[tauri::command]
pub async fn git_create_pr(cwd: String, title: String, body: String, draft: bool) -> Result<crate::pr::PrInfo, String> {
    tauri::async_runtime::spawn_blocking(move || create_pr(cwd, title, body, draft)).await.map_err(|e| e.to_string())?
}

/// What `gh pr view --json state,mergeCommit,baseRefName` says to revert: (merge sha, base branch).
fn revert_plan(number: u64, json: &str) -> Result<(String, String), String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|e| format!("gh: {e}"))?;
    if v["state"].as_str() != Some("MERGED") {
        return Err(format!("PR #{number} isn't merged, so there is nothing to revert"));
    }
    let sha = v["mergeCommit"]["oid"].as_str().filter(|s| !s.is_empty()).ok_or(format!("gh didn't say which commit merged PR #{number}"))?;
    let base = v["baseRefName"].as_str().filter(|s| !s.is_empty()).unwrap_or("main");
    Ok((sha.to_string(), base.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revert {
    pub path: String,
    pub branch: String,
    /// `git revert` stopped on conflicts; they're left in the worktree to resolve.
    pub conflicts: bool,
}

/// Undo a merged PR fast (Theo Browne, 2026-11-04: "you need to be able to roll it back fast"):
/// a worktree on `aurelia/revert-pr-<n>` from the PR's base with its merge commit reverted.
/// Nothing is pushed; the thread opened there takes it from here.
fn revert_pr(cwd: String, number: u64) -> Result<Revert, String> {
    let dir = PathBuf::from(expand_path(&cwd));
    let gh = crate::which::locate("gh").ok_or("GitHub CLI (gh) is not installed")?;
    let out = Command::new(gh)
        .current_dir(&dir)
        .args(["pr", "view", &number.to_string(), "--json", "state,mergeCommit,baseRefName"])
        .env("GH_PROMPT_DISABLED", "1")
        .output()
        .map_err(|e| format!("gh: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let (sha, base) = revert_plan(number, &String::from_utf8_lossy(&out.stdout))?;
    let top = main_checkout(&dir)?;
    let _ = git(&top, &["fetch", "-q", "origin", &base]);
    // Know the merge commit before making anything, so a failure leaves no worktree or branch behind.
    let commit = format!("{sha}^{{commit}}");
    if !git(&top, &["cat-file", "-e", &commit])?.status.success() {
        let _ = git(&top, &["fetch", "-q", "origin", &sha]);
        if !git(&top, &["cat-file", "-e", &commit])?.status.success() {
            return Err(format!("couldn't fetch {sha}, the commit that merged PR #{number}"));
        }
    }
    let parents = git_ok(&top, &["rev-list", "--parents", "-n", "1", &sha])?.split_whitespace().count();
    let root = worktrees_dir(&top).ok_or("could not place the worktree")?;
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let (branch, path) = (1..100)
        .map(|n| if n == 1 { format!("revert-pr-{number}") } else { format!("revert-pr-{number}-{n}") })
        .map(|name| (format!("aurelia/{name}"), root.join(&name)))
        .find(|(b, p)| !p.exists() && git(&top, &["show-ref", "--verify", "--quiet", &format!("refs/heads/{b}")]).map(|o| !o.status.success()).unwrap_or(true))
        .ok_or("could not pick a worktree name")?;
    let path_str = path.to_string_lossy().into_owned();
    git_ok(&top, &["worktree", "add", "-b", &branch, &path_str, &format!("origin/{base}")])?;
    // A true merge commit needs a parent to revert against; a squash merge doesn't.
    let mut args = vec!["revert", "--no-edit"];
    if parents > 2 {
        args.extend(["-m", "1"]);
    }
    args.push(&sha);
    let conflicts = !git(&path, &args)?.status.success();
    Ok(Revert { path: path_str, branch, conflicts })
}

/// Network-bound: keep it off the command thread.
#[tauri::command]
pub async fn git_revert_pr(cwd: String, number: u64) -> Result<Revert, String> {
    tauri::async_runtime::spawn_blocking(move || revert_pr(cwd, number)).await.map_err(|e| e.to_string())?
}

/// A worktree's branch, dirty state and conflicts, without merging anything.
#[tauri::command]
pub fn git_worktree_status(path: String) -> Result<WorktreeStatus, String> {
    let path = fs::canonicalize(expand_path(&path)).map_err(|e| e.to_string())?;
    worktree_status_at(&path)
}

/// Merges a worktree's branch into the main checkout. Refuses a dirty or conflicted
/// worktree (and a dirty main checkout), and aborts the merge on conflict, leaving the
/// worktree and both checkouts exactly as they were.
#[tauri::command]
pub fn git_merge_worktree(path: String) -> Result<String, String> {
    let path = fs::canonicalize(expand_path(&path)).map_err(|e| e.to_string())?;
    let name = tree_name(&path);
    let status = worktree_status_at(&path)?;
    if status.conflicts {
        return Err(format!("{name} has unresolved conflicts; finish or abort its merge first"));
    }
    if status.dirty {
        return Err(format!("{name} has uncommitted changes; commit or discard them before merging"));
    }
    if status.branch == "HEAD" || status.branch.is_empty() {
        return Err(format!("{name} is a detached worktree; check out its branch before merging"));
    }
    let repo = main_checkout(&path)?;
    if fs::canonicalize(&repo).map(|r| r == path).unwrap_or(false) {
        return Err("that is the main checkout, not a worktree".into());
    }
    let target = git_ok(&repo, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    if target == status.branch {
        return Err(format!("{target} is already checked out in the main checkout"));
    }
    if !git_ok(&repo, &["status", "--porcelain"])?.is_empty() {
        return Err(format!("{target} has uncommitted changes; commit or stash them before merging {}", status.branch));
    }
    let out = git(&repo, &["merge", "--no-edit", &status.branch])?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        // Never leave a half-finished merge in the main checkout.
        let _ = git_ok(&repo, &["merge", "--abort"]);
        return Err(if detail.is_empty() { format!("merging {} failed", status.branch) } else { format!("merging {} failed: {detail}", status.branch) });
    }
    Ok(format!("Merged {} into {target}", status.branch))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revert_needs_a_merged_pr_and_its_merge_commit() {
        let ok = r#"{"state":"MERGED","mergeCommit":{"oid":"abc123"},"baseRefName":"main"}"#;
        assert_eq!(revert_plan(16, ok).unwrap(), ("abc123".to_string(), "main".to_string()));
        let open = r#"{"state":"OPEN","mergeCommit":null,"baseRefName":"main"}"#;
        assert!(revert_plan(16, open).unwrap_err().contains("isn't merged"));
        let no_sha = r#"{"state":"MERGED","mergeCommit":null,"baseRefName":"dev"}"#;
        assert!(revert_plan(16, no_sha).is_err());
    }

    fn repo() -> PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let parent = std::env::temp_dir().join(format!("aurelia-wt-{}-{n}", std::process::id()));
        let dir = parent.join("repo");
        let _ = fs::remove_dir_all(&parent);
        fs::create_dir_all(&dir).unwrap();
        for args in [&["init", "-q", "-b", "main"][..], &["config", "user.email", "t@t"], &["config", "user.name", "t"]] {
            git_ok(&dir, args).unwrap();
        }
        fs::write(dir.join("a.txt"), "one").unwrap();
        git_ok(&dir, &["add", "-A"]).unwrap();
        git_ok(&dir, &["commit", "-qm", "init"]).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn numstat_sums_files_and_lines_and_counts_binaries_as_files() {
        assert_eq!(parse_numstat("3\t1\tsrc/a.ts\n10\t0\tb.md\n-\t-\timg.png\n"), DiffStat { files: 3, additions: 13, deletions: 1 });
        assert_eq!(parse_numstat(""), DiffStat::default());
    }

    #[test]
    fn diffstat_counts_edits_and_untracked_files() {
        let root = repo();
        fs::write(root.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        fs::write(root.join("new.txt"), "x\ny\n").unwrap();
        let s = git_diffstat(root.to_string_lossy().into()).unwrap();
        assert_eq!(s.files, 2);
        assert_eq!(s.additions, 3 + 2);
        assert_eq!(s.deletions, 1);
    }

    #[test]
    fn removes_clean_worktree_and_merged_branch_but_keeps_dirty_and_foreign_ones() {
        let root = repo();
        let clean = create_worktree(root.to_string_lossy().into(), "one".into()).unwrap();
        let dirty = create_worktree(root.to_string_lossy().into(), "two".into()).unwrap();
        fs::write(Path::new(&dirty).join("new.txt"), "work").unwrap();
        let foreign = root.parent().unwrap().join("elsewhere");
        git_ok(&root, &["worktree", "add", "-q", "-b", "mine", &foreign.to_string_lossy()]).unwrap();

        let listed = list_worktrees(root.to_string_lossy().into()).unwrap();
        assert_eq!(listed.len(), 2, "the hand-made worktree isn't listed");
        assert!(listed.iter().any(|w| w.branch == "aurelia/two" && w.dirty));

        remove_worktree(clean.clone()).unwrap();
        assert!(!Path::new(&clean).exists());
        assert!(git_ok(&root, &["show-ref", "--verify", "--quiet", "refs/heads/aurelia/one"]).is_err(), "merged branch deleted");
        assert!(remove_worktree(dirty.clone()).unwrap_err().contains("uncommitted"));
        assert!(remove_worktree(foreign.to_string_lossy().into()).is_err());
        assert!(Path::new(&dirty).exists() && foreign.exists());
    }

    #[test]
    fn parses_porcelain_list_without_the_main_checkout() {
        let text = "worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r.worktrees/a\nHEAD def\nbranch refs/heads/aurelia/a\n\nworktree /r.worktrees/b\nHEAD 123\ndetached\n";
        assert_eq!(parse_worktrees(text), vec![("/r.worktrees/a".into(), "aurelia/a".into()), ("/r.worktrees/b".into(), "(detached)".into())]);
    }

    #[test]
    fn commit_stages_only_the_selected_paths_and_returns_a_short_sha() {
        let root = repo();
        fs::write(root.join("b.txt"), "b").unwrap();
        fs::write(root.join("secret.txt"), "do not commit").unwrap();
        let changes = git_changes(root.to_string_lossy().into()).unwrap();
        assert!(changes.iter().any(|c| c.path == "b.txt" && c.untracked));
        let sha = git_commit(root.to_string_lossy().into(), "add b".into(), vec!["b.txt".into()]).unwrap();
        assert_eq!(sha.len(), 7);
        assert_eq!(git_ok(&root, &["status", "--porcelain"]).unwrap(), "?? secret.txt");
        assert!(git_commit(root.to_string_lossy().into(), "   ".into(), vec!["b.txt".into()]).unwrap_err().contains("message"));
        assert!(git_commit(root.to_string_lossy().into(), "nothing".into(), vec![]).unwrap_err().contains("select"));

        // A file staged before the dialog stays staged when it isn't selected.
        fs::write(root.join("staged.txt"), "staged").unwrap();
        git_ok(&root, &["add", "staged.txt"]).unwrap();
        fs::write(root.join("chosen.txt"), "chosen").unwrap();
        git_commit(root.to_string_lossy().into(), "chosen only".into(), vec!["chosen.txt".into()]).unwrap();
        assert_eq!(git_ok(&root, &["status", "--porcelain"]).unwrap(), "A  staged.txt\n?? secret.txt");
    }

    #[test]
    fn commit_treats_pathspec_characters_literally() {
        let root = repo();
        fs::write(root.join(":notes.txt"), "notes").unwrap();
        fs::write(root.join("star*.txt"), "literal").unwrap();
        fs::write(root.join("star1.txt"), "other").unwrap();
        git_commit(root.to_string_lossy().into(), "notes".into(), vec![":notes.txt".into()]).unwrap();
        let status = git_ok(&root, &["status", "--porcelain"]).unwrap();
        assert!(status.contains("?? star*.txt") && status.contains("?? star1.txt"), "{status}");
        git_commit(root.to_string_lossy().into(), "literal star".into(), vec!["star*.txt".into()]).unwrap();
        let status = git_ok(&root, &["status", "--porcelain"]).unwrap();
        assert_eq!(status, "?? star1.txt");
    }

    #[test]
    fn commit_can_commit_an_already_staged_deletion() {
        let root = repo();
        git_ok(&root, &["rm", "a.txt"]).unwrap();
        let changes = git_changes(root.to_string_lossy().into()).unwrap();
        assert!(changes.iter().any(|c| c.path == "a.txt" && c.status == "D" && c.staged));
        git_commit(root.to_string_lossy().into(), "remove a".into(), vec!["a.txt".into()]).unwrap();
        assert!(git_ok(&root, &["status", "--porcelain"]).unwrap().is_empty());
    }

    #[test]
    fn commit_can_commit_a_rename_with_both_paths() {
        let root = repo();
        git_ok(&root, &["mv", "a.txt", "b.txt"]).unwrap();
        let changes = git_changes(root.to_string_lossy().into()).unwrap();
        let renamed = changes.iter().find(|c| c.path == "b.txt").unwrap();
        assert_eq!(renamed.old_path.as_deref(), Some("a.txt"));
        let paths = vec!["b.txt".to_string(), "a.txt".to_string()];
        git_commit(root.to_string_lossy().into(), "rename a".into(), paths).unwrap();
        assert!(git_ok(&root, &["status", "--porcelain"]).unwrap().is_empty());
    }

    #[test]
    fn commit_can_commit_a_deletion() {
        let root = repo();
        fs::remove_file(root.join("a.txt")).unwrap();
        let changes = git_changes(root.to_string_lossy().into()).unwrap();
        assert!(changes.iter().any(|c| c.path == "a.txt" && c.status == "D"), "{changes:?}");
        git_commit(root.to_string_lossy().into(), "remove a".into(), vec!["a.txt".into()]).unwrap();
        assert!(git_ok(&root, &["status", "--porcelain"]).unwrap().is_empty());
    }

    #[test]
    fn changes_reads_a_rename_and_a_path_with_spaces() {
        let root = repo();
        fs::write(root.join("a b.txt"), "one").unwrap();
        git_ok(&root, &["add", "-A"]).unwrap();
        git_ok(&root, &["commit", "-qm", "spaces"]).unwrap();
        git_ok(&root, &["mv", "a b.txt", "c d.txt"]).unwrap();
        let changes = git_changes(root.to_string_lossy().into()).unwrap();
        let renamed = changes.iter().find(|c| c.path == "c d.txt").unwrap();
        assert_eq!(renamed.old_path.as_deref(), Some("a b.txt"));
        assert_eq!(renamed.status, "R");
    }

    #[test]
    fn worktree_status_sees_dirty_and_merge_refuses_it() {
        let root = repo();
        let wt = create_worktree(root.to_string_lossy().into(), "status".into()).unwrap();
        let wt_path = PathBuf::from(&wt);
        let clean = git_worktree_status(wt.clone()).unwrap();
        assert_eq!(clean.branch, "aurelia/status");
        assert!(!clean.dirty && !clean.conflicts);

        fs::write(wt_path.join("new.txt"), "work").unwrap();
        assert!(git_worktree_status(wt.clone()).unwrap().dirty);
        let err = git_merge_worktree(wt.clone()).unwrap_err();
        assert!(err.contains("uncommitted"), "{err}");
        assert!(wt_path.exists(), "a refused merge leaves the worktree alone");
    }

    #[test]
    fn merge_brings_a_committed_worktree_branch_into_the_main_checkout() {
        let root = repo();
        let wt = create_worktree(root.to_string_lossy().into(), "merge".into()).unwrap();
        let wt_path = PathBuf::from(&wt);
        fs::write(wt_path.join("a.txt"), "two").unwrap();
        git_ok(&wt_path, &["commit", "-qam", "two"]).unwrap();

        let msg = git_merge_worktree(wt.clone()).unwrap();
        assert!(msg.contains("aurelia/merge"), "{msg}");
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "two");
        assert!(wt_path.exists(), "merging never removes the worktree");
    }

    #[test]
    fn a_conflicting_merge_is_aborted_and_changes_nothing() {
        let root = repo();
        let wt = create_worktree(root.to_string_lossy().into(), "clash".into()).unwrap();
        let wt_path = PathBuf::from(&wt);
        fs::write(wt_path.join("a.txt"), "worktree").unwrap();
        git_ok(&wt_path, &["commit", "-qam", "worktree"]).unwrap();
        fs::write(root.join("a.txt"), "main").unwrap();
        git_ok(&root, &["commit", "-qam", "main"]).unwrap();

        let err = git_merge_worktree(wt.clone()).unwrap_err();
        assert!(err.contains("failed"), "{err}");
        assert!(!root.join(".git").join("MERGE_HEAD").exists(), "the merge was aborted");
        assert_eq!(fs::read_to_string(root.join("a.txt")).unwrap(), "main");
        assert!(wt_path.exists());
    }
}

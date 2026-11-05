//! Post-run reviewer: grades the uncommitted changes in a repo against scorers, using a
//! read-only DeepSeek agent through OpenCode (subagents.rs), so a review never spends
//! Claude limits. Scorers are markdown rubrics in `<repo>/.aurelia/scorers/*.md`, one
//! per file; without any, a built-in set covers correctness, regressions, security,
//! tests and simplicity.

use crate::{git, subagents};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

/// More than enough diff for a review; DeepSeek reads the rest of the repo itself.
const MAX_REVIEW_DIFF: usize = 300_000;
const MAX_SCORER: usize = 8_000;

const DEFAULT_SCORERS: &str = "## Correctness\nDoes the change do what it sets out to without breaking existing behaviour? \
Look for wrong conditions, off-by-one errors, unhandled errors and races.\n\n\
## Regressions\nAre callers, configs or tests affected by changed signatures, defaults or behaviour?\n\n\
## Security\nSecrets in code, shell/SQL/path injection, unsafe file operations, widened permissions.\n\n\
## Tests\nAre risky changes covered, and were existing tests updated where behaviour changed?\n\n\
## Simplicity\nDead code, duplicated logic, needless complexity.";

const TASK: &str = "Review the uncommitted change in the attached diff (`git diff HEAD` plus new files). Read files in \
the repository when you need context. Judge the change against each scorer in Context. For each scorer write one line \
`<scorer>: PASS` or `<scorer>: FAIL - <reason>`, followed by the specific problems with file:line. Report only real \
problems you can point to, no style nits unless a scorer asks for them. End with exactly one line: `VERDICT: ship`, \
`VERDICT: fix` or `VERDICT: block`.";

#[derive(Debug, Serialize)]
pub struct ReviewResult {
    pub text: String,
    /// "ship" | "fix" | "block", when the reviewer gave one.
    pub verdict: Option<String>,
    pub scorers: Vec<String>,
    pub model: String,
    pub seconds: f64,
    pub failed: bool,
}

/// The scorers for a repo: (names, text for the agent).
fn scorers(root: &Path) -> (Vec<String>, String) {
    let mut files: Vec<_> = fs::read_dir(root.join(".aurelia/scorers"))
        .map(|rd| rd.filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "md")).collect())
        .unwrap_or_default();
    files.sort();
    let mut names = vec![];
    let mut text = String::new();
    for path in files {
        let Ok(body) = fs::read_to_string(&path) else { continue };
        let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let body: String = body.chars().take(MAX_SCORER).collect();
        text.push_str(&format!("## {name}\n{}\n\n", body.trim()));
        names.push(name);
    }
    if names.is_empty() {
        let defaults = DEFAULT_SCORERS.lines().filter_map(|l| l.strip_prefix("## ")).map(String::from).collect();
        return (defaults, DEFAULT_SCORERS.to_string());
    }
    (names, text.trim_end().to_string())
}

/// The last `VERDICT:` line's word.
fn verdict(report: &str) -> Option<String> {
    report.lines().rev().find_map(|l| {
        let rest = l.trim().trim_matches(|c| c == '*' || c == '`').trim().strip_prefix("VERDICT:")?;
        let word = rest.trim().trim_matches(|c: char| !c.is_ascii_alphabetic()).to_lowercase();
        ["ship", "fix", "block"].contains(&word.as_str()).then_some(word)
    })
}

fn temp_diff(diff: &str) -> Result<std::path::PathBuf, String> {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let path = std::env::temp_dir().join(format!("aurelia-review-{}-{nanos}.diff", std::process::id()));
    let mut cut = diff.len().min(MAX_REVIEW_DIFF);
    while !diff.is_char_boundary(cut) {
        cut -= 1;
    }
    fs::write(&path, &diff[..cut]).map_err(|e| e.to_string())?;
    Ok(path)
}

#[tauri::command]
pub async fn review_changes(cwd: String) -> Result<ReviewResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let d = git::git_diff(cwd)?;
        if d.diff.trim().is_empty() {
            return Err("No uncommitted changes to review.".into());
        }
        let root = Path::new(&d.root);
        let (names, rubric) = scorers(root);
        let diff_path = temp_diff(&d.diff)?;
        let started = Instant::now();
        let mut context = format!("Scorers:\n\n{rubric}");
        if d.truncated || d.diff.len() > MAX_REVIEW_DIFF {
            context.push_str("\n\nThe diff was cut short; read the changed files for the rest.");
        }
        let run = subagents::run_read_only(TASK.into(), Some(context), vec![diff_path.to_string_lossy().into_owned()], &d.root, None);
        let _ = fs::remove_file(&diff_path);
        let run = run?;
        Ok(ReviewResult {
            verdict: verdict(&run.report),
            text: run.rendered,
            scorers: names,
            model: run.model,
            seconds: started.elapsed().as_secs_f64(),
            failed: run.failed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The council (Theo Browne, 2026-11-04): each reviewer reads the diff on its own, scores it and
/// tags what it finds, so src/lib/council.ts can keep the findings two of them agree on.
const COUNCIL_TASK: &str = "Review the uncommitted change in the attached diff (`git diff HEAD` plus new files) as one \
member of a review council; other reviewers read it separately. Read files in the repository when you need context, and \
judge it against the scorers in Context. List each real problem on its own line as \
`- [important] path/to/file.ext:LINE - what is wrong`, using [important] for bugs and risks this change introduces, [nit] \
for small things, and [pre-existing] for problems that were there before this change. Use the file path from the diff and \
the line in the new file. No praise, no style nits unless a scorer asks. Then score the change: 1 means throw it away, \
10 means there is no reason not to merge it. End with exactly two lines: `SCORE: n/10` and `VERDICT: ship`, `VERDICT: fix` \
or `VERDICT: block`.";

const EXPLAIN_TASK: &str = "Explain the uncommitted change in the attached diff to the person about to merge it. Read files \
in the repository when you need context. Write three short sections with these exact headings: `What is changing`, `Why`, \
`Where is the risk` (what could break and what to check by hand). Plain words, no code blocks, under 200 words in all.";

#[derive(Debug, Serialize)]
pub struct CouncilSeat {
    pub model: String,
    pub text: String,
    pub failed: bool,
    pub seconds: f64,
}

/// The diff in a temp file plus the scorer context, for one or more read-only runs.
fn prepare(cwd: String) -> Result<(git::Diff, String, std::path::PathBuf), String> {
    let d = git::git_diff(cwd)?;
    if d.diff.trim().is_empty() {
        return Err("No uncommitted changes to review.".into());
    }
    let (_, rubric) = scorers(Path::new(&d.root));
    let mut context = format!("Scorers:\n\n{rubric}");
    if d.truncated || d.diff.len() > MAX_REVIEW_DIFF {
        context.push_str("\n\nThe diff was cut short; read the changed files for the rest.");
    }
    let path = temp_diff(&d.diff)?;
    Ok((d, context, path))
}

/// Up to 3 reviewers at once, one per model ("" is the subagent model). Never spends Claude limits.
fn run_seats(task: &str, context: &str, files: &[String], root: &str, models: Vec<String>) -> Vec<CouncilSeat> {
    let models: Vec<String> = if models.is_empty() { vec![String::new(), String::new()] } else { models.into_iter().take(3).collect() };
    std::thread::scope(|scope| {
        let runs: Vec<_> = models
            .iter()
            .map(|m| {
                scope.spawn(move || {
                    let started = Instant::now();
                    let model = Some(m.as_str()).filter(|m| !m.trim().is_empty());
                    match subagents::run_read_only(task.into(), Some(context.into()), files.to_vec(), root, model) {
                        Ok(r) => CouncilSeat { model: r.model, text: r.report, failed: r.failed, seconds: started.elapsed().as_secs_f64() },
                        Err(e) => CouncilSeat { model: m.clone(), text: e, failed: true, seconds: started.elapsed().as_secs_f64() },
                    }
                })
            })
            .collect();
        runs.into_iter().map(|h| h.join().unwrap_or(CouncilSeat { model: String::new(), text: "reviewer crashed".into(), failed: true, seconds: 0.0 })).collect()
    })
}

#[tauri::command]
pub async fn council_review(cwd: String, models: Vec<String>) -> Result<Vec<CouncilSeat>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (d, context, diff_path) = prepare(cwd)?;
        let seats = run_seats(COUNCIL_TASK, &context, &[diff_path.to_string_lossy().into_owned()], &d.root, models);
        let _ = fs::remove_file(&diff_path);
        Ok(seats)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Nightly review of old code (Theo Browne, 2026-11-04 02:24: "Review agents also are running nightly over existing
/// code helping catch old bugs"). Same council and tags, but over one folder's files instead of a diff.
const AUDIT_TASK: &str = "Review the existing code in the attached files as one member of a review council; other \
reviewers read them separately. Nothing here is a new change: look for real bugs that are already there (wrong results, \
crashes, races, swallowed errors, security holes, dead code that hides a bug). Read other files in the repository when you \
need context. List each real problem on its own line as `- [important] path/to/file.ext:LINE - what is wrong`, using \
[important] for bugs and risks and [nit] for small things. Use the path from the repository root. Only list what you can \
point at in the code; no style comments, no praise. Then score the folder's health: 1 means it is broken, 10 means you found \
nothing worth fixing. End with exactly two lines: `SCORE: n/10` and `VERDICT: ship`, `VERDICT: fix` or `VERDICT: block`.";

const SOURCE: &[&str] = &["rs", "ts", "tsx", "js", "jsx", "mjs", "py", "go", "java", "kt", "swift", "rb", "c", "cc", "cpp", "h", "cs"];
const AUDIT_FILES: usize = 30;

fn is_source(path: &str) -> bool {
    path.rsplit_once('.').is_some_and(|(_, ext)| SOURCE.contains(&ext))
}

/// The folders the nightly review rotates through: each directory (up to two levels deep) that holds tracked source
/// files directly, sorted. Root-level files count as "".
fn audit_folders_of(paths: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = paths
        .iter()
        .filter(|p| is_source(p))
        .map(|p| match p.rsplit_once('/') {
            Some((dir, _)) => dir.split('/').take(2).collect::<Vec<_>>().join("/"),
            None => String::new(),
        })
        .collect();
    out.sort();
    out.dedup();
    out
}

/// Up to AUDIT_FILES source files in `folder` (and below it), tests last, so the reviewers read the code first.
fn audit_files_of<'a>(paths: &[&'a str], folder: &str) -> Vec<&'a str> {
    let inside = |p: &&&str| if folder.is_empty() { !p.contains('/') } else { p.starts_with(&format!("{folder}/")) };
    let is_test = |p: &str| p.contains(".test.") || p.contains("_test.") || p.contains("/tests/") || p.contains(".spec.");
    let mut files: Vec<&str> = paths.iter().filter(inside).filter(|p| is_source(p)).copied().collect();
    files.sort_by_key(|p| (is_test(p), *p));
    files.truncate(AUDIT_FILES);
    files
}

fn tracked(cwd: &str) -> Result<(String, Vec<String>), String> {
    let dir = crate::config::expand_path(cwd);
    let run = |args: &[&str]| -> Result<String, String> {
        let out = std::process::Command::new("git").current_dir(&dir).args(args).output().map_err(|e| format!("git: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    };
    let root = run(&["rev-parse", "--show-toplevel"])?.trim().to_string();
    let files = run(&["-C", &root, "ls-files"])?.lines().map(str::to_string).collect();
    Ok((root, files))
}

#[derive(Debug, Serialize)]
pub struct AuditPlan {
    /// The repo's top folder, so two threads in one repo count as one repo.
    pub root: String,
    pub folders: Vec<String>,
}

#[tauri::command]
pub async fn audit_folders(cwd: String) -> Result<AuditPlan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, files) = tracked(&cwd)?;
        Ok(AuditPlan { folders: audit_folders_of(&files.iter().map(String::as_str).collect::<Vec<_>>()), root })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn council_audit(cwd: String, folder: String, models: Vec<String>) -> Result<Vec<CouncilSeat>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (root, files) = tracked(&cwd)?;
        let all: Vec<&str> = files.iter().map(String::as_str).collect();
        let picked: Vec<String> = audit_files_of(&all, &folder).into_iter().map(|f| format!("{root}/{f}")).collect();
        if picked.is_empty() {
            return Err(format!("No source files in {}", if folder.is_empty() { "the repo root" } else { &folder }));
        }
        let (_, rubric) = scorers(Path::new(&root));
        let context = format!("Folder: {}\n\nScorers:\n\n{rubric}", if folder.is_empty() { "(repo root)" } else { &folder });
        Ok(run_seats(AUDIT_TASK, &context, &picked, &root, models))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// What is changing, why, and where the risk is, in plain words.
#[tauri::command]
pub async fn explain_changes(cwd: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (d, _, diff_path) = prepare(cwd)?;
        let run = subagents::run_read_only(EXPLAIN_TASK.into(), None, vec![diff_path.to_string_lossy().into_owned()], &d.root, None);
        let _ = fs::remove_file(&diff_path);
        let run = run?;
        if run.failed {
            return Err(run.rendered);
        }
        Ok(run.report)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nightly_folders_are_source_dirs_two_levels_deep() {
        let paths = ["README.md", "build.rs", "src/lib/a.ts", "src/lib/deep/b.ts", "src/c.tsx", "src-tauri/src/x.rs", "docs/guide.md"];
        assert_eq!(audit_folders_of(&paths), vec!["", "src", "src-tauri/src", "src/lib"]);
    }

    #[test]
    fn nightly_files_put_code_before_tests_and_stay_in_the_folder() {
        let paths = ["src/lib/a.test.ts", "src/lib/b.ts", "src/lib/deep/c.ts", "src/libx/d.ts", "src/lib/notes.md", "top.rs"];
        assert_eq!(audit_files_of(&paths, "src/lib"), vec!["src/lib/b.ts", "src/lib/deep/c.ts", "src/lib/a.test.ts"]);
        assert_eq!(audit_files_of(&paths, ""), vec!["top.rs"]);
    }

    #[test]
    fn reads_the_last_verdict() {
        assert_eq!(verdict("a: PASS\nVERDICT: ship").as_deref(), Some("ship"));
        assert_eq!(verdict("VERDICT: fix\nmore\n**VERDICT: Block**").as_deref(), Some("block"));
        assert_eq!(verdict("`VERDICT: fix.`").as_deref(), Some("fix"));
        assert_eq!(verdict("VERDICT: maybe"), None);
        assert_eq!(verdict("no verdict here"), None);
    }

    #[test]
    fn uses_repo_scorers_or_the_defaults() {
        let dir = std::env::temp_dir().join(format!("aurelia-review-scorers-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let (names, text) = scorers(&dir);
        assert_eq!(names, ["Correctness", "Regressions", "Security", "Tests", "Simplicity"]);
        assert!(text.contains("## Security"));

        fs::create_dir_all(dir.join(".aurelia/scorers")).unwrap();
        fs::write(dir.join(".aurelia/scorers/b-perf.md"), "No allocations in the render loop.\n").unwrap();
        fs::write(dir.join(".aurelia/scorers/a-api.md"), "Public functions keep their signatures.").unwrap();
        fs::write(dir.join(".aurelia/scorers/notes.txt"), "ignored").unwrap();
        let (names, text) = scorers(&dir);
        assert_eq!(names, ["a-api", "b-perf"]);
        assert_eq!(text, "## a-api\nPublic functions keep their signatures.\n\n## b-perf\nNo allocations in the render loop.");
        let _ = fs::remove_dir_all(&dir);
    }

    /// One real nightly run (OpenCode, no Claude limits): `cargo test audit_live -- --ignored --nocapture`.
    /// AUDIT_FOLDER picks the folder (default src/store) of this repo.
    #[test]
    #[ignore]
    fn audit_live() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_string_lossy().into_owned();
        let folder = std::env::var("AUDIT_FOLDER").unwrap_or_else(|_| "src/store".into());
        let seats = tauri::async_runtime::block_on(council_audit(repo, folder, vec![])).unwrap();
        for s in &seats {
            println!("--- {} ({:.0}s, failed: {})\n{}", s.model, s.seconds, s.failed, s.text);
        }
        assert!(seats.iter().any(|s| !s.failed && s.text.contains("SCORE:")), "at least one reviewer should finish with a score");
    }

    /// Live: a real DeepSeek review of a planted bug. `cargo test review_live -- --ignored`
    #[test]
    #[ignore]
    fn review_live() {
        let dir = std::env::temp_dir().join(format!("aurelia-review-live-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| assert!(std::process::Command::new("git").args(args).current_dir(&dir).output().unwrap().status.success());
        git(&["init", "-q"]);
        fs::write(dir.join("auth.py"), "def can_delete(user, doc):\n    return user.id == doc.owner_id\n").unwrap();
        git(&["add", "."]);
        git(&["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init"]);
        fs::write(dir.join("auth.py"), "def can_delete(user, doc):\n    return user.id == doc.owner_id or True\n").unwrap();
        let r = tauri::async_runtime::block_on(review_changes(dir.to_string_lossy().into_owned())).unwrap();
        println!("{} in {:.1}s\n{}", r.verdict.as_deref().unwrap_or("-"), r.seconds, r.text);
        assert!(matches!(r.verdict.as_deref(), Some("fix") | Some("block")), "the planted bug should not ship");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn diff_is_capped_on_a_char_boundary() {
        let big = "é".repeat(MAX_REVIEW_DIFF);
        let p = temp_diff(&big).unwrap();
        let written = fs::read_to_string(&p).unwrap();
        assert!(written.len() <= MAX_REVIEW_DIFF && written.chars().all(|c| c == 'é'));
        let _ = fs::remove_file(p);
    }
}

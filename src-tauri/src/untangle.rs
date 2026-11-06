//! Bundled `/untangle-codebase` skill. The bytes are compiled in (`include_str!`).
//! Install copies them into one isolated account's `skills/untangle-codebase/` folder.
//! The shared `~/.claude` account is refused, so nothing is written there. No shell.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::config::{expand_path, Account};

pub const SKILL_NAME: &str = "untangle-codebase";
const MARKER_FILE: &str = ".aurelia-untangle";
const MARKER_ID: &str = "aurelia-bundled-untangle-codebase";

const SKILL_MD: &str = include_str!("../resources/untangle-codebase/SKILL.md");
const LICENSE: &str = include_str!("../resources/untangle-codebase/LICENSE");
const NOTICE: &str = include_str!("../resources/untangle-codebase/NOTICE");

const MARKER: &str = "\
aurelia-bundled-untangle-codebase
Adapted from caldoai/skills, MIT, Copyright (c) 2026 Maze
https://github.com/caldoai/skills/tree/main/skills/untangle-codebase
";

const SHARED_REASON: &str = "The shared ~/.claude account is not an isolated Claude config. Install is unavailable, so this skill is not written there.";
const MISSING_REASON: &str = "That account folder doesn't exist. Install is unavailable, and nothing was written to the shared ~/.claude folder.";
const SYMLINK_REASON: &str =
    "A symlink is in the way. Install is unavailable, so nothing is written through it.";
const NOT_INSTALLED_REASON: &str = "Not installed. New sessions will not list /untangle-codebase until you install it into this account.";
const CONFLICT_REASON: &str = "A skill named untangle-codebase is already in this account and was not installed by AureliaCode. It was left unchanged.";
const OUTDATED_REASON: &str = "Installed, but the files differ from the bundled skill. Reinstall replaces only AureliaCode's files in this skill folder.";
const INSTALLED_REASON: &str = "Installed and matches the bundled skill.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UntangleState {
    Unavailable,
    NotInstalled,
    Conflict,
    Outdated,
    Installed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntangleDisk {
    pub state: UntangleState,
    pub reason: String,
    pub config_dir: Option<String>,
    pub skill_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UntangleAsset {
    pub skill: String,
    pub license: String,
    pub notice: String,
}

fn disk(
    state: UntangleState,
    reason: &str,
    config_dir: Option<String>,
    skill_dir: Option<String>,
) -> UntangleDisk {
    UntangleDisk {
        state,
        reason: reason.to_string(),
        config_dir,
        skill_dir,
    }
}

fn is_symlink(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
}

fn skill_dir(root: &Path) -> PathBuf {
    root.join("skills").join(SKILL_NAME)
}

fn owned(dir: &Path) -> bool {
    fs::read_to_string(dir.join(MARKER_FILE))
        .map(|s| s.starts_with(MARKER_ID))
        .unwrap_or(false)
}

fn file_eq(path: &Path, expected: &str) -> bool {
    fs::read(path)
        .map(|bytes| bytes == expected.as_bytes())
        .unwrap_or(false)
}

fn packaged_match(dir: &Path) -> bool {
    file_eq(&dir.join("SKILL.md"), SKILL_MD)
        && file_eq(&dir.join("LICENSE"), LICENSE)
        && file_eq(&dir.join("NOTICE"), NOTICE)
}

/// Account folder we may inspect. Does not create anything. The default `~/.claude`
/// account and a missing or symlinked folder are unavailable.
fn root_ok(account: &Account) -> Result<PathBuf, UntangleDisk> {
    let resolved = account.resolved_dir();
    if account.is_default() || resolved == expand_path("~/.claude") {
        return Err(disk(
            UntangleState::Unavailable,
            SHARED_REASON,
            Some(resolved),
            None,
        ));
    }
    let root = PathBuf::from(&resolved);
    if is_symlink(&root) {
        return Err(disk(
            UntangleState::Unavailable,
            SYMLINK_REASON,
            Some(resolved),
            None,
        ));
    }
    if !root.is_dir() {
        return Err(disk(
            UntangleState::Unavailable,
            MISSING_REASON,
            Some(resolved),
            None,
        ));
    }
    Ok(root)
}

fn classify(root: &Path) -> UntangleDisk {
    let resolved = root.display().to_string();
    let skills = root.join("skills");
    let dir = skill_dir(root);
    let skill_dir_s = Some(dir.display().to_string());
    if is_symlink(&skills)
        || is_symlink(&dir)
        || (skills.exists() && !skills.is_dir())
        || (dir.exists() && !dir.is_dir())
    {
        return disk(
            UntangleState::Unavailable,
            SYMLINK_REASON,
            Some(resolved),
            None,
        );
    }
    let has_skill = dir.join("SKILL.md").is_file();
    if has_skill && !owned(&dir) {
        return disk(
            UntangleState::Conflict,
            CONFLICT_REASON,
            Some(resolved),
            skill_dir_s,
        );
    }
    if !owned(&dir) {
        return disk(
            UntangleState::NotInstalled,
            NOT_INSTALLED_REASON,
            Some(resolved),
            skill_dir_s,
        );
    }
    if packaged_match(&dir) {
        disk(
            UntangleState::Installed,
            INSTALLED_REASON,
            Some(resolved),
            skill_dir_s,
        )
    } else {
        disk(
            UntangleState::Outdated,
            OUTDATED_REASON,
            Some(resolved),
            skill_dir_s,
        )
    }
}

pub fn inspect_account(account: &Account) -> UntangleDisk {
    match root_ok(account) {
        Ok(root) => classify(&root),
        Err(blocked) => blocked,
    }
}

fn ensure_dir(path: &Path) -> Result<(), String> {
    if is_symlink(path) {
        return Err(SYMLINK_REASON.into());
    }
    if path.exists() {
        if path.is_dir() {
            return Ok(());
        }
        return Err(format!("{} is not a directory", path.display()));
    }
    fs::create_dir(path).map_err(|e| e.to_string())
}

fn write_owned(dir: &Path) -> Result<(), String> {
    for name in ["SKILL.md", "LICENSE", "NOTICE", MARKER_FILE] {
        let path = dir.join(name);
        if is_symlink(&path) {
            return Err(SYMLINK_REASON.into());
        }
    }
    // Marker first, so a write that stops halfway is ours (outdated) and can be retried.
    fs::write(dir.join(MARKER_FILE), MARKER).map_err(|e| e.to_string())?;
    fs::write(dir.join("SKILL.md"), SKILL_MD).map_err(|e| e.to_string())?;
    fs::write(dir.join("LICENSE"), LICENSE).map_err(|e| e.to_string())?;
    fs::write(dir.join("NOTICE"), NOTICE).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn install_account(account: &Account) -> Result<UntangleDisk, String> {
    let root = match root_ok(account) {
        Ok(root) => root,
        Err(blocked) => return Ok(blocked),
    };
    let current = classify(&root);
    if matches!(
        current.state,
        UntangleState::Unavailable | UntangleState::Conflict
    ) {
        return Ok(current);
    }
    ensure_dir(&root.join("skills"))?;
    let dir = skill_dir(&root);
    ensure_dir(&dir)?;
    write_owned(&dir)?;
    let after = classify(&root);
    if after.state != UntangleState::Installed {
        return Err("install didn't match the bundled skill".into());
    }
    Ok(after)
}

fn find<'a>(accounts: &'a [Account], name: &str) -> Result<&'a Account, String> {
    accounts
        .iter()
        .find(|a| a.name == name)
        .ok_or_else(|| format!("unknown account '{name}'"))
}

pub fn status_for(accounts: &[Account], name: &str) -> Result<UntangleDisk, String> {
    Ok(inspect_account(find(accounts, name)?))
}

pub fn install_for(accounts: &[Account], name: &str) -> Result<UntangleDisk, String> {
    install_account(find(accounts, name)?)
}

pub fn asset() -> UntangleAsset {
    UntangleAsset {
        skill: SKILL_MD.to_string(),
        license: LICENSE.to_string(),
        notice: NOTICE.to_string(),
    }
}

#[tauri::command]
pub fn untangle_status(account: String) -> Result<UntangleDisk, String> {
    status_for(&crate::config::load().accounts, &account)
}

#[tauri::command]
pub fn untangle_install(account: String) -> Result<UntangleDisk, String> {
    install_for(&crate::config::load().accounts, &account)
}

#[tauri::command]
pub fn untangle_asset() -> UntangleAsset {
    asset()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("aurelia-untangle-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn acct(name: &str, dir: &Path) -> Account {
        Account {
            name: name.into(),
            config_dir: dir.to_string_lossy().into_owned(),
        }
    }

    #[test]
    fn packaged_asset_keeps_the_full_skill_and_license() {
        let packed = asset();
        assert!(packed.skill.len() > 4000, "skill text was truncated");
        assert!(packed.license.len() > 500, "license text was truncated");
        assert!(packed.skill.contains("disable-model-invocation: true"));
        assert!(!packed.skill.contains("disable-model-invocation: false"));
        assert!(packed
            .skill
            .contains("Adapted from caldoai/skills, MIT, Copyright (c) 2026 Maze"));
        assert!(packed
            .skill
            .contains("https://github.com/caldoai/skills/tree/main/skills/untangle-codebase"));
        assert!(packed.skill.contains("/untangle-codebase [optional area]"));
        assert!(packed.skill.contains("Never invoke it on your own"));
        assert!(packed
            .skill
            .contains("Remove comments that only restate the code."));
        assert!(packed.skill.contains(
            "Remove tests that wouldn't catch a real bug, and fix the ones that fail without one."
        ));
        assert!(packed.skill.contains("**Hidden links:**"));
        assert!(packed.skill.contains("**Needless links:**"));
        assert!(packed.skill.contains("**Surplus:**"));
        assert!(packed.skill.contains("decision-log-example"));
        assert!(packed.skill.contains("Test this at the end."));
        assert!(packed.skill.contains("$ARGUMENTS"));
        assert_eq!(packed.skill.matches("$ARGUMENTS").count(), 1);
        assert!(packed.license.contains("Copyright (c) 2026 Maze"));
        assert!(packed.license.contains(
            "Permission is hereby granted, free of charge, to any person obtaining a copy"
        ));
        assert!(packed
            .license
            .contains("THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND"));
        assert!(packed
            .notice
            .contains("Adapted from caldoai/skills, MIT, Copyright (c) 2026 Maze"));
        assert!(packed
            .notice
            .contains("https://github.com/caldoai/skills/tree/main/skills/untangle-codebase"));
        let code = include_str!("untangle.rs")
            .split("mod tests")
            .next()
            .unwrap();
        assert!(!code.contains("Command::"));
        assert!(!code.contains("std::process"));
    }

    #[test]
    fn shared_claude_dir_is_unavailable_and_not_a_write_target() {
        let accounts = vec![Account {
            name: "claude".into(),
            config_dir: "~/.claude".into(),
        }];
        let got = install_for(&accounts, "claude").unwrap();
        assert_eq!(got.state, UntangleState::Unavailable);
        assert_eq!(got.reason, SHARED_REASON);
        assert!(got.skill_dir.is_none());
        let status = status_for(&accounts, "claude").unwrap();
        assert_eq!(status.state, UntangleState::Unavailable);
    }

    #[test]
    fn missing_account_folder_is_unavailable_and_not_created() {
        let root = temp("missing");
        let missing = root.join("nope");
        let accounts = vec![acct("work", &missing)];
        let got = install_for(&accounts, "work").unwrap();
        assert_eq!(got.state, UntangleState::Unavailable);
        assert_eq!(got.reason, MISSING_REASON);
        assert!(!missing.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_routes_to_the_named_account_and_preserves_the_asset() {
        let root = temp("route");
        let work = root.join("work");
        let other = root.join("other");
        fs::create_dir(&work).unwrap();
        fs::create_dir(&other).unwrap();
        fs::create_dir_all(other.join("skills/keep")).unwrap();
        fs::write(other.join("skills/keep/SKILL.md"), "name: keep\n").unwrap();
        let accounts = vec![
            Account {
                name: "claude".into(),
                config_dir: "~/.claude".into(),
            },
            acct("work", &work),
            acct("other", &other),
        ];
        assert!(install_for(&accounts, "nope").is_err());
        let before = status_for(&accounts, "work").unwrap();
        assert_eq!(before.state, UntangleState::NotInstalled);
        assert!(
            !work.join("skills").exists(),
            "status must not create the skills folder"
        );

        let got = install_for(&accounts, "work").unwrap();
        assert_eq!(got.state, UntangleState::Installed);
        assert_eq!(
            got.skill_dir.as_deref(),
            Some(
                work.join("skills")
                    .join(SKILL_NAME)
                    .to_string_lossy()
                    .as_ref()
            )
        );
        let dir = work.join("skills").join(SKILL_NAME);
        assert_eq!(fs::read_to_string(dir.join("SKILL.md")).unwrap(), SKILL_MD);
        assert_eq!(fs::read_to_string(dir.join("LICENSE")).unwrap(), LICENSE);
        assert_eq!(fs::read_to_string(dir.join("NOTICE")).unwrap(), NOTICE);
        assert!(fs::read_to_string(dir.join(MARKER_FILE))
            .unwrap()
            .starts_with(MARKER_ID));
        assert_eq!(
            fs::read_to_string(other.join("skills/keep/SKILL.md")).unwrap(),
            "name: keep\n"
        );
        assert!(!other.join("skills").join(SKILL_NAME).exists());
        assert_eq!(
            status_for(&accounts, "work").unwrap().state,
            UntangleState::Installed
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_user_skill_with_the_same_name_is_left_unchanged() {
        let root = temp("conflict");
        let work = root.join("work");
        let dir = work.join("skills").join(SKILL_NAME);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: untangle-codebase\n---\nuser skill\n",
        )
        .unwrap();
        fs::write(dir.join("notes.txt"), "keep me\n").unwrap();
        let accounts = vec![acct("work", &work)];
        let got = install_for(&accounts, "work").unwrap();
        assert_eq!(got.state, UntangleState::Conflict);
        assert_eq!(got.reason, CONFLICT_REASON);
        assert_eq!(
            fs::read_to_string(dir.join("SKILL.md")).unwrap(),
            "---\nname: untangle-codebase\n---\nuser skill\n"
        );
        assert!(!dir.join(MARKER_FILE).exists());
        assert_eq!(
            fs::read_to_string(dir.join("notes.txt")).unwrap(),
            "keep me\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn reinstall_updates_only_our_files() {
        let root = temp("reinstall");
        let work = root.join("work");
        fs::create_dir_all(&work).unwrap();
        let accounts = vec![acct("work", &work)];
        install_for(&accounts, "work").unwrap();
        let dir = work.join("skills").join(SKILL_NAME);
        fs::write(dir.join("SKILL.md"), "stale copy\n").unwrap();
        fs::write(dir.join("notes.txt"), "keep me\n").unwrap();
        fs::create_dir_all(work.join("skills/other")).unwrap();
        fs::write(work.join("skills/other/SKILL.md"), "other\n").unwrap();
        let stale = status_for(&accounts, "work").unwrap();
        assert_eq!(stale.state, UntangleState::Outdated);
        assert_eq!(stale.reason, OUTDATED_REASON);
        let got = install_for(&accounts, "work").unwrap();
        assert_eq!(got.state, UntangleState::Installed);
        assert_eq!(fs::read_to_string(dir.join("SKILL.md")).unwrap(), SKILL_MD);
        assert_eq!(
            fs::read_to_string(dir.join("notes.txt")).unwrap(),
            "keep me\n"
        );
        assert_eq!(
            fs::read_to_string(work.join("skills/other/SKILL.md")).unwrap(),
            "other\n"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_symlink_skill_dir_is_not_followed() {
        let root = temp("symlink");
        let work = root.join("work");
        let outside = root.join("outside");
        fs::create_dir_all(work.join("skills")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, work.join("skills").join(SKILL_NAME)).unwrap();
        let accounts = vec![acct("work", &work)];
        let got = install_for(&accounts, "work").unwrap();
        assert_eq!(got.state, UntangleState::Unavailable);
        assert_eq!(got.reason, SYMLINK_REASON);
        assert!(fs::read_dir(&outside).unwrap().next().is_none());
        let _ = fs::remove_dir_all(&root);
    }
}

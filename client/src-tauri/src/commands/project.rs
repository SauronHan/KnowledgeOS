use std::fs;
use std::fs::File;
use std::io::{self, Write};
use std::path::Path;

use chrono::Local;

use crate::panic_guard::run_guarded;
use crate::types::wiki::WikiProject;

#[tauri::command]
pub fn create_project(name: String, path: String) -> Result<WikiProject, String> {
    run_guarded("create_project", || create_project_impl(name, path))
}

fn create_project_impl(name: String, path: String) -> Result<WikiProject, String> {
    let root = Path::new(&path).join(&name);

    if root.exists() {
        return Err(format!("Directory already exists: '{}'", root.display()));
    }

    // Create all required subdirectories
    let dirs = [
        "raw/sources",
        "raw/assets",
        "wiki/entities",
        "wiki/concepts",
        "wiki/sources",
        "wiki/queries",
        "wiki/comparisons",
        "wiki/synthesis",
    ];
    for dir in &dirs {
        fs::create_dir_all(root.join(dir))
            .map_err(|e| format!("Failed to create directory '{}': {}", dir, e))?;
    }

    let today = Local::now().format("%Y-%m-%d").to_string();

    // schema.md
    let schema_content = format!(
        r#"# Wiki Schema

## Page Types

| Type | Directory | Purpose |
|------|-----------|---------|
| entity | wiki/entities/ | Named things (models, companies, people, datasets) |
| concept | wiki/concepts/ | Ideas, techniques, phenomena |
| source | wiki/sources/ | Papers, articles, talks, blog posts |
| query | wiki/queries/ | Open questions under investigation |
| comparison | wiki/comparisons/ | Side-by-side analysis of related entities |
| synthesis | wiki/synthesis/ | Cross-cutting summaries and conclusions |

## Naming Conventions

- Files: `kebab-case.md`
- Entities: match official name where possible (e.g., `gpt-4.md`, `openai.md`)
- Concepts: descriptive noun phrases (e.g., `chain-of-thought.md`)
- Sources: `author-year-slug.md` (e.g., `wei-2022-chain-of-thought.md`)
- Queries: question as slug (e.g., `does-scale-improve-reasoning.md`)

## Frontmatter

All pages must include YAML frontmatter:

```yaml
---
type: entity | concept | source | query | comparison | synthesis | overview
title: Human-readable title
tags: []
related: []
created: YYYY-MM-DD
updated: YYYY-MM-DD
---
```

Source pages also include:
```yaml
authors: []
year: YYYY
url: ""
venue: ""
```

## Index Format

`wiki/index.md` lists all pages grouped by type. Each entry:
```
- [[page-slug]] — one-line description
```

## Log Format

`wiki/log.md` records research activity in reverse chronological order:
```
## YYYY-MM-DD

- Action taken / finding noted
```

## Cross-referencing Rules

- Use `[[page-slug]]` syntax to link between wiki pages
- Every entity and concept should appear in `wiki/index.md`
- Queries link to the sources and concepts they draw on
- Synthesis pages cite all contributing sources via `related:`

## Contradiction Handling

When sources contradict each other:
1. Note the contradiction in the relevant concept or entity page
2. Create or update a query page to track the open question
3. Link both sources from the query page
4. Resolve in a synthesis page once sufficient evidence exists
"#
    );
    write_file_inner(root.join("schema.md"), &schema_content)?;

    // purpose.md
    let purpose_content = r#"# Project Purpose

## Goal

<!-- What are you trying to understand or build? -->

## Key Questions

<!-- List the primary questions driving this research -->

1.
2.
3.

## Scope

<!-- What is in scope? What is explicitly out of scope? -->

**In scope:**
-

**Out of scope:**
-

## Thesis

<!-- Your current working hypothesis or conclusion (update as research progresses) -->

> TBD
"#;
    write_file_inner(root.join("purpose.md"), purpose_content)?;

    // wiki/index.md
    let index_content = r#"# Wiki Index

## Entities

## Concepts

## Sources

## Queries

## Comparisons

## Synthesis
"#;
    write_file_inner(root.join("wiki/index.md"), index_content)?;

    // wiki/log.md
    let log_content = format!(
        r#"# Research Log

## {today}

- Project created
"#
    );
    write_file_inner(root.join("wiki/log.md"), &log_content)?;

    // wiki/overview.md
    let overview_content = r#"---
type: overview
title: Project Overview
tags: []
related: []
---

# Overview

<!-- Provide a high-level summary of what this wiki covers and its current state. Update regularly as understanding deepens. -->
"#;
    write_file_inner(root.join("wiki/overview.md"), overview_content)?;

    // .obsidian config for Obsidian compatibility
    fs::create_dir_all(root.join(".obsidian"))
        .map_err(|e| format!("Failed to create .obsidian: {}", e))?;

    // Obsidian app config: set attachment folder, exclude hidden dirs
    let obsidian_app_config = r#"{
  "attachmentFolderPath": "raw/assets",
  "userIgnoreFilters": [
    ".cache",
    ".llm-wiki",
    ".superpowers"
  ],
  "useMarkdownLinks": false,
  "newLinkFormat": "shortest",
  "showUnsupportedFiles": false
}"#;
    write_file_inner(root.join(".obsidian/app.json"), obsidian_app_config)?;

    // Obsidian appearance: dark mode
    let obsidian_appearance = r#"{
  "baseFontSize": 16,
  "theme": "obsidian"
}"#;
    write_file_inner(root.join(".obsidian/appearance.json"), obsidian_appearance)?;

    // Enable graph view and backlinks core plugins
    let obsidian_core_plugins = r#"{
  "file-explorer": true,
  "global-search": true,
  "graph": true,
  "backlink": true,
  "tag-pane": true,
  "page-preview": true,
  "outgoing-link": true,
  "starred": true
}"#;
    write_file_inner(root.join(".obsidian/core-plugins.json"), obsidian_core_plugins)?;

    Ok(WikiProject {
        name,
        // Forward slashes for cross-platform consistency in the TS layer.
        path: root.to_string_lossy().replace('\\', "/"),
    })
}

#[tauri::command]
pub fn open_project(path: String) -> Result<WikiProject, String> {
    run_guarded("open_project", || {
        let root = Path::new(&path);

        if !root.exists() {
            return Err(format!("Path does not exist: '{}'", path));
        }
        if !root.is_dir() {
            return Err(format!("Path is not a directory: '{}'", path));
        }

        // Validate that this looks like a wiki project
        if !root.join("schema.md").exists() {
            return Err(format!(
                "Not a valid wiki project (missing schema.md): '{}'",
                path
            ));
        }
        if !root.join("wiki").is_dir() {
            return Err(format!(
                "Not a valid wiki project (missing wiki/ directory): '{}'",
                path
            ));
        }

        // Derive project name from the directory name
        let name = root
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();

        Ok(WikiProject {
            name,
            // Forward slashes for cross-platform consistency in the TS layer.
            path: path.replace('\\', "/"),
        })
    })
}

/// Download a shared project ZIP from the server, extract it to the local filesystem,
/// and return a WikiProject for the extracted directory.
#[tauri::command]
pub async fn download_and_extract_shared_project(
    url: String,
    token: String,
    target_dir: String,
    project_name: String,
    uuid: String,
) -> Result<WikiProject, String> {
    let uuid_short: String = uuid.chars().take(8).collect();
    let root = std::path::PathBuf::from(&target_dir).join(format!("{}-{}", project_name, uuid_short));

    if root.exists() {
        return Err(format!("Directory already exists: '{}'", root.display()));
    }

    // Download ZIP to temp file
    let tmp_dir = std::env::temp_dir().join("kos_downloads");
    fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    let tmp_path = tmp_dir.join(format!("{}.zip", uuid));

    let client = reqwest::Client::new();
    let resp = client
        .get(&url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with status: {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    // Write temp file and extract on a blocking thread
    let tmp_path_clone = tmp_path.clone();
    let project_name_clone = project_name.clone();
    let root_clone = root.clone();
    let root_path = tauri::async_runtime::spawn_blocking(move || {
        run_guarded("download_and_extract_shared_project", || {
            let mut f = File::create(&tmp_path_clone)
                .map_err(|e| format!("Failed to create temp file: {}", e))?;
            f.write_all(&bytes)
                .map_err(|e| format!("Failed to write temp file: {}", e))?;
            drop(f);

            let zip_file = File::open(&tmp_path_clone)
                .map_err(|e| format!("Failed to open temp ZIP: {}", e))?;
            let mut archive = zip::ZipArchive::new(zip_file)
                .map_err(|e| format!("Invalid ZIP file: {}", e))?;

            // Detect common root directory prefix (e.g. "S-Project01/").
            // When users zip a folder from Finder/Explorer, the ZIP wraps
            // everything inside one top-level directory. Strip that prefix
            // during extraction so schema.md lands directly under root_clone.
            let common_prefix = detect_common_root(&mut archive);
            let strip_len = match &common_prefix {
                Some(p) => p.len(),
                None => 0,
            };

            for i in 0..archive.len() {
                let mut entry = archive.by_index(i)
                    .map_err(|e| format!("Failed to read ZIP entry {}: {}", i, e))?;
                let entry_name = entry.name().to_string();

                if entry_name.contains("..") || entry_name.starts_with('/') || entry_name.starts_with('\\') {
                    continue;
                }

                // Skip the root directory entry itself if we're stripping
                if strip_len > 0 && entry_name == format!("{}/", &common_prefix.as_ref().unwrap().trim_end_matches('/')) {
                    continue;
                }
                if let Some(ref pfx) = common_prefix {
                    if entry_name == pfx.as_str() {
                        continue;
                    }
                }

                let relative = if strip_len > 0 && entry_name.starts_with(common_prefix.as_ref().unwrap()) {
                    &entry_name[strip_len..]
                } else {
                    &entry_name
                };

                let target = root_clone.join(relative);
                if entry.is_dir() {
                    fs::create_dir_all(&target)
                        .map_err(|e| format!("Failed to create directory '{}': {}", target.display(), e))?;
                } else {
                    if let Some(parent) = target.parent() {
                        fs::create_dir_all(parent)
                            .map_err(|e| format!("Failed to create parent dirs for '{}': {}", target.display(), e))?;
                    }
                    let mut outfile = File::create(&target)
                        .map_err(|e| format!("Failed to create file '{}': {}", target.display(), e))?;
                    io::copy(&mut entry, &mut outfile)
                        .map_err(|e| format!("Failed to extract '{}': {}", entry_name, e))?;
                }
            }

            drop(archive);
            let _ = fs::remove_file(&tmp_path_clone);

            if !root_clone.join("schema.md").exists() {
                return Err(format!(
                    "Extracted project missing schema.md: '{}'",
                    root_clone.display()
                ));
            }
            if !root_clone.join("wiki").is_dir() {
                return Err(format!(
                    "Extracted project missing wiki/ directory: '{}'",
                    root_clone.display()
                ));
            }

            let path = root_clone.to_string_lossy().replace('\\', "/");
            Ok(WikiProject { name: project_name_clone, path })
        })
    })
    .await
    .map_err(|e| format!("blocking task join error: {e}"))??;

    Ok(root_path)
}

fn write_file_inner(path: std::path::PathBuf, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create parent dirs for '{}': {}", path.display(), e))?;
    }
    fs::write(&path, contents)
        .map_err(|e| format!("Failed to write file '{}': {}", path.display(), e))
}

/// If every entry in the archive lives under a single top-level directory
/// (e.g. `S-Project01/schema.md`, `S-Project01/wiki/...`), return that
/// directory prefix with trailing `/`. Otherwise return None (flat ZIP).
fn detect_common_root(archive: &mut zip::ZipArchive<File>) -> Option<String> {
    let mut prefix: Option<String> = None;
    for i in 0..archive.len() {
        let name = match archive.by_index(i) {
            Ok(e) => e.name().to_string(),
            Err(_) => continue,
        };
        // Skip macOS resource forks and hidden metadata
        if name.starts_with("__MACOSX/") || name.contains("/.") || name == ".DS_Store" {
            continue;
        }
        // Get first path component
        let first = match name.find('/') {
            Some(pos) => &name[..pos + 1],  // "dir/"
            None => continue,                 // root-level file → no common prefix
        };
        match &prefix {
            None => prefix = Some(first.to_string()),
            Some(p) if p == first => {}
            _ => return None, // different prefixes → flat structure
        }
    }
    prefix
}

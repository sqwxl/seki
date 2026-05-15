---
description: "Validate current branch follows this repo's main-first development policy"
---

# Validate Development Branch

Validate that the current Git branch follows this repository's development
policy: use `main` unless the user explicitly requested a feature branch for the
current task.

## Prerequisites

- Check if Git is available by running `git rev-parse --is-inside-work-tree 2>/dev/null`
- If Git is not available, output a warning and skip validation:
  ```
  [specify] Warning: Git repository not detected; skipped branch validation
  ```

## Validation Rules

Get the current branch name:

```bash
git rev-parse --abbrev-ref HEAD
```

The branch name should be `main` by default.

Feature branch names are accepted only when the user explicitly requested a
branch workflow for the current task. Accepted feature branch patterns are:

1. **Sequential**: `^[0-9]{3,}-` (e.g., `001-feature-name`, `042-fix-bug`, `1000-big-feature`)
2. **Timestamp**: `^[0-9]{8}-[0-9]{6}-` (e.g., `20260319-143022-feature-name`)

## Execution

If on `main`:
- Output: `✓ On main branch`

If on an explicitly requested feature branch (matches either pattern):
- Output: `✓ On feature branch: <branch-name>`
- Check if the corresponding spec directory exists under `specs/`:
  - For sequential branches, look for `specs/<prefix>-*` where prefix matches the numeric portion
  - For timestamp branches, look for `specs/<prefix>-*` where prefix matches the `YYYYMMDD-HHMMSS` portion
- If spec directory exists: `✓ Spec directory found: <path>`
- If spec directory missing: `⚠ No spec directory found for prefix <prefix>`

If NOT on a feature branch:
- Output: `✗ Unexpected branch. Current branch: <branch-name>`
- Output: `Development should happen on main unless the user explicitly requested a feature branch.`

## Graceful Degradation

If Git is not installed or the directory is not a Git repository:
- Check the `SPECIFY_FEATURE` environment variable as a fallback
- If set, validate that value against the naming patterns
- If not set, skip validation with a warning

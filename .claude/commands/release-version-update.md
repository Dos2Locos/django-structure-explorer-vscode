---
name: release-version-update
description: Workflow command scaffold for release-version-update in django-structure-explorer-vscode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /release-version-update

Use this workflow when working on **release-version-update** in `django-structure-explorer-vscode`.

## Goal

Prepares a new release by updating the CHANGELOG and bumping the version in package.json.

## Common Files

- `CHANGELOG.md`
- `package.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Update CHANGELOG.md with release notes
- Update package.json version

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
---
name: update-ignore-files
description: Workflow command scaffold for update-ignore-files in django-structure-explorer-vscode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /update-ignore-files

Use this workflow when working on **update-ignore-files** in `django-structure-explorer-vscode`.

## Goal

Modifies ignore files to exclude or include certain files from git and VS Code packaging.

## Common Files

- `.gitignore`
- `.vscodeignore`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit .gitignore to add or remove patterns
- Edit .vscodeignore to add or remove patterns

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
---
name: feature-or-bugfix-with-tests-and-changelog
description: Workflow command scaffold for feature-or-bugfix-with-tests-and-changelog in django-structure-explorer-vscode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-or-bugfix-with-tests-and-changelog

Use this workflow when working on **feature-or-bugfix-with-tests-and-changelog** in `django-structure-explorer-vscode`.

## Goal

Implements a new feature or bugfix, updates the CHANGELOG, and adds or updates tests to ensure correctness.

## Common Files

- `src/djangoProjectAnalyzer.ts`
- `src/djangoStructureProvider.ts`
- `src/test/analyzer.test.ts`
- `CHANGELOG.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit or add implementation files (e.g., src/djangoProjectAnalyzer.ts, src/djangoStructureProvider.ts)
- Update or add corresponding tests (e.g., src/test/analyzer.test.ts)
- Update CHANGELOG.md to document the change

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
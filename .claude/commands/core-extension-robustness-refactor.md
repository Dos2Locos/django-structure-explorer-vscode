---
name: core-extension-robustness-refactor
description: Workflow command scaffold for core-extension-robustness-refactor in django-structure-explorer-vscode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /core-extension-robustness-refactor

Use this workflow when working on **core-extension-robustness-refactor** in `django-structure-explorer-vscode`.

## Goal

Refactor and improve the robustness of the core VS Code extension logic, including async I/O, error handling, and TypeScript types.

## Common Files

- `src/djangoProjectAnalyzer.ts`
- `src/djangoStructureProvider.ts`
- `src/djangoTreeItem.ts`
- `src/extension.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Refactor core files (e.g., src/djangoProjectAnalyzer.ts, src/djangoStructureProvider.ts, src/djangoTreeItem.ts, src/extension.ts) to improve async handling, error propagation, and type safety.
- Remove unused variables, debug logs, and fix lint warnings.
- Replace synchronous I/O with async equivalents and add error notifications.
- Test the extension to ensure stability and correctness.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
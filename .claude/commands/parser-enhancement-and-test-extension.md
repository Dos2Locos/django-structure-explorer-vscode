---
name: parser-enhancement-and-test-extension
description: Workflow command scaffold for parser-enhancement-and-test-extension in django-structure-explorer-vscode.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /parser-enhancement-and-test-extension

Use this workflow when working on **parser-enhancement-and-test-extension** in `django-structure-explorer-vscode`.

## Goal

Enhance the Django project analyzer/parser to support more features or fix parsing bugs, and extend the test suite (including fixtures) to cover new or critical cases.

## Common Files

- `src/djangoProjectAnalyzer.ts`
- `src/test/analyzer.test.ts`
- `src/test/fixtures/criticalapp/admin.py`
- `src/test/fixtures/criticalapp/models.py`
- `src/test/fixtures/criticalapp/settings.py`
- `src/test/fixtures/criticalapp/urls.py`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Modify src/djangoProjectAnalyzer.ts to implement parsing improvements or bugfixes.
- Update or add test cases in src/test/analyzer.test.ts to cover new parsing logic.
- Add or modify fixture files in src/test/fixtures/criticalapp/ (e.g., admin.py, models.py, urls.py, settings.py) to provide real Django code samples for testing.
- Run tests to ensure all cases pass.
- Optionally, update test setup or configuration files (e.g., src/test/setup.ts, .mocharc.json) if test harness changes are needed.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.
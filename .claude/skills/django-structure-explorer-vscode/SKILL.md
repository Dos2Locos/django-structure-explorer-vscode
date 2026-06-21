```markdown
# django-structure-explorer-vscode Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `django-structure-explorer-vscode` repository. The codebase is written in TypeScript and is designed for use as a Visual Studio Code extension, focusing on exploring Django project structures. You'll learn about file naming, import/export styles, commit conventions, and testing approaches specific to this repository.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `structureExplorer.ts`, `projectScanner.ts`

### Import Style
- Use **relative imports** for all module references.
  - Example:
    ```typescript
    import { scanProject } from './projectScanner';
    ```

### Export Style
- Use **named exports** instead of default exports.
  - Example:
    ```typescript
    // In projectScanner.ts
    export function scanProject() { ... }

    // In another file
    import { scanProject } from './projectScanner';
    ```

### Commit Message Convention
- Use **Conventional Commits** with the `feat` prefix for new features.
  - Example: `feat: add support for nested Django apps`
- Keep commit messages concise (average length: ~58 characters).

## Workflows

### Feature Development
**Trigger:** When adding a new feature or functionality  
**Command:** `/feature-development`

1. Create a new TypeScript file using camelCase naming.
2. Use relative imports to include dependencies.
3. Export your functions or classes using named exports.
4. Write or update corresponding test files matching the `*.test.*` pattern.
5. Commit your changes using the conventional commit format with the `feat` prefix.
   - Example: `feat: implement model relationship explorer`
6. Push your branch and open a pull request.

### Testing
**Trigger:** When verifying code correctness or before submitting a pull request  
**Command:** `/run-tests`

1. Ensure your test files follow the `*.test.*` naming pattern.
2. Use the project's preferred (unknown) test runner to execute tests.
3. Review test results and fix any failing cases.
4. Re-run tests until all pass.

## Testing Patterns

- Test files are named using the `*.test.*` pattern (e.g., `structureExplorer.test.ts`).
- The specific test framework is not detected, but standard TypeScript testing practices apply.
- Place tests alongside or near the modules they test.

  Example:
  ```
  src/
    structureExplorer.ts
    structureExplorer.test.ts
  ```

## Commands
| Command               | Purpose                                        |
|-----------------------|------------------------------------------------|
| /feature-development  | Start a new feature using repository patterns  |
| /run-tests            | Run all tests in the codebase                  |
```

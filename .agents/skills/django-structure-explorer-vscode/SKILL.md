```markdown
# django-structure-explorer-vscode Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides guidance on contributing to the `django-structure-explorer-vscode` project, a TypeScript-based Visual Studio Code extension for exploring Django project structures. The repository follows clear coding conventions, employs conventional commit messages, and uses a test file pattern to ensure code quality. This guide covers file naming, import/export styles, commit patterns, and testing practices for consistent and effective development.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `structureExplorer.ts`, `projectTreeProvider.ts`

### Import Style
- Use **relative imports** for internal modules.
  - Example:
    ```typescript
    import { getProjectStructure } from './projectUtils';
    ```

### Export Style
- Use **named exports** for functions, classes, and constants.
  - Example:
    ```typescript
    export function activate(context: vscode.ExtensionContext) { ... }
    export const EXTENSION_NAME = 'django-structure-explorer';
    ```

### Commit Messages
- Follow **conventional commit** format.
- Use the `feat` prefix for new features.
- Keep commit messages concise (average 60 characters).
  - Example:
    ```
    feat: add support for custom Django app paths
    ```

## Workflows

### Adding a New Feature
**Trigger:** When implementing a new capability or enhancement  
**Command:** `/add-feature`

1. Create a new branch for your feature.
2. Implement the feature using camelCase file naming and relative imports.
3. Export new functions or classes using named exports.
4. Write or update tests in corresponding `*.test.*` files.
5. Commit your changes using the `feat` prefix and a concise message.
6. Open a pull request for review.

### Writing and Running Tests
**Trigger:** When adding or modifying code that requires testing  
**Command:** `/run-tests`

1. Create or update test files following the `*.test.*` naming pattern.
2. Use the appropriate (unknown) testing framework as per project standards.
3. Run the test suite to ensure all tests pass.
4. Address any failing tests before committing.

### Refactoring Code
**Trigger:** When improving code structure or readability without changing functionality  
**Command:** `/refactor`

1. Refactor code using camelCase for new files.
2. Maintain relative import paths and named exports.
3. Update or add tests if necessary.
4. Commit changes with a conventional commit message (e.g., `refactor: improve tree rendering logic`).

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `projectUtils.test.ts`).
- The specific testing framework is not detected; follow existing patterns in the repository.
- Place tests alongside or near the modules they cover.
- Ensure all new or changed code is covered by tests.

## Commands
| Command      | Purpose                                             |
|--------------|-----------------------------------------------------|
| /add-feature | Start the workflow for adding a new feature         |
| /run-tests   | Run the test suite for the codebase                 |
| /refactor    | Begin a code refactoring workflow                   |
```
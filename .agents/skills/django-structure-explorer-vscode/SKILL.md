```markdown
# django-structure-explorer-vscode Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the development conventions and workflows used in the `django-structure-explorer-vscode` repository. The codebase is written in JavaScript (no framework detected) and follows consistent patterns for file naming, imports/exports, commit messages, and testing. Understanding these patterns will help you contribute effectively and maintain code quality.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `structureExplorer.js`, `fileTreeUtils.js`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```javascript
    import { getTreeData } from './treeUtils';
    ```

### Export Style
- Use **named exports** for all exported functions or constants.
  - Example:
    ```javascript
    // In fileTreeUtils.js
    export function getTreeData() { ... }
    export const TREE_TYPE = 'folder';
    ```

### Commit Messages
- Use **conventional commit** format.
- Prefix commits with the type, e.g., `chore`.
- Keep commit messages concise (average 67 characters).
  - Example:
    ```
    chore: update dependencies to latest minor versions
    ```

## Workflows

### Dependency Maintenance
**Trigger:** When dependencies need to be updated.
**Command:** `/update-dependencies`

1. Check for outdated dependencies.
2. Update dependencies in `package.json`.
3. Run tests to ensure nothing breaks.
4. Commit changes with a conventional message, e.g., `chore: update dependencies`.
5. Push to the repository and open a pull request if needed.

### Code Contribution
**Trigger:** When adding new features or fixing bugs.
**Command:** `/contribute-code`

1. Create a new branch from `main`.
2. Write code following camelCase file naming and relative imports.
3. Use named exports for new modules.
4. Write or update tests as needed (see Testing Patterns).
5. Commit changes using a conventional commit message.
6. Push your branch and open a pull request.

## Testing Patterns

- Test files use the pattern `*.test.*`.
  - Example: `structureExplorer.test.js`
- The testing framework is not explicitly detected; check existing test files for patterns.
- Place test files alongside the modules they test or in a dedicated `tests` directory.
- Example test file structure:
  ```javascript
  // structureExplorer.test.js
  import { getTreeData } from './structureExplorer';

  describe('getTreeData', () => {
    it('should return correct tree structure', () => {
      // test implementation
    });
  });
  ```

## Commands
| Command               | Purpose                                    |
|-----------------------|--------------------------------------------|
| /update-dependencies  | Update project dependencies                |
| /contribute-code      | Start a new code contribution workflow     |
```

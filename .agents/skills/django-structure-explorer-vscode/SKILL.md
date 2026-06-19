```markdown
# django-structure-explorer-vscode Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill covers the development patterns and workflows for the `django-structure-explorer-vscode` project, a TypeScript-based Visual Studio Code extension for exploring Django project structures. It details coding conventions, commit practices, testing approaches, and step-by-step contribution workflows, making it easy for new contributors to follow established standards.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `djangoProjectAnalyzer.ts`, `djangoStructureProvider.ts`

### Imports
- Use **relative imports** for internal modules.
  ```typescript
  import { analyzeProject } from './djangoProjectAnalyzer';
  ```

### Exports
- Use **named exports**.
  ```typescript
  // Good
  export function analyzeProject(...) { ... }

  // Avoid default exports
  ```

### Commit Messages
- Follow **conventional commit** style.
- Prefixes: `fix`, `chore`, `feat`
  - Example: `feat: add support for nested Django apps`

## Workflows

### Feature or Bugfix with Tests and Changelog
**Trigger:** When adding a new feature or fixing a bug that requires documentation and tests  
**Command:** `/feature-with-tests`

1. Edit or add implementation files (e.g., `src/djangoProjectAnalyzer.ts`, `src/djangoStructureProvider.ts`)
2. Update or add corresponding tests (e.g., `src/test/analyzer.test.ts`)
3. Update `CHANGELOG.md` to document the change

**Example:**
```typescript
// src/djangoProjectAnalyzer.ts
export function analyzeProject(...) { ... }
```
```typescript
// src/test/analyzer.test.ts
import { analyzeProject } from '../djangoProjectAnalyzer';
describe('analyzeProject', () => {
  it('should detect Django apps', () => {
    // test implementation
  });
});
```
```markdown
# CHANGELOG.md
## [Unreleased]
- feat: add support for nested Django apps
```

---

### Update Ignore Files
**Trigger:** When you need to exclude or include files from git or VSIX packaging  
**Command:** `/update-ignore`

1. Edit `.gitignore` to add or remove patterns
2. Edit `.vscodeignore` to add or remove patterns

**Example:**
```
# .gitignore
dist/
*.log

# .vscodeignore
*.test.ts
```

---

### Release Version Update
**Trigger:** When preparing a new release for the marketplace  
**Command:** `/release`

1. Update `CHANGELOG.md` with release notes
2. Update the version in `package.json`

**Example:**
```json
// package.json
{
  "version": "1.2.0"
}
```
```markdown
# CHANGELOG.md
## [1.2.0] - 2024-06-15
- feat: improved project tree rendering
```

## Testing Patterns

- **Framework:** Mocha
- **Test File Pattern:** Files end with `.test.ts` and are placed in `src/test/`
- **Test Structure:** Use `describe` and `it` blocks for organization

**Example:**
```typescript
// src/test/analyzer.test.ts
import { analyzeProject } from '../djangoProjectAnalyzer';

describe('analyzeProject', () => {
  it('should detect Django apps', () => {
    // Arrange
    // Act
    // Assert
  });
});
```

## Commands

| Command              | Purpose                                                      |
|----------------------|--------------------------------------------------------------|
| /feature-with-tests  | Add a new feature or bugfix with tests and changelog entry   |
| /update-ignore       | Update .gitignore or .vscodeignore files                     |
| /release             | Prepare a new release (update changelog and version)         |
```
```markdown
# django-structure-explorer-vscode Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you how to effectively contribute to the `django-structure-explorer-vscode` project, a Visual Studio Code extension written in TypeScript for exploring Django project structures. You'll learn the project's coding conventions, how to extend its Django parsing capabilities, refactor its core logic for robustness, and write comprehensive tests. The guide includes step-by-step workflows, code style patterns, and command suggestions for common development tasks.

## Coding Conventions

### File Naming

- Use **camelCase** for TypeScript files.
  - Example: `djangoProjectAnalyzer.ts`, `djangoStructureProvider.ts`

### Import Style

- Use **relative imports** within the `src` directory.
  ```typescript
  import { analyzeProject } from './djangoProjectAnalyzer';
  ```

### Export Style

- Use **named exports** for functions, classes, and constants.
  ```typescript
  // Good
  export function analyzeProject() { ... }

  // Bad
  export default function analyzeProject() { ... }
  ```

### Commit Messages

- Follow **conventional commit** style.
- Prefixes: `fix`, `feat`, `test`
- Example:  
  ```
  feat: add support for nested Django apps in analyzer
  ```

## Workflows

### Parser Enhancement and Test Extension
**Trigger:** When you want to improve or fix the Django parsing logic and ensure correctness with tests.  
**Command:** `/improve-parser-with-tests`

1. **Modify the parser logic:**  
   Edit `src/djangoProjectAnalyzer.ts` to implement parsing improvements or bug fixes.
   ```typescript
   // Example: Add support for new Django file type
   export function parseNewFileType(fileContent: string) { ... }
   ```
2. **Update or add tests:**  
   Edit or add test cases in `src/test/analyzer.test.ts` to cover the new or changed parsing logic.
   ```typescript
   import { parseNewFileType } from '../djangoProjectAnalyzer';

   describe('parseNewFileType', () => {
     it('should correctly parse the new file type', () => {
       // test logic
     });
   });
   ```
3. **Add or modify fixtures:**  
   Update files in `src/test/fixtures/criticalapp/` (e.g., `admin.py`, `models.py`, `urls.py`, `settings.py`) to provide realistic Django code samples for testing.
4. **Run tests:**  
   Ensure all test cases pass.
   ```
   npm test
   ```
5. **(Optional) Update test setup/config:**  
   If needed, modify `src/test/setup.ts` or `.mocharc.json` for test harness changes.

---

### Core Extension Robustness Refactor
**Trigger:** When you want to improve code hygiene, performance, or reliability of the extension's core logic.  
**Command:** `/refactor-core-robustness`

1. **Refactor core files:**  
   Edit files such as `src/djangoProjectAnalyzer.ts`, `src/djangoStructureProvider.ts`, `src/djangoTreeItem.ts`, and `src/extension.ts` to:
   - Improve async handling (prefer `async/await` over callbacks)
   - Enhance error propagation and add user notifications
   - Strengthen TypeScript type safety
   ```typescript
   // Before
   fs.readFileSync(path);

   // After
   const data = await fs.promises.readFile(path, 'utf-8');
   ```
2. **Remove unused code:**  
   Delete unused variables, debug logs, and fix lint warnings.
3. **Replace sync I/O with async:**  
   Ensure all file operations are asynchronous and properly handled.
4. **Test the extension:**  
   Run the extension and verify stability and correctness.

## Testing Patterns

- **Framework:** [Mocha](https://mochajs.org/)
- **Test file pattern:** `*.test.ts` (e.g., `analyzer.test.ts`)
- **Fixtures:** Use realistic Django code samples in `src/test/fixtures/criticalapp/` to simulate real-world scenarios.
- **Test setup:** Common setup logic can be placed in `src/test/setup.ts`.

**Example Test:**
```typescript
import { analyzeProject } from '../djangoProjectAnalyzer';
import { expect } from 'chai';

describe('analyzeProject', () => {
  it('should parse models.py correctly', () => {
    const result = analyzeProject('...models.py content...');
    expect(result).to.have.property('models');
  });
});
```

## Commands

| Command                     | Purpose                                                        |
|-----------------------------|----------------------------------------------------------------|
| /improve-parser-with-tests   | Enhance Django parser and extend test coverage                 |
| /refactor-core-robustness   | Refactor and improve the robustness of extension core logic    |
```

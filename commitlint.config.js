// Configuración de commitlint: valida que los mensajes de commit sigan
// Conventional Commits (feat, fix, docs, chore, refactor, test, ci, perf…).
// El hook commit-msg de husky lo ejecuta en cada commit; el versionado
// (commit-and-tag-version) deriva el bump de versión de estos tipos.
module.exports = {
  extends: ['@commitlint/config-conventional']
};

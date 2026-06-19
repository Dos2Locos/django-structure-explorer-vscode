# Changelog

Todas las novedades relevantes de la extensión se documentan en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/)
y el proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [1.4.0] - 2026-06-19

### Cambiado
- **Reescritura del parser a AST con tree-sitter.** Todo el análisis de ficheros
  Python (modelos, vistas, URLs, admin, settings, tareas, serializers, schemas,
  endpoints DRF/ninja, forms, señales y tareas Celery, además de la navegación
  go-to-definition) deja de basarse en expresiones regulares y pasa a recorrer un
  árbol de sintaxis real (`web-tree-sitter` + gramática Python en WASM, sin
  binarios nativos). Esto elimina los fallos con comentarios, cadenas multilínea,
  raw strings y paréntesis dentro de comentarios.
- Icono de la barra de actividad sustituido por un glifo monocromo de estructura
  en árbol (los iconos de la activity bar deben ser monocromos; el logo a color
  se renderizaba de forma incorrecta).

### Corregido
- Recursión infinita en `finalizeItems` cuando no había filtro activo, que
  provocaba `Maximum call stack size exceeded` al expandir el árbol.
- Crash del outline y del árbol con la URL raíz del sitio (`path('')`): el patrón
  vacío rompía `DocumentSymbol`; ahora se muestra `/` como etiqueta.
- El parser ya no se rompe con imports que contienen metacaracteres de regex ni
  con valores de settings multilínea (heredado de la robustez previa, ahora
  garantizado por el AST).
- `findMainUrlsFile` ya no devuelve el `urls.py` de la primera app en orden
  alfabético: exige que el directorio contenga también `settings.py` (el paquete
  de configuración). Al pinchar una URL traída por `include()` se abre su fichero
  real, no el `urls.py` de cabecera. _(Porta el arreglo de @mvanorder, PR #3.)_

### Interno
- Se registra el stacktrace completo en `reportError` y en `getChildren` para
  facilitar el diagnóstico desde Developer Tools.
- Empaquetado `.vsix` depurado: se excluyen `.claude/`, `.ruff_cache/` y `.git/`,
  y solo se incluye la gramática `tree-sitter-python.wasm`.
- Workflow de publicación al Marketplace al fusionar PRs contra `main`.

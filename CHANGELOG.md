# Changelog

Todas las novedades relevantes de la extensión se documentan en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/)
y el proyecto se adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [Sin publicar]

### Añadido
- **Localización recursiva de la raíz del proyecto.** Si `manage.py` no está en la
  raíz del workspace (monorepos, proyectos en `backend/`, `src/`, `apps/api/`…),
  ahora se busca hacia abajo en anchura y con profundidad acotada, omitiendo
  directorios pesados (dependencias, entornos virtuales, cachés, ocultos). Antes
  el árbol quedaba vacío en esos layouts. _(Idea tomada de la PR #2 de @0x3at,
  reimplementada sobre el código actual.)_
- **Exclusión de directorios según `.gitignore`.** Además de la lista por defecto
  de directorios pesados, el escaneo omite las carpetas declaradas en el
  `.gitignore` del proyecto. El parseo es conservador: solo nombres de directorio
  inequívocos (sin globs, rutas anidadas ni negaciones). _(Idea de la PR #2 de
  @0x3at.)_

### Interno
- Unificada la lista de directorios excluidos del escaneo en una única constante
  (`DEFAULT_EXCLUDED_DIRS`), eliminando la duplicación entre `getDirectories` y
  `findTemplateFiles`. Cobertura de tests para ambas mejoras.

## [1.4.1] - 2026-06-19

### Corregido
- `findMainUrlsFile` exige `settings.py` junto al `urls.py` para resolver el
  URLconf raíz (no la primera app alfabética); las URLs traídas por `include()`
  abren su fichero real. _(Porta el arreglo de @mvanorder, PR #3.)_

### Interno
- Saneado del paquete: se excluyen del `.vsix` los `*.log`, `out/test/` y
  `.mocharc.json`, y se purga del repositorio un log local que se había colado.

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

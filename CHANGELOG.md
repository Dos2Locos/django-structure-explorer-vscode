# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [1.7.0](https://github.com/Dos2Locos/django-structure-explorer-vscode/compare/v1.6.0...v1.7.0) (2026-06-21)


### Features

* separa el árbol de cada app en secciones Front y API ([651b0c1](https://github.com/Dos2Locos/django-structure-explorer-vscode/commit/651b0c184dfcb7c4d955146b35bff5985dca2ed0))


### Bug Fixes

* **deps:** regenera package-lock en sync con package.json para npm ci ([#18](https://github.com/Dos2Locos/django-structure-explorer-vscode/issues/18)) ([a89fc71](https://github.com/Dos2Locos/django-structure-explorer-vscode/commit/a89fc7125ffa0213dd40de111934e1f2daf9b4f1))
* viewsets.py solo aporta vistas de API, no helpers a Front ([31915eb](https://github.com/Dos2Locos/django-structure-explorer-vscode/commit/31915eba6a06bf7f65339138b63bf0511cb22884))

## [1.6.0] - 2026-06-20

### Añadido
- **Localización multi-idioma (inglés y español).** La extensión se muestra en
  el idioma de display de VS Code: inglés por defecto y **español** cuando el
  editor está en español. Se traducen los títulos de comandos, el nombre de la
  vista, las descripciones de ajustes, las secciones del árbol
  (Configuration→Configuración, Applications→Aplicaciones, Models→Modelos…), los
  mensajes de error, el runner de `manage.py` (QuickPick e InputBox) y el aviso
  de "no es un proyecto Django". Implementado con `vscode.l10n` + bundles
  (`package.nls*.json` y `l10n/bundle.l10n.es.json`).

### Cambiado
- **Versión mínima de VS Code: 1.73.0** (antes 1.60.0), requisito de la API
  `vscode.l10n` de localización.

## [1.5.1] - 2026-06-20

### Añadido
- **Mensaje cuando el workspace no es un proyecto Django.** Si no se encuentra
  ningún `manage.py`, la vista muestra un item informativo ("No se detectó un
  proyecto Django") con una pista de uso, en lugar de un árbol vacío y silencioso.

### Corregido
- **Nodo Settings en proyectos con settings dividido.** `findSettingsFiles`
  reconoce ahora los paquetes `config/settings/` (eligiendo `base.py`, si no
  `__init__.py`, si no el primer `.py`), de modo que el nodo Configuration >
  Settings también aparece en ese layout —igual que ya se arregló el nodo URLs
  en la 1.5.0.

### Interno
- Actions de CI a `v5` (`checkout`, `setup-node`; Node 24) y `node-version` a 22,
  resolviendo el aviso de deprecación de Node 20. `eslint-disable` acotado en el
  stub de `vscode` de los tests (sus claves replican la API real en PascalCase).

## [1.5.0] - 2026-06-20

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
  inequívocos (sin globs, rutas anidadas ni negaciones). Se fusionan los
  `.gitignore` de la raíz del workspace y del proyecto, de modo que en monorepos
  con proyecto anidado (`manage.py` en `backend/`) se respeta el `.gitignore` de
  la raíz del repositorio. _(Idea de la PR #2 de @0x3at.)_

### Corregido
- `findMainUrlsFile` reconoce ahora los proyectos con **paquete de settings
  dividido** (`config/settings/base.py`, `config/settings/prod.py`…): el nodo
  Configuration > URLs ya no desaparece cuando no existe un `settings.py` plano
  junto al `urls.py` raíz. _(Detectado en la revisión de Codex sobre la PR #9.)_

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

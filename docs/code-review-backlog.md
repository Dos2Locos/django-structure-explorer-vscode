# Auditoría de código — arreglado y backlog

> Fecha: 2026-06-17. Revisión de `src/` (analizador + providers + extensión) con
> agentes `typescript-reviewer` y `silent-failure-hunter`, verificada a mano.
> El parser es **basado en regex línea a línea**, no AST (ver
> [parser-known-issues.md](parser-known-issues.md)).

## Arreglado en esta pasada

Con tests en `src/test/analyzer.test.ts` (fixtures `robustness/`) salvo los defensivos.

| Fix | Archivo | Problema | Solución |
|---|---|---|---|
| Recursión infinita en includes | `djangoProjectAnalyzer.ts` `extractUrls` | `include` circular (a→b→a) o symlink loop → desbordamiento de pila y crash del host | `Set<string>` de rutas canónicas propagado por la recursión |
| Path traversal en `include()` | `djangoProjectAnalyzer.ts` `extractUrls` | `include('../../x.urls')` salía de la raíz del proyecto | Se exige que la ruta resuelta quede dentro de `projectRoot` |
| Crash silencioso por regex | `djangoProjectAnalyzer.ts` `extractModels` | `from django.db.models import (` inyectaba `(` sin escapar → `new RegExp` lanzaba → modelos vacíos sin aviso | helper `escapeRegExp` aplicado a `directImports` |
| Settings fantasma / re-escaneo | `djangoProjectAnalyzer.ts` `extractSettings` | tras un valor multilínea no se avanzaba `i`; se re-escaneaban las líneas internas | `i = j - 1` y `lineNumber` capturado al inicio (`startLine`) |
| Log sin contexto | `djangoProjectAnalyzer.ts` `getDirectories` | error de I/O sin la ruta → diagnóstico imposible | se incluye `dir` y el mensaje del error |
| Árbol roto en silencio | `djangoStructureProvider.ts` `getChildren` | sin try/catch: un fallo inesperado rompía el `TreeDataProvider` sin aviso | red de seguridad con try/catch + `showErrorMessage` |
| Race en `projectRoot` | `djangoStructureProvider.ts` `getChildren` | `refresh()` reasigna `this.projectRoot` a mitad de una llamada async | se captura en una variable local estable al inicio |

## Backlog (pendiente, priorizado)

### HIGH

- **`extractViews` produce falsos positivos.** `^def`/`^class` captura cualquier
  función o clase de `views.py` (helpers, mixins, imports), no solo vistas.
  No hay heurística de vista (base CBV, parámetro `request`, decoradores
  `@api_view`/`@login_required`). Equivalente al sistema multi-pasada que sí
  tienen los modelos. *Decisión de diseño: definir qué cuenta como "vista".*

- **`otherFieldRegex` captura asignaciones que no son campos.** El fallback
  `^\s+(\w+)\s*=\s*(\w+)...` puede registrar `ordering = [...]`, constantes de
  clase, etc. como campos fantasma. Cambiarlo es delicado (riesgo de regresión
  en los tests de campos actuales): requiere acotar a RHS callable y tests
  específicos antes de tocar.

### MEDIUM

- **Manejo de errores: `[]` vs "falló".** Los extractores devuelven `[]` tanto
  si no hay resultados como si el parseo falló (tras `reportError`). Los callers
  no pueden distinguirlos ni marcar el nodo con estado de error. Opción: que los
  extractores lancen y centralizar el try/catch en la capa de UI.
- **`djangoOutlineProvider` traga la excepción** con solo `console.error` (sin
  notificar). Ojo: un toast por pulsación sería peor; valorar un canal
  `OutputChannel` o notificación de una sola vez.
- **`extractModels`: escaneo de imports limitado a 30 líneas.** Imports tras
  cabeceras largas o `if TYPE_CHECKING:` se pierden. Mejor: escanear hasta la
  primera línea que no sea import/blank/comentario.
- **`getSettings` ignora su parámetro `settingsDir`** y siempre usa
  `settingsFiles[0]`. En proyectos con `settings/base.py`, `local.py`… solo se
  expone el primero. Además solo se crea un nodo "Settings".
- **`include()` embebido en `path('api/', include(...))` pierde el prefijo.** El
  `path()` matchea primero (con `continue`) y la rama de include no recibe el
  segmento `api/`.
- **`findDjangoProjectRoot` usa `fs.existsSync` (síncrono).** Acotado a las
  raíces del workspace, pero inconsistente con el resto (async) y bloquea el hilo.
- **Cancellation token no se propaga al I/O del analizador.** Se comprueba entre
  ítems ya parseados, pero la lectura/parseo arranca antes; trabajo desperdiciado
  si se cancela a mitad.

### LOW

- **`pathExists` duplicado 3 veces** (`djangoProjectAnalyzer`, `djangoStructureProvider`,
  `extension`). Extraer a un `utils.ts` compartido.
- **`modelBaseClasses` con nombres de terceros hardcodeados** (`Page`, `BaseModel`,
  `UUIDModel`…). Falsos positivos para clases homónimas no-Django.
- **`stripComments`: secuencia `\'` (backslash-comilla) en cadena de una línea.**
  El salto `i += 2` puede cerrar la cadena un carácter antes en casos como
  `'\\\''`. Impacto bajo y muy poco frecuente.
- **`extractUrls` consume hasta EOF si una llamada multilínea no cierra paréntesis**
  (defensivo; documentado).

## Pendiente del parser (ver doc dedicado)

Continuaciones de línea con `\` y f-strings con `{...}` anidados — en
[parser-known-issues.md](parser-known-issues.md).

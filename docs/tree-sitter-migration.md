# Migración del parser a tree-sitter (AST)

> Documento de continuación. Resume el estado y el plan para retomar la migración
> en una sesión nueva (tras `/clear`). Objetivo global del proyecto: que la
> extensión sea "tan útil o más que el equivalente de PyCharm".

## Motivación

El analyzer (`src/djangoProjectAnalyzer.ts`) parseaba Python con **regex línea a
línea** + un `stripComments()` que neutraliza comentarios (`#`, `"""`, `'''`).
Es frágil: campos multilínea, paréntesis dentro de comentarios, raw strings, etc.
Se migra a un **AST real** con tree-sitter (en proceso, WASM, sin binarios nativos).

## Decisión de dependencias (CRÍTICO — no tocar a la ligera)

Versiones **fijadas exactas** en `package.json`:

```json
"dependencies": {
  "tree-sitter-wasms": "0.1.13",
  "web-tree-sitter": "0.20.8"
}
```

**No subir `web-tree-sitter` a 0.26.x.** El runtime moderno (0.26.x) NO carga las
gramáticas de `tree-sitter-wasms@0.1.13` (compiladas con el toolchain de
tree-sitter 0.20.x): falla en `getDylinkMetadata` / `loadWebAssemblyModule`. Es un
desajuste del formato dylink de emscripten, no de versión de ABI de gramática.
0.20.8 es además CommonJS puro (compatible con el TS 4.3 / `@types/node` 14 del
proyecto) y carga `tree-sitter-python.wasm` sin problemas (validado con spikes).

API de 0.20.8 (CommonJS): `const Parser = require('web-tree-sitter')` →
`await Parser.init()` → `await Parser.Language.load(wasmPath)` →
`parser.setLanguage(lang)` → `lang.query('(s-expr)')`. **No** hay exports nombrados
`{ Parser, Language }` como en 0.26.x.

## Empaquetado (.vsix)

`tree-sitter-wasms` trae ~40 gramáticas; solo usamos Python. `.vscodeignore` ya
excluye el resto:

```
node_modules/tree-sitter-wasms/out/*.wasm
!node_modules/tree-sitter-wasms/out/tree-sitter-python.wasm
```

Verificación: `npx @vscode/vsce ls | grep -i '\.wasm$'` debe listar SOLO
`tree-sitter-python.wasm` y `web-tree-sitter/tree-sitter.wasm` (el runtime).

## Substrato: `src/pythonParser.ts`

- `initPythonParser(): Promise<void>` — carga perezosa e **idempotente** del runtime
  WASM + gramática Python. La llaman los extractores y un warm-up en `activate()`.
- `parsePython(source): Tree` — parsea (requiere init previo). `.rootNode` para el AST.
- `finalSegment(dotted)` — `'models.CharField' → 'CharField'`.
- Tipos re-exportados: `SyntaxNode`, `SyntaxTree`.
- Resolución del `.wasm`: `require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm')`
  (funciona en tests con cwd=raíz y en el `.vsix` empaquetado).

## Estado actual

**Fase 1 COMPLETADA** y commiteada en la rama `feat/tree-sitter-parser`
(commit `c82de4e`, sin push aún):

- `src/pythonParser.ts` creado.
- `extractModels` (línea ~302) migrado a AST. Es el **patrón de referencia** para el resto.
- Warm-up en `activate()`.
- **45/45 tests verdes**, suite intacta (`npm test`).

## Patrón de migración (seguir el de `extractModels`)

1. `await initPythonParser();` al inicio del `try`.
2. `const root = parsePython(await readFile(path, 'utf8')).rootNode;`
   — **ya NO se usa `stripComments`**: el AST trata los comentarios como nodos `comment`.
3. Recorrer `root.namedChildren` por `node.type` y `node.childForFieldName(...)`.
4. Números de línea: `node.startPosition.row` (0-indexed, como ya esperan los tests).

### Hechos del AST de tree-sitter-python (verificados)

- `childrenForFieldName` **no existe** en 0.20.8 → iterar `namedChildren` y filtrar por `type`.
- `class_definition`: campos `name` (identifier), `superclasses` (argument_list;
  sus `namedChildren` son `identifier` o `attribute` con `.text` tipo `models.Model`),
  `body` (block).
- Asignación de campo: `expression_statement` → `namedChildren[0]` es `assignment`
  con campos `left` (identifier) y `right`. Si `right.type === 'call'`, el tipo es
  `call.childForFieldName('function')`: si es `attribute` → `.childForFieldName('attribute').text`;
  si es `identifier` → `.text`.
- Decorador: `decorated_definition` con hijos `decorator` (su `namedChildren[0].text`
  es `property`, o un `call` como `permission_required(...)`) y campo `definition`
  (`function_definition`/`class_definition`).
- Imports: `import_from_statement`, campo `module_name`; los demás `namedChildren`
  son los nombres importados (`dotted_name`, `aliased_import`, `wildcard_import`).

## Trabajo pendiente (Fases 2–4)

Migrar al patrón AST (en `src/djangoProjectAnalyzer.ts`). Tras cada uno: `npm test`
debe seguir en **45 verdes** (los tests son la especificación — no cambiarlos salvo
para endurecer, y siempre RED→GREEN).

| Método | Línea aprox. | Detecta |
|---|---|---|
| `extractViews` | 462 | vistas FBV/CBV, marca DRF (ViewSet/APIView), **decoradores** de nivel superior |
| `extractUrls` | 539 | `path()`/`re_path()`/`url()`, includes (tiene set `visited` anti-ciclos y anti-traversal — preservar) |
| `extractAdminClasses` | 663 | clases `@admin.register` / `admin.ModelAdmin`, modelo asociado |
| `extractSettings` | 744 | asignaciones de settings (ojo a valores multilínea) |
| `extractTasks` | 815 | `@task` de Django 6 (`django.tasks`) |
| `extractSerializers` | 930 | DRF `Serializer`/`ModelSerializer`, modelo del `Meta` |
| `extractSchemas` | 975 | ninja `Schema`/`ModelSchema` |
| `extractNinjaEndpoints` | 1005 | `@api`/`@router.<método>` con método y ruta |
| `extractDrfEndpoints` | 1055 | `@api_view`, `@action` |
| `extractForms` | 1115 | `Form`/`ModelForm`, modelo del `Meta` |
| `extractSignals` | 1158 | `@receiver` y `Signal()` |
| `extractCeleryTasks` | 1210 | `@shared_task`/`@app.task` (≠ `@task` de Django) |

**NO migrar al parser de Python** (operan sobre plantillas HTML/Django, no Python):
- `extractPartials` (885), `findAppPartials` (913): `{% partialdef %}` en `.html`.
- `findManagementCommands` (1255): lista ficheros, no parsea.

**Fase final**: cuando todos los extractores de Python usen AST, eliminar
`stripComments()` (línea 169) y los regex residuales. Verificar 45 verdes.

## Restricciones operativas (vigentes)

- **No hacer push ni publish sin confirmación explícita del usuario.**
- Responder siempre en **español de España**.
- Atribución de commits desactivada globalmente (sin `Co-Authored-By`).
- PRs abiertas relacionadas: **#6** (fix crash → 1.3.1, rama `fix/parser-stack-overflow`),
  **#7** (workflow publish-on-merge, rama `ci/marketplace-publish-workflow`).
- El workflow de publicación solo corre al hacer merge de una PR a `main` DESPUÉS de
  que #7 esté en `main` (un workflow añadido en una PR no corre en su propio merge).
- Configurar el secret `VSCE_PAT` lo hace el usuario, nunca pasa por la conversación.

## Cómo retomar

```bash
git checkout feat/tree-sitter-parser   # commit c82de4e
npm test                               # baseline: 45 passing
```

Abrir `src/djangoProjectAnalyzer.ts`, usar `extractModels` como plantilla y migrar
el siguiente extractor de la tabla.

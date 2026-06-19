import Parser = require('web-tree-sitter');

/**
 * Carga perezosa del runtime WASM de tree-sitter y de la gramática de Python.
 *
 * Se inicializa una sola vez (idempotente): la primera llamada arranca el módulo
 * WASM y carga `tree-sitter-python.wasm`; las siguientes resuelven al instante.
 * Las versiones están fijadas a un par compatible de ABI:
 *   web-tree-sitter@0.20.8  +  tree-sitter-wasms@0.1.13
 * (el runtime moderno 0.26.x no carga las gramáticas compiladas con el toolchain
 * de tree-sitter 0.20.x — fallaba en getDylinkMetadata).
 */
let initPromise: Promise<void> | undefined;
let language: Parser.Language | undefined;

export type SyntaxNode = Parser.SyntaxNode;
export type SyntaxTree = Parser.Tree;

export async function initPythonParser(): Promise<void> {
  if (language) {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      await Parser.init();
      // require.resolve localiza el .wasm dentro de node_modules tanto en los tests
      // (cwd = raíz del proyecto) como en la extensión empaquetada (node_modules en el .vsix).
      const wasmPath = require.resolve('tree-sitter-wasms/out/tree-sitter-python.wasm');
      language = await Parser.Language.load(wasmPath);
    })();
  }
  await initPromise;
}

/**
 * Parsea código Python a un árbol de sintaxis concreto. Requiere haber llamado a
 * `initPythonParser()` previamente (los extractores lo hacen de forma perezosa).
 */
export function parsePython(source: string): Parser.Tree {
  if (!language) {
    throw new Error('Parser de Python no inicializado: llama a initPythonParser() antes de parsear.');
  }
  const parser = new Parser();
  parser.setLanguage(language);
  return parser.parse(source);
}

/**
 * Devuelve el segmento final de un nombre con puntos (`models.CharField` → `CharField`,
 * `CharField` → `CharField`). Útil para normalizar tipos de campo y clases base.
 */
export function finalSegment(dottedName: string): string {
  const parts = dottedName.split('.');
  return parts[parts.length - 1] || dottedName;
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import { initPythonParser, parsePython, finalSegment, SyntaxNode } from './pythonParser';

const readFile = util.promisify(fs.readFile);
const readdir = util.promisify(fs.readdir);

/**
 * Comprueba de forma asíncrona si una ruta existe, sin bloquear el event loop.
 * Reemplaza a fs.existsSync (síncrono) dentro del árbol asíncrono.
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Registra un error y lo notifica al usuario, en lugar de tragárselo en silencio.
 * Así se distingue "no hay resultados" de "el parseo falló".
 */
function reportError(context: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${context}: ${message}`);
  vscode.window.showErrorMessage(`Django Structure Explorer: ${context}. ${message}`);
}

export interface DjangoModel {
  name: string;
  lineNumber: number;
  fields?: ModelField[];
}

export interface ModelField {
  name: string;
  fieldType: string;
  lineNumber: number;
  isProperty?: boolean; // Indicar si es un método con decorador @property
}

export interface DjangoView {
  name: string;
  lineNumber: number;
  isClass: boolean;
  /** Marca las vistas de DRF: ViewSet (router) o APIView/generics. */
  apiKind?: 'viewset' | 'apiview';
  /** Decoradores de nivel superior aplicados a la vista (sin `@`, sin args). */
  decorators?: string[];
}

export interface DjangoUrl {
  pattern: string;
  viewName: string;
  lineNumber: number;
}

export interface DjangoAdminClass {
  name: string;
  lineNumber: number;
  modelName: string;
}

export interface DjangoSetting {
  name: string;
  value: string;
  lineNumber: number;
}

/** Tarea del framework de Tasks de Django 6 (django.tasks). */
export interface DjangoTask {
  name: string;
  lineNumber: number;
}

/** Partial de plantilla de Django 6 ({% partialdef nombre %}). */
export interface DjangoPartial {
  name: string;
  lineNumber: number;
  templatePath: string;
}

/** Serializer de Django REST Framework (serializers.py). */
export interface DjangoSerializer {
  name: string;
  lineNumber: number;
  modelName?: string;
}

/** Schema de django-ninja (schemas.py): clase Schema / ModelSchema. */
export interface DjangoSchema {
  name: string;
  lineNumber: number;
}

/** Endpoint REST de django-ninja (@api/@router.<método>) o DRF (@api_view/@action). */
export interface DjangoApiEndpoint {
  method: string;
  path: string;
  handler: string;
  lineNumber: number;
  framework: 'ninja' | 'drf';
  filePath: string;
}

/** Formulario de Django (forms.py): clase Form / ModelForm. */
export interface DjangoForm {
  name: string;
  lineNumber: number;
  modelName?: string;
}

/** Señal de Django (signals.py): receiver decorado o señal personalizada. */
export interface DjangoSignal {
  name: string;
  lineNumber: number;
  kind: 'receiver' | 'signal';
}

/** Comando de gestión (management/commands/<nombre>.py). */
export interface DjangoCommand {
  name: string;
  filePath: string;
}

/** Tarea de Celery (tasks.py): @shared_task / @app.task. */
export interface DjangoCeleryTask {
  name: string;
  lineNumber: number;
}

/** Ubicación de un símbolo resuelto, para navegación (go-to-definition). */
export interface DjangoLocation {
  filePath: string;
  lineNumber: number;
}

export class DjangoProjectAnalyzer {

  /**
   * Busca todos los archivos settings.py en el proyecto
   */
  async findSettingsFiles(projectRoot: string): Promise<string[]> {
    const settingsFiles: string[] = [];

    const dirs = await this.getDirectories(projectRoot);
    for (const dir of dirs) {
      const settingsPath = path.join(dir, 'settings.py');
      if (await pathExists(settingsPath)) {
        settingsFiles.push(settingsPath);
      }
    }

    return settingsFiles;
  }

  /**
   * Busca el archivo urls.py principal del proyecto
   */
  async findMainUrlsFile(projectRoot: string): Promise<string | undefined> {
    const dirs = await this.getDirectories(projectRoot);
    for (const dir of dirs) {
      const urlsPath = path.join(dir, 'urls.py');
      if (await pathExists(urlsPath)) {
        // Verificar si es el urls.py principal (contiene ROOT_URLCONF o urlpatterns)
        const content = await readFile(urlsPath, 'utf8');
        if (content.includes('ROOT_URLCONF') || content.includes('urlpatterns')) {
          return urlsPath;
        }
      }
    }

    return undefined;
  }

  /**
   * Busca todas las aplicaciones Django en el proyecto
   */
  async findDjangoApps(projectRoot: string): Promise<string[]> {
    const apps: string[] = [];
    const dirs = await this.getDirectories(projectRoot);

    for (const dir of dirs) {
      // Verificar si es una aplicación Django (contiene apps.py o models.py)
      const appsPyPath = path.join(dir, 'apps.py');
      const modelsPyPath = path.join(dir, 'models.py');

      if (await pathExists(appsPyPath) || await pathExists(modelsPyPath)) {
        apps.push(dir);
      }
    }

    return apps;
  }

  /**
   * Extrae los modelos de un archivo models.py
   */
  async extractModels(modelsPath: string): Promise<DjangoModel[]> {
    const models: DjangoModel[] = [];

    try {
      await initPythonParser();
      const content = await readFile(modelsPath, 'utf8');
      const root = parsePython(content).rootNode;

      // Importaciones: mapa nombre→módulo, para detectar modelos cuya clase base
      // se importa de un módulo `*.models` (p. ej. `from core.models import BaseModel`).
      const importedBaseClasses: { [name: string]: string } = {};
      for (const imp of root.namedChildren) {
        if (imp.type !== 'import_from_statement') {
          continue;
        }
        const moduleNode = imp.childForFieldName('module_name');
        const module = moduleNode ? moduleNode.text : '';
        for (const child of imp.namedChildren) {
          if ((moduleNode && child.id === moduleNode.id) || child.type === 'wildcard_import') {
            continue;
          }
          const importedName = child.type === 'aliased_import'
            ? (child.childForFieldName('name')?.text ?? child.text)
            : child.text;
          if (importedName) {
            importedBaseClasses[importedName] = module;
          }
        }
      }

      const isDjangoModelBase = (baseFullText: string): boolean => {
        if (baseFullText === 'models.Model' || baseFullText === 'Model') {
          return true;
        }
        const module = importedBaseClasses[baseFullText.trim()];
        if (module) {
          return module.includes('django.db.models') ||
                 module.includes('django.contrib.gis.db.models') ||
                 module.endsWith('.models');
        }
        return false;
      };

      // Clases base que, por convención, indican que la clase es un modelo Django.
      const modelBaseClasses = new Set([
        'Model', 'models.Model', 'TranslatableModel', 'MPTTModel', 'AbstractUser',
        'AbstractBaseUser', 'TimeStampedModel', 'BaseModel', 'DjangoModel',
        'ChangeControlMixin', 'SoftDeletableModel', 'TimestampedModel', 'UUIDModel',
        'TreeModel', 'Page', 'AbstractPage', 'AbstractModel', 'AbstractBaseModel'
      ]);

      // Recolectar todas las clases de nivel superior con sus bases (texto completo).
      interface ClassInfo {
        node: SyntaxNode;
        name: string;
        nameRow: number;
        bases: string[];
      }
      const classes: ClassInfo[] = [];
      for (const node of root.namedChildren) {
        if (node.type !== 'class_definition') {
          continue;
        }
        const nameNode = node.childForFieldName('name');
        if (!nameNode) {
          continue;
        }
        const bases: string[] = [];
        const supers = node.childForFieldName('superclasses');
        if (supers) {
          for (const arg of supers.namedChildren) {
            if (arg.type === 'identifier' || arg.type === 'attribute') {
              bases.push(arg.text);
            }
          }
        }
        classes.push({ node, name: nameNode.text, nameRow: nameNode.startPosition.row, bases });
      }

      // Determinar qué clases son modelos: base conocida / importada de `*.models` …
      const modelClasses = new Set<string>();
      for (const cls of classes) {
        if (cls.bases.some(b => modelBaseClasses.has(finalSegment(b)) || isDjangoModelBase(b))) {
          modelClasses.add(cls.name);
        }
      }
      // … y herencia transitiva (un modelo que hereda de otro modelo ya identificado).
      let changed = true;
      while (changed) {
        changed = false;
        for (const cls of classes) {
          if (!modelClasses.has(cls.name) && cls.bases.some(b => modelClasses.has(finalSegment(b)))) {
            modelClasses.add(cls.name);
            changed = true;
          }
        }
      }

      // Extraer campos de cada modelo, en orden de aparición. El AST ignora de forma
      // natural los comentarios (incluso con paréntesis) y las clases anidadas (Meta).
      for (const cls of classes) {
        if (!modelClasses.has(cls.name)) {
          continue;
        }
        const model: DjangoModel = { name: cls.name, lineNumber: cls.nameRow, fields: [] };
        const body = cls.node.childForFieldName('body');
        if (body) {
          for (const stmt of body.namedChildren) {
            // Campo: asignación de nivel superior cuyo valor es una llamada
            // (p. ej. `created = models.DateTimeField(...)`). Multilínea incluido.
            if (stmt.type === 'expression_statement') {
              const assignment = stmt.namedChildren[0];
              if (assignment && assignment.type === 'assignment') {
                const left = assignment.childForFieldName('left');
                const right = assignment.childForFieldName('right');
                if (left && left.type === 'identifier' && right && right.type === 'call') {
                  const fn = right.childForFieldName('function');
                  const calleeText = fn
                    ? (fn.type === 'attribute' ? (fn.childForFieldName('attribute')?.text ?? fn.text) : fn.text)
                    : 'unknown';
                  model.fields!.push({
                    name: left.text,
                    fieldType: finalSegment(calleeText),
                    lineNumber: assignment.startPosition.row
                  });
                }
              }
            }
            // Método decorado con @property → se expone como "campo" de tipo property.
            else if (stmt.type === 'decorated_definition') {
              const hasProperty = stmt.namedChildren.some(
                c => c.type === 'decorator' && c.namedChildren[0]?.text === 'property'
              );
              const def = stmt.childForFieldName('definition');
              if (hasProperty && def && def.type === 'function_definition') {
                const methodName = def.childForFieldName('name');
                if (methodName) {
                  model.fields!.push({
                    name: methodName.text,
                    fieldType: 'property',
                    lineNumber: def.startPosition.row,
                    isProperty: true
                  });
                }
              }
            }
          }
        }
        models.push(model);
      }
    } catch (error) {
      reportError('Error al analizar modelos', error);
    }

    return models;
  }

  /**
   * Extrae las vistas de un archivo views.py
   */
  async extractViews(viewsPath: string): Promise<DjangoView[]> {
    const views: DjangoView[] = [];

    try {
      await initPythonParser();
      const content = await readFile(viewsPath, 'utf8');
      const root = parsePython(content).rootNode;

      for (const node of root.namedChildren) {
        // Una def/class puede venir envuelta en `decorated_definition`: en ese
        // caso los decoradores son hijos `decorator` y la def/class real está en
        // el campo `definition`. El AST ya asocia los decoradores a SU def, así
        // que no hay arrastre a definiciones posteriores (a diferencia del regex).
        let decorators: string[] | undefined;
        let def = node;
        if (node.type === 'decorated_definition') {
          decorators = node.namedChildren
            .filter(c => c.type === 'decorator')
            .map(c => this.decoratorName(c))
            .filter((n): n is string => !!n);
          const inner = node.childForFieldName('definition');
          if (!inner) {
            continue;
          }
          def = inner;
        }

        if (def.type === 'function_definition') {
          const nameNode = def.childForFieldName('name');
          if (nameNode) {
            views.push({
              name: nameNode.text,
              lineNumber: nameNode.startPosition.row,
              isClass: false,
              decorators: decorators && decorators.length ? decorators : undefined
            });
          }
        } else if (def.type === 'class_definition') {
          const nameNode = def.childForFieldName('name');
          if (!nameNode) {
            continue;
          }
          // Clasificar como DRF según la clase base: *ViewSet (routers) o
          // *APIView / *GenericAPIView (APIView y vistas genéricas).
          const bases: string[] = [];
          const supers = def.childForFieldName('superclasses');
          if (supers) {
            for (const arg of supers.namedChildren) {
              if (arg.type === 'identifier' || arg.type === 'attribute') {
                bases.push(finalSegment(arg.text));
              }
            }
          }
          let apiKind: 'viewset' | 'apiview' | undefined;
          if (bases.some(b => /ViewSet$/.test(b))) {
            apiKind = 'viewset';
          } else if (bases.some(b => /APIView$/.test(b))) {
            apiKind = 'apiview';
          }

          views.push({
            name: nameNode.text,
            lineNumber: nameNode.startPosition.row,
            isClass: true,
            apiKind,
            decorators: decorators && decorators.length ? decorators : undefined
          });
        }
      }
    } catch (error) {
      reportError('Error al analizar vistas', error);
    }

    return views;
  }

  /**
   * Devuelve el nombre "limpio" de un nodo `decorator` del AST: descarta el
   * módulo y los argumentos. Ejemplos: `@login_required` → `login_required`,
   * `@auth.permission_required(...)` → `permission_required`,
   * `@app.task` → `task`. Devuelve undefined si no se puede resolver.
   */
  private decoratorName(decorator: SyntaxNode): string | undefined {
    const expr = decorator.namedChildren[0];
    if (!expr) {
      return undefined;
    }
    // `@foo(...)` es un `call`; el nombre está en su campo `function`.
    const target = expr.type === 'call' ? expr.childForFieldName('function') : expr;
    return target ? finalSegment(target.text) : undefined;
  }

  /**
   * Extrae las URLs de un archivo urls.py
   */
  async extractUrls(
    urlsPath: string,
    prefix: string = '',
    visited: Set<string> = new Set<string>()
  ): Promise<DjangoUrl[]> {
    const urls: DjangoUrl[] = [];

    // Guardia contra includes circulares (a→b→a) y bucles de symlinks: si este
    // urls.py ya está en la cadena de resolución, no recursar. Sin esto, un
    // include cíclico provoca recursión infinita y tumba el host de extensiones.
    const canonicalPath = path.resolve(urlsPath);
    if (visited.has(canonicalPath)) {
      return urls;
    }
    visited.add(canonicalPath);

    try {
      await initPythonParser();
      const content = await readFile(urlsPath, 'utf8');
      const root = parsePython(content).rootNode;

      // Recolectar TODAS las llamadas del árbol en orden de aparición. El AST
      // ignora de forma natural los comentarios y une las continuaciones
      // multilínea, así que ya no hace falta el "logical line" ni stripComments.
      const calls: SyntaxNode[] = [];
      const collect = (node: SyntaxNode): void => {
        if (node.type === 'call') {
          calls.push(node);
        }
        for (const child of node.namedChildren) {
          collect(child);
        }
      };
      collect(root);

      // Nombre punteado de una vista: `views.home` tal cual; para una CBV
      // `views.AboutView.as_view()` se usa el objeto de la llamada.
      const dottedName = (node: SyntaxNode): string =>
        node.type === 'call' ? (node.childForFieldName('function')?.text ?? node.text) : node.text;

      for (const call of calls) {
        const fn = call.childForFieldName('function');
        if (!fn) {
          continue;
        }
        const fnName = finalSegment(fn.text);

        // path()/re_path()/url(): primer argumento string = patrón, segundo = vista.
        if (fnName === 'path' || fnName === 're_path' || fnName === 'url') {
          const pos = this.positionalArgs(call);
          const patternNode = pos[0];
          if (!patternNode || patternNode.type !== 'string') {
            continue;
          }
          const viewNode = pos[1];

          // Si el segundo argumento es include(...), es un include, no una ruta.
          if (
            viewNode &&
            viewNode.type === 'call' &&
            finalSegment(viewNode.childForFieldName('function')?.text ?? '') === 'include'
          ) {
            await this.resolveInclude(viewNode, urlsPath, prefix, visited, urls);
            continue;
          }

          if (viewNode) {
            urls.push({
              pattern: prefix + this.stringLiteralValue(patternNode),
              viewName: dottedName(viewNode),
              lineNumber: call.startPosition.row
            });
          }
          continue;
        }

        // Routers DRF: router.register(r'prefix', SomeViewSet[, ...]) (caso #12).
        if (fnName === 'register' && fn.type === 'attribute') {
          const pos = this.positionalArgs(call);
          const patternNode = pos[0];
          const viewNode = pos[1];
          if (patternNode && patternNode.type === 'string' && viewNode) {
            urls.push({
              pattern: prefix + this.stringLiteralValue(patternNode),
              viewName: dottedName(viewNode),
              lineNumber: call.startPosition.row
            });
          }
        }
        // Los include(...) sueltos se procesan vía su path() contenedor (arriba).
      }
    } catch (error) {
      reportError('Error al analizar URLs', error);
    }

    return urls;
  }

  /**
   * Resuelve un include('app.urls'[, 'namespace']) del AST: localiza el urls.py
   * de la app (con protección anti path-traversal) y recursa para anexar sus
   * rutas con el prefijo combinado. El set `visited` corta includes circulares.
   */
  private async resolveInclude(
    includeCall: SyntaxNode,
    urlsPath: string,
    prefix: string,
    visited: Set<string>,
    urls: DjangoUrl[]
  ): Promise<void> {
    const inclPos = this.positionalArgs(includeCall);
    const moduleNode = inclPos[0];
    if (!moduleNode || moduleNode.type !== 'string') {
      return;
    }
    const includedModule = this.stringLiteralValue(moduleNode);
    const includePrefix =
      inclPos[1] && inclPos[1].type === 'string' ? this.stringLiteralValue(inclPos[1]) : '';

    if (!includedModule.endsWith('.urls')) {
      return;
    }
    const appName = includedModule.split('.')[0];
    const projectRoot = path.dirname(path.dirname(urlsPath));
    const appPath = path.resolve(projectRoot, appName);

    // Evitar path traversal: el nombre de app viene de include('...') en un
    // archivo analizado, así que se exige que la ruta resuelta quede dentro del
    // proyecto (descarta '..', rutas absolutas, etc.).
    const withinProject =
      appPath === projectRoot || appPath.startsWith(projectRoot + path.sep);
    if (!withinProject || !(await pathExists(appPath))) {
      return;
    }

    const includedFilePath = path.join(appPath, 'urls.py');
    if (await pathExists(includedFilePath)) {
      const includedUrls = await this.extractUrls(includedFilePath, prefix + includePrefix, visited);
      urls.push(...includedUrls);
    }
  }

  /**
   * Valor "interno" de un literal de cadena del AST: descarta el prefijo
   * (r/b/u/f y combinaciones) y las comillas (simples, dobles o triples).
   * Ejemplos: `r'^a/$'` → `^a/$`, `''` → ``, `"""x"""` → `x`.
   */
  private stringLiteralValue(node: SyntaxNode): string {
    const match = node.text.match(/^[rbuf]*('''|"""|'|")([\s\S]*)\1$/i);
    return match ? match[2] : node.text;
  }

  /**
   * Devuelve las definiciones de clase de nivel superior del módulo, ya estén
   * desnudas (`class X(...)`) o envueltas en un `decorated_definition`.
   */
  private topLevelClassDefs(root: SyntaxNode): SyntaxNode[] {
    const result: SyntaxNode[] = [];
    for (const node of root.namedChildren) {
      if (node.type === 'class_definition') {
        result.push(node);
      } else if (node.type === 'decorated_definition') {
        const def = node.childForFieldName('definition');
        if (def && def.type === 'class_definition') {
          result.push(def);
        }
      }
    }
    return result;
  }

  /**
   * Nombres "finales" de las clases base de una clase (sin módulo):
   * `serializers.ModelSerializer` → `ModelSerializer`.
   */
  private classBaseNames(classNode: SyntaxNode): string[] {
    const supers = classNode.childForFieldName('superclasses');
    if (!supers) {
      return [];
    }
    return supers.namedChildren
      .filter(a => a.type === 'identifier' || a.type === 'attribute')
      .map(a => finalSegment(a.text));
  }

  /**
   * Busca `model = X` en el cuerpo de la clase (típicamente dentro de
   * `class Meta:`) y devuelve el nombre del modelo, o undefined si no hay.
   */
  private findMetaModel(classNode: SyntaxNode): string | undefined {
    const search = (block: SyntaxNode | null): string | undefined => {
      if (!block) {
        return undefined;
      }
      for (const child of block.namedChildren) {
        if (child.type === 'expression_statement') {
          const assignment = child.namedChildren[0];
          if (assignment && assignment.type === 'assignment') {
            const left = assignment.childForFieldName('left');
            const right = assignment.childForFieldName('right');
            if (left && left.text === 'model' && right) {
              return right.text;
            }
          }
        } else if (child.type === 'class_definition') {
          const found = search(child.childForFieldName('body'));
          if (found) {
            return found;
          }
        }
      }
      return undefined;
    };
    return search(classNode.childForFieldName('body'));
  }

  /**
   * Devuelve el valor de un argumento con nombre (`keyword=...`) de una llamada.
   */
  private keywordArg(call: SyntaxNode, name: string): SyntaxNode | undefined {
    const args = call.childForFieldName('arguments');
    if (!args) {
      return undefined;
    }
    for (const a of args.namedChildren) {
      if (a.type === 'keyword_argument' && a.childForFieldName('name')?.text === name) {
        return a.childForFieldName('value') ?? undefined;
      }
    }
    return undefined;
  }

  /**
   * Argumentos posicionales de una llamada (sin keyword= ni comentarios).
   */
  private positionalArgs(call: SyntaxNode): SyntaxNode[] {
    const args = call.childForFieldName('arguments');
    if (!args) {
      return [];
    }
    return args.namedChildren.filter(a => a.type !== 'keyword_argument' && a.type !== 'comment');
  }

  /**
   * Valores de cadena de un literal de lista (`["GET", "POST"]` → ['GET','POST']).
   */
  private stringListValues(node: SyntaxNode | undefined): string[] {
    if (!node || node.type !== 'list') {
      return [];
    }
    return node.namedChildren.filter(e => e.type === 'string').map(e => this.stringLiteralValue(e));
  }

  /**
   * Extrae las clases de admin de un archivo admin.py
   */
  async extractAdminClasses(adminPath: string): Promise<DjangoAdminClass[]> {
    const adminClasses: DjangoAdminClass[] = [];

    try {
      await initPythonParser();
      const content = await readFile(adminPath, 'utf8');
      const root = parsePython(content).rootNode;

      // Clases ya asociadas a un modelo vía decorador, para no duplicarlas
      // en el escaneo de clases.
      const decoratedClasses = new Set<string>();

      // Busca `model = X` en el cuerpo de una clase y devuelve el nombre del modelo.
      const findModelAttr = (classNode: SyntaxNode): string => {
        const body = classNode.childForFieldName('body');
        if (!body) {
          return '';
        }
        for (const stmt of body.namedChildren) {
          if (stmt.type !== 'expression_statement') {
            continue;
          }
          const assignment = stmt.namedChildren[0];
          if (assignment && assignment.type === 'assignment') {
            const left = assignment.childForFieldName('left');
            const right = assignment.childForFieldName('right');
            if (left && left.text === 'model' && right) {
              return right.text;
            }
          }
        }
        return '';
      };

      const isAdminBase = (baseFullText: string): boolean => {
        const baseName = finalSegment(baseFullText);
        return /Admin$/.test(baseName) || baseName === 'TabularInline' || baseName === 'StackedInline';
      };

      // 1) Clases decoradas con @admin.register(A, B, ...): admite varios modelos.
      for (const node of root.namedChildren) {
        if (node.type !== 'decorated_definition') {
          continue;
        }
        const def = node.childForFieldName('definition');
        if (!def || def.type !== 'class_definition') {
          continue;
        }
        const registerDec = node.namedChildren.find(
          c =>
            c.type === 'decorator' &&
            c.namedChildren[0]?.type === 'call' &&
            c.namedChildren[0]?.childForFieldName('function')?.text === 'admin.register'
        );
        if (!registerDec) {
          continue;
        }
        const nameNode = def.childForFieldName('name');
        const callArgs = registerDec.namedChildren[0].childForFieldName('arguments');
        const models = callArgs
          ? callArgs.namedChildren
              .filter(a => a.type !== 'keyword_argument' && a.type !== 'comment')
              .map(a => a.text)
          : [];
        if (nameNode && models.length > 0) {
          decoratedClasses.add(nameNode.text);
          adminClasses.push({
            name: nameNode.text,
            lineNumber: node.startPosition.row,
            modelName: models.join(', ')
          });
        }
      }

      // 2) Clases de admin declaradas: ModelAdmin, inlines o herencia custom (*Admin).
      for (const node of root.namedChildren) {
        if (node.type !== 'class_definition') {
          continue;
        }
        const nameNode = node.childForFieldName('name');
        if (!nameNode || decoratedClasses.has(nameNode.text)) {
          continue;
        }
        const supers = node.childForFieldName('superclasses');
        const bases = supers
          ? supers.namedChildren.filter(a => a.type === 'identifier' || a.type === 'attribute').map(a => a.text)
          : [];
        if (!bases.some(isAdminBase)) {
          continue;
        }
        adminClasses.push({
          name: nameNode.text,
          lineNumber: nameNode.startPosition.row,
          modelName: findModelAttr(node)
        });
      }

      // 3) Registros directos: admin.site.register(Model, AdminClass?).
      const collectRegisters = (node: SyntaxNode): void => {
        if (
          node.type === 'call' &&
          node.childForFieldName('function')?.text === 'admin.site.register'
        ) {
          const args = node.childForFieldName('arguments');
          const pos = args
            ? args.namedChildren.filter(a => a.type !== 'keyword_argument' && a.type !== 'comment')
            : [];
          if (pos[0]) {
            adminClasses.push({
              name: pos[1]?.text || 'ModelAdmin',
              lineNumber: node.startPosition.row,
              modelName: pos[0].text
            });
          }
        }
        for (const child of node.namedChildren) {
          collectRegisters(child);
        }
      };
      collectRegisters(root);
    } catch (error) {
      reportError('Error al analizar clases de admin', error);
    }

    return adminClasses;
  }

  /**
   * Extrae las variables definidas en un archivo settings.py
   */
  async extractSettings(settingsPath: string): Promise<DjangoSetting[]> {
    const settings: DjangoSetting[] = [];

    try {
      await initPythonParser();
      const content = await readFile(settingsPath, 'utf8');
      const root = parsePython(content).rootNode;

      // Un setting es una asignación de nivel superior cuyo nombre va en
      // MAYÚSCULAS (convención Django). El AST captura el valor completo —
      // incluidos dicts/listas multilínea anidados— sin contar brackets a mano,
      // e ignora de forma natural comentarios y docstrings (no son asignaciones).
      const isSettingName = /^[A-Z_][A-Z0-9_]*$/;

      for (const node of root.namedChildren) {
        if (node.type !== 'expression_statement') {
          continue;
        }
        const assignment = node.namedChildren[0];
        if (!assignment || assignment.type !== 'assignment') {
          continue;
        }
        const left = assignment.childForFieldName('left');
        const right = assignment.childForFieldName('right');
        if (!left || left.type !== 'identifier' || !isSettingName.test(left.text) || !right) {
          continue;
        }

        // Colapsar la indentación/saltos de los valores multilínea a una sola
        // línea, como hacía la versión anterior (mejor presentación en el árbol).
        const value = right.text.replace(/\s+/g, ' ').trim();
        settings.push({
          name: left.text,
          value,
          lineNumber: left.startPosition.row
        });
      }
    } catch (error) {
      reportError('Error al analizar settings', error);
    }

    return settings;
  }

  /**
   * Extrae las tareas de un archivo tasks.py del framework de Tasks de Django 6.
   *
   * Detecta funciones decoradas con `@task` (o su alias) importado de
   * `django.tasks`. Se EXIGE el import `from django.tasks import task[ as alias]`
   * para identificar el decorador: así se evitan falsos positivos con `@task` de
   * otros frameworks (p. ej. Celery, que además usa `@shared_task`/`@app.task`).
   */
  async extractTasks(tasksPath: string): Promise<DjangoTask[]> {
    const tasks: DjangoTask[] = [];

    try {
      await initPythonParser();
      const content = await readFile(tasksPath, 'utf8');
      const root = parsePython(content).rootNode;

      // Nombres de decorador que corresponden a django.tasks.task (con o sin alias).
      const taskDecorators = new Set<string>();
      for (const imp of root.namedChildren) {
        if (imp.type !== 'import_from_statement') {
          continue;
        }
        if (imp.childForFieldName('module_name')?.text !== 'django.tasks') {
          continue;
        }
        for (const child of imp.namedChildren) {
          if (child.type === 'dotted_name' && child.text === 'task') {
            taskDecorators.add('task');
          } else if (child.type === 'aliased_import') {
            const original = child.childForFieldName('name')?.text;
            const alias = child.childForFieldName('alias')?.text;
            if (original === 'task' && alias) {
              taskDecorators.add(alias);
            }
          }
        }
      }

      // Sin import de django.tasks no hay nada que identificar como tarea.
      if (taskDecorators.size === 0) {
        return tasks;
      }

      // Funciones decoradas con @task (o su alias): basta con que UNO de los
      // decoradores apilados sea de django.tasks. Los `@task(...)` con argumentos
      // también valen (el AST los representa como `call`).
      for (const node of root.namedChildren) {
        if (node.type !== 'decorated_definition') {
          continue;
        }
        const def = node.childForFieldName('definition');
        if (!def || def.type !== 'function_definition') {
          continue;
        }
        const isTask = node.namedChildren.some(
          c => c.type === 'decorator' && taskDecorators.has(this.decoratorName(c) ?? '')
        );
        const nameNode = def.childForFieldName('name');
        if (isTask && nameNode) {
          tasks.push({ name: nameNode.text, lineNumber: nameNode.startPosition.row });
        }
      }
    } catch (error) {
      reportError('Error al analizar tareas', error);
    }

    return tasks;
  }

  /**
   * Extrae las definiciones de partials de un archivo de plantilla de Django 6
   * (`{% partialdef nombre %}`). Ignora las definiciones dentro de comentarios de
   * plantilla `{# ... #}`. No confunde el uso `{% partial nombre %}` con la
   * definición `{% partialdef ... %}`.
   */
  async extractPartials(templatePath: string): Promise<DjangoPartial[]> {
    const partials: DjangoPartial[] = [];

    try {
      const content = await readFile(templatePath, 'utf8');
      // Neutralizar comentarios de plantilla {# ... #} conservando los '\n'.
      const cleaned = content.replace(/\{#[\s\S]*?#\}/g, block =>
        block.replace(/[^\n]/g, ' ')
      );

      // El nombre de un partial admite letras, dígitos, guiones, guiones bajos y puntos.
      const partialdefRegex = /\{%\s*partialdef\s+([\w.-]+)/g;
      let match: RegExpExecArray | null;
      while ((match = partialdefRegex.exec(cleaned)) !== null) {
        const lineNumber = cleaned.substring(0, match.index).split('\n').length - 1;
        partials.push({ name: match[1], lineNumber, templatePath });
      }
    } catch (error) {
      reportError('Error al analizar partials de plantilla', error);
    }

    return partials;
  }

  /**
   * Recorre las plantillas (.html) de una aplicación y agrega todos los partials
   * definidos en ellas, conservando la ruta de cada plantilla de origen.
   */
  async findAppPartials(appPath: string): Promise<DjangoPartial[]> {
    const result: DjangoPartial[] = [];
    const templateFiles = await this.findTemplateFiles(appPath);

    for (const file of templateFiles) {
      const partials = await this.extractPartials(file);
      result.push(...partials);
    }

    return result;
  }

  /**
   * Extrae los serializers de DRF de un archivo serializers.py: clases cuya
   * clase base termina en `Serializer` (ModelSerializer, Serializer, custom…).
   * Intenta asociar el modelo declarado en `class Meta: model = X`.
   */
  async extractSerializers(serializersPath: string): Promise<DjangoSerializer[]> {
    const serializers: DjangoSerializer[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(serializersPath, 'utf8')).rootNode;

      for (const cls of this.topLevelClassDefs(root)) {
        const nameNode = cls.childForFieldName('name');
        if (!nameNode || !this.classBaseNames(cls).some(b => /Serializer$/.test(b))) {
          continue;
        }
        serializers.push({
          name: nameNode.text,
          lineNumber: nameNode.startPosition.row,
          modelName: this.findMetaModel(cls)
        });
      }
    } catch (error) {
      reportError('Error al analizar serializers', error);
    }

    return serializers;
  }

  /**
   * Extrae los schemas de django-ninja de un archivo schemas.py: clases cuya
   * clase base termina en `Schema` (Schema, ModelSchema, custom…).
   */
  async extractSchemas(schemasPath: string): Promise<DjangoSchema[]> {
    const schemas: DjangoSchema[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(schemasPath, 'utf8')).rootNode;

      for (const cls of this.topLevelClassDefs(root)) {
        const nameNode = cls.childForFieldName('name');
        if (nameNode && this.classBaseNames(cls).some(b => /Schema$/.test(b))) {
          schemas.push({ name: nameNode.text, lineNumber: nameNode.startPosition.row });
        }
      }
    } catch (error) {
      reportError('Error al analizar schemas', error);
    }

    return schemas;
  }

  /**
   * Extrae los endpoints de django-ninja de un archivo api.py: operaciones
   * decoradas `@<objeto>.<método>(...)` con método get/post/put/patch/delete
   * (p. ej. `@api.get("/items")`, `@router.post("/items/{id}")`).
   */
  async extractNinjaEndpoints(apiPath: string): Promise<DjangoApiEndpoint[]> {
    const endpoints: DjangoApiEndpoint[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(apiPath, 'utf8')).rootNode;
      const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);

      for (const node of root.namedChildren) {
        if (node.type !== 'decorated_definition') {
          continue;
        }
        const def = node.childForFieldName('definition');
        if (!def || def.type !== 'function_definition') {
          continue;
        }
        const nameNode = def.childForFieldName('name');
        if (!nameNode) {
          continue;
        }

        // Decorador @<objeto>.<método>("/ruta"): p. ej. @api.get("/items").
        for (const dec of node.namedChildren) {
          if (dec.type !== 'decorator') {
            continue;
          }
          const call = dec.namedChildren[0];
          const fn = call && call.type === 'call' ? call.childForFieldName('function') : null;
          if (!fn || fn.type !== 'attribute') {
            continue;
          }
          const method = fn.childForFieldName('attribute')?.text ?? '';
          if (!httpMethods.has(method)) {
            continue;
          }
          const first = this.positionalArgs(call)[0];
          endpoints.push({
            method: method.toUpperCase(),
            path: first && first.type === 'string' ? this.stringLiteralValue(first) : '',
            handler: nameNode.text,
            lineNumber: dec.startPosition.row,
            framework: 'ninja',
            filePath: apiPath
          });
          break;
        }
      }
    } catch (error) {
      reportError('Error al analizar endpoints de django-ninja', error);
    }

    return endpoints;
  }

  /**
   * Extrae los endpoints de DRF basados en decorador de un archivo (views.py /
   * viewsets.py): funciones `@api_view([...])` y acciones extra `@action(...)`
   * de los ViewSets. Las rutas de router.register() ya se ven en el nodo URLs.
   */
  async extractDrfEndpoints(filePath: string): Promise<DjangoApiEndpoint[]> {
    const endpoints: DjangoApiEndpoint[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(filePath, 'utf8')).rootNode;

      // @api_view (vistas función) y @action (métodos de ViewSet) pueden estar a
      // nivel superior o anidados en una clase: se recorre todo el árbol.
      const walk = (node: SyntaxNode): void => {
        if (node.type === 'decorated_definition') {
          const def = node.childForFieldName('definition');
          if (def && def.type === 'function_definition') {
            const nameNode = def.childForFieldName('name');
            if (nameNode) {
              let pending: { method: string; path: string; line: number } | null = null;
              for (const dec of node.namedChildren) {
                if (dec.type !== 'decorator') {
                  continue;
                }
                const call = dec.namedChildren[0];
                if (!call || call.type !== 'call') {
                  continue;
                }
                const decName = finalSegment(call.childForFieldName('function')?.text ?? '');
                if (decName === 'api_view') {
                  const methods = this.stringListValues(this.positionalArgs(call)[0]);
                  pending = { method: (methods.join(', ') || 'GET').toUpperCase(), path: '', line: dec.startPosition.row };
                } else if (decName === 'action') {
                  const methods = this.stringListValues(this.keywordArg(call, 'methods'));
                  const urlPathNode = this.keywordArg(call, 'url_path');
                  pending = {
                    method: (methods.join(', ') || 'GET').toUpperCase(),
                    path: urlPathNode && urlPathNode.type === 'string' ? this.stringLiteralValue(urlPathNode) : '',
                    line: dec.startPosition.row
                  };
                }
              }
              if (pending) {
                endpoints.push({
                  method: pending.method,
                  path: pending.path || nameNode.text,
                  handler: nameNode.text,
                  lineNumber: pending.line,
                  framework: 'drf',
                  filePath
                });
              }
            }
          }
        }
        for (const child of node.namedChildren) {
          walk(child);
        }
      };
      walk(root);
    } catch (error) {
      reportError('Error al analizar endpoints de DRF', error);
    }

    return endpoints;
  }

  /**
   * Extrae los formularios de un archivo forms.py: clases cuya clase base termina
   * en `Form` (Form, ModelForm, custom…). Asocia el modelo de `class Meta: model`.
   */
  async extractForms(formsPath: string): Promise<DjangoForm[]> {
    const forms: DjangoForm[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(formsPath, 'utf8')).rootNode;

      for (const cls of this.topLevelClassDefs(root)) {
        const nameNode = cls.childForFieldName('name');
        if (!nameNode || !this.classBaseNames(cls).some(b => /Form$/.test(b))) {
          continue;
        }
        forms.push({
          name: nameNode.text,
          lineNumber: nameNode.startPosition.row,
          modelName: this.findMetaModel(cls)
        });
      }
    } catch (error) {
      reportError('Error al analizar formularios', error);
    }

    return forms;
  }

  /**
   * Extrae las señales de un archivo signals.py: funciones decoradas con
   * `@receiver(...)` y señales personalizadas declaradas como `NOMBRE = Signal(...)`.
   */
  async extractSignals(signalsPath: string): Promise<DjangoSignal[]> {
    const signals: DjangoSignal[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(signalsPath, 'utf8')).rootNode;

      for (const node of root.namedChildren) {
        // Funciones decoradas con @receiver(...).
        if (node.type === 'decorated_definition') {
          const def = node.childForFieldName('definition');
          if (def && def.type === 'function_definition') {
            const isReceiver = node.namedChildren.some(
              c => c.type === 'decorator' && this.decoratorName(c) === 'receiver'
            );
            const nameNode = def.childForFieldName('name');
            if (isReceiver && nameNode) {
              signals.push({ name: nameNode.text, lineNumber: nameNode.startPosition.row, kind: 'receiver' });
            }
          }
          continue;
        }

        // Señales personalizadas: NOMBRE = Signal(...).
        if (node.type === 'expression_statement') {
          const assignment = node.namedChildren[0];
          if (assignment && assignment.type === 'assignment') {
            const left = assignment.childForFieldName('left');
            const right = assignment.childForFieldName('right');
            if (
              left && left.type === 'identifier' &&
              right && right.type === 'call' &&
              finalSegment(right.childForFieldName('function')?.text ?? '') === 'Signal'
            ) {
              signals.push({ name: left.text, lineNumber: left.startPosition.row, kind: 'signal' });
            }
          }
        }
      }
    } catch (error) {
      reportError('Error al analizar señales', error);
    }

    return signals;
  }

  /**
   * Extrae las tareas de Celery de un archivo tasks.py: funciones decoradas con
   * `@shared_task` o `@<app>.task` (`@app.task`, `@celery_app.task`…). No captura
   * `@task` de django.tasks (eso lo hace extractTasks).
   */
  async extractCeleryTasks(tasksPath: string): Promise<DjangoCeleryTask[]> {
    const tasks: DjangoCeleryTask[] = [];

    try {
      await initPythonParser();
      const root = parsePython(await readFile(tasksPath, 'utf8')).rootNode;

      // Es Celery si el decorador es `@shared_task` o `@<obj>.task` (con o sin
      // argumentos). El `@task` desnudo de django.tasks NO cuenta (extractTasks).
      const isCeleryDecorator = (dec: SyntaxNode): boolean => {
        const expr = dec.namedChildren[0];
        if (!expr) {
          return false;
        }
        const target = expr.type === 'call' ? expr.childForFieldName('function') : expr;
        if (!target) {
          return false;
        }
        if (target.type === 'identifier') {
          return target.text === 'shared_task';
        }
        if (target.type === 'attribute') {
          return target.childForFieldName('attribute')?.text === 'task';
        }
        return false;
      };

      for (const node of root.namedChildren) {
        if (node.type !== 'decorated_definition') {
          continue;
        }
        const def = node.childForFieldName('definition');
        if (!def || def.type !== 'function_definition') {
          continue;
        }
        const isCelery = node.namedChildren.some(c => c.type === 'decorator' && isCeleryDecorator(c));
        const nameNode = def.childForFieldName('name');
        if (isCelery && nameNode) {
          tasks.push({ name: nameNode.text, lineNumber: nameNode.startPosition.row });
        }
      }
    } catch (error) {
      reportError('Error al analizar tareas de Celery', error);
    }

    return tasks;
  }

  /**
   * Lista los comandos de gestión de una app (management/commands/<nombre>.py).
   * El nombre del comando es el del fichero, sin extensión, igual que en Django.
   */
  async findManagementCommands(appPath: string): Promise<DjangoCommand[]> {
    const commands: DjangoCommand[] = [];
    const commandsDir = path.join(appPath, 'management', 'commands');

    try {
      const entries = await readdir(commandsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isFile() &&
          entry.name.endsWith('.py') &&
          entry.name !== '__init__.py'
        ) {
          commands.push({
            name: entry.name.slice(0, -3),
            filePath: path.join(commandsDir, entry.name)
          });
        }
      }
    } catch {
      // El directorio puede no existir: no es un error, simplemente no hay comandos.
    }

    return commands;
  }

  /**
   * Lista las plantillas (.html) de una aplicación. Versión pública de
   * findTemplateFiles para el nodo "Templates" del árbol.
   */
  async findAppTemplates(appPath: string): Promise<string[]> {
    return this.findTemplateFiles(appPath);
  }

  /**
   * Busca en todo el proyecto los ficheros con un nombre dado (p. ej. urls.py,
   * models.py), incluyendo la raíz del proyecto y todos sus subdirectorios.
   */
  private async findProjectFiles(projectRoot: string, filename: string): Promise<string[]> {
    const result: string[] = [];
    const dirs = [projectRoot, ...await this.getDirectories(projectRoot)];
    for (const dir of dirs) {
      const candidate = path.join(dir, filename);
      if (await pathExists(candidate)) {
        result.push(candidate);
      }
    }
    return result;
  }

  /**
   * Resuelve un nombre de URL (`reverse('app:detail')` / `{% url 'app:detail' %}`)
   * a la línea `name='detail'` de un urls.py. Usa el último segmento tras ':',
   * de modo que se ignora el namespace para localizar la definición.
   */
  async findUrlName(projectRoot: string, name: string): Promise<DjangoLocation | undefined> {
    const segment = name.includes(':') ? (name.split(':').pop() || name) : name;
    if (!segment) {
      return undefined;
    }
    const urlsFiles = await this.findProjectFiles(projectRoot, 'urls.py');
    await initPythonParser();

    // Localiza el argumento `name='<segment>'` de un path()/re_path()/url() en el
    // AST. El recorrido ignora comentarios de forma natural.
    const findName = (node: SyntaxNode): SyntaxNode | undefined => {
      if (
        node.type === 'keyword_argument' &&
        node.childForFieldName('name')?.text === 'name'
      ) {
        const value = node.childForFieldName('value');
        if (value && value.type === 'string' && this.stringLiteralValue(value) === segment) {
          return node;
        }
      }
      for (const child of node.namedChildren) {
        const found = findName(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    for (const file of urlsFiles) {
      const root = parsePython(await readFile(file, 'utf8')).rootNode;
      const match = findName(root);
      if (match) {
        return { filePath: file, lineNumber: match.startPosition.row };
      }
    }
    return undefined;
  }

  /**
   * Resuelve una ruta de plantilla relativa (`"app/detail.html"`) al fichero
   * .html correspondiente, buscando primero por sufijo `templates/<rel>` y, si
   * no, por el propio sufijo relativo.
   */
  async findTemplateFile(projectRoot: string, relPath: string): Promise<string | undefined> {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const templates = await this.findTemplateFiles(projectRoot);
    const bySuffix = (suffix: string): string | undefined =>
      templates.find(file => file.replace(/\\/g, '/').endsWith(suffix));

    return bySuffix(`templates/${normalized}`) || bySuffix(`/${normalized}`);
  }

  /**
   * Resuelve una referencia de modelo (`'app.Author'` o `Author`) a la línea de
   * su `class Author(...)` en algún models.py del proyecto.
   */
  async findModelClass(projectRoot: string, modelRef: string): Promise<DjangoLocation | undefined> {
    const modelName = modelRef.includes('.') ? (modelRef.split('.').pop() || modelRef) : modelRef;
    if (!modelName) {
      return undefined;
    }
    const modelsFiles = await this.findProjectFiles(projectRoot, 'models.py');
    await initPythonParser();

    // Localiza `class <modelName>(...)` en el AST (con clase base, como exigía el
    // regex original). El recorrido cubre clases anidadas e ignora comentarios.
    const findClass = (node: SyntaxNode): SyntaxNode | undefined => {
      if (
        node.type === 'class_definition' &&
        node.childForFieldName('name')?.text === modelName &&
        node.childForFieldName('superclasses')
      ) {
        return node.childForFieldName('name') ?? node;
      }
      for (const child of node.namedChildren) {
        const found = findClass(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    };

    for (const file of modelsFiles) {
      const root = parsePython(await readFile(file, 'utf8')).rootNode;
      const match = findClass(root);
      if (match) {
        return { filePath: file, lineNumber: match.startPosition.row };
      }
    }
    return undefined;
  }

  /**
   * Busca recursivamente archivos .html dentro de una aplicación, limitando la
   * profundidad y excluyendo directorios pesados, igual que getDirectories.
   */
  private async findTemplateFiles(dir: string, depth: number = 0): Promise<string[]> {
    const files: string[] = [];
    const MAX_DEPTH = 8;
    const EXCLUDED_DIRS = new Set<string>([
      'node_modules', 'venv', '.venv', 'env', 'site-packages',
      '.git', '.tox', '.mypy_cache', '.pytest_cache'
    ]);

    if (depth > MAX_DEPTH) {
      return files;
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) {
            continue;
          }
          files.push(...await this.findTemplateFiles(fullPath, depth + 1));
        } else if (entry.isFile() && entry.name.endsWith('.html')) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      // Rutas sin permisos: registrar sin interrumpir.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[DjangoStructureExplorer] Error al leer plantillas en "${dir}": ${message}`);
    }

    return files;
  }

  /**
   * Obtiene todos los directorios en un directorio dado, de forma recursiva.
   * Limita la profundidad y excluye directorios pesados (entornos virtuales,
   * dependencias) para evitar congelar VS Code en proyectos grandes.
   */
  private async getDirectories(dir: string, depth: number = 0): Promise<string[]> {
    const dirs: string[] = [];
    const MAX_DEPTH = 6;
    const EXCLUDED_DIRS = new Set<string>([
      'node_modules', 'venv', '.venv', 'env', 'site-packages',
      '.git', '.tox', '.mypy_cache', '.pytest_cache', 'migrations'
    ]);

    if (depth > MAX_DEPTH) {
      return dirs;
    }

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (
          entry.isDirectory() &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('__') &&
          !EXCLUDED_DIRS.has(entry.name)
        ) {
          dirs.push(fullPath);

          // Recursivamente buscar en subdirectorios
          const subdirs = await this.getDirectories(fullPath, depth + 1);
          dirs.push(...subdirs);
        }
      }
    } catch (error) {
      // La travesía de directorios puede toparse con rutas sin permisos;
      // se registra pero no se interrumpe ni se molesta al usuario.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[DjangoStructureExplorer] Error al leer el directorio "${dir}": ${message}`);
    }

    return dirs;
  }
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

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
 * Escapa los metacaracteres de una cadena para incrustarla con seguridad dentro
 * de un patrón RegExp. Sin esto, un import malformado (p. ej. con paréntesis)
 * podría romper `new RegExp(...)` y dejar el parseo de campos vacío en silencio.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

export class DjangoProjectAnalyzer {

  /**
   * Neutraliza los comentarios del contenido para que el análisis por regex no
   * detecte símbolos dentro de código comentado. Reemplaza por espacios:
   *  - comentarios de línea (`#` fuera de cadenas), hasta el fin de línea
   *  - el INTERIOR de bloques de triple comilla (`"""` / `'''`), conservando
   *    los delimitadores de apertura y cierre
   *
   * Conserva la longitud del texto y las posiciones de `\n`, de modo que los
   * números de línea y los offsets siguen siendo válidos para todos los
   * extractores (tanto los que iteran `split('\n')` como `extractAdminClasses`,
   * que calcula la línea con `content.substring(0, index)`).
   *
   * Las cadenas normales de una sola línea se conservan intactas: son valores
   * que el parser necesita (patrones de URL, valores de settings…); solo se
   * evita interpretar una `#` dentro de ellas como comentario.
   */
  private stripComments(content: string): string {
    const chars = content.split('');
    const n = chars.length;
    let inLineComment = false;
    let single: '"' | "'" | null = null; // cadena de una línea
    let triple: '"' | "'" | null = null; // bloque de triple comilla

    const blank = (idx: number): void => {
      if (chars[idx] !== '\n' && chars[idx] !== '\r') {
        chars[idx] = ' ';
      }
    };

    let i = 0;
    while (i < n) {
      const c = chars[i];

      if (inLineComment) {
        if (c === '\n') {
          inLineComment = false;
        } else {
          blank(i);
        }
        i++;
        continue;
      }

      if (triple) {
        // ¿Cierre del bloque triple? Conservar los 3 delimitadores.
        if (c === triple && chars[i + 1] === triple && chars[i + 2] === triple) {
          triple = null;
          i += 3;
          continue;
        }
        blank(i);
        i++;
        continue;
      }

      if (single) {
        if (c === '\\') {
          i += 2; // saltar el carácter escapado
          continue;
        }
        if (c === single || c === '\n') {
          single = null; // fin de cadena (las cadenas de una línea no cruzan '\n')
        }
        i++;
        continue;
      }

      // Fuera de cualquier cadena o comentario
      if (c === '#') {
        inLineComment = true;
        blank(i);
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        if (chars[i + 1] === c && chars[i + 2] === c) {
          triple = c; // entrar al bloque triple, conservando el delimitador
          i += 3;
          continue;
        }
        single = c;
        i++;
        continue;
      }
      i++;
    }

    return chars.join('');
  }

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
      const content = this.stripComments(await readFile(modelsPath, 'utf8'));
      const lines = content.split('\n');

      // Analizar las importaciones para detectar alias de models o importaciones directas
      const importAliases: {[key: string]: string} = {};
      const directImports: string[] = [];

      // Buscar importaciones como "from django.db import models" o "from django.db.models import CharField, TextField"
      for (let i = 0; i < 30 && i < lines.length; i++) { // Revisar solo las primeras líneas
        const line = lines[i].trim();

        // Detectar alias de models
        const aliasMatch = line.match(/^from\s+django\.db\s+import\s+models\s+as\s+(\w+)/);
        if (aliasMatch) {
          importAliases['models'] = aliasMatch[1];
        }

        // Detectar importaciones directas de tipos de campo
        const directImportMatch = line.match(/^from\s+django\.db\.models\s+import\s+(.+)$/);
        if (directImportMatch) {
          const imports = directImportMatch[1].split(',').map(i => i.trim());
          directImports.push(...imports);
        }
      }

      // Almacenar las clases base importadas que podrían ser modelos
      const importedBaseClasses: {[key: string]: string} = {};

      // Buscar importaciones de clases base personalizadas
      for (let i = 0; i < 30 && i < lines.length; i++) {
        const line = lines[i].trim();

        // Detectar importaciones de clases base
        const baseClassMatch = line.match(/^from\s+([\w.]+)\s+import\s+([\w,\s]+)$/);
        if (baseClassMatch) {
          const module = baseClassMatch[1];
          const imports = baseClassMatch[2].split(',').map(i => i.trim());

          imports.forEach(importName => {
            importedBaseClasses[importName] = module;
          });
        }
      }

      // Función para verificar si una clase base es un modelo Django basado en importaciones
      const isDjangoModel = (baseClass: string): boolean => {
        // Casos directos
        if (baseClass === 'models.Model' || baseClass === 'Model') {
          return true;
        }

        // Verificar clases importadas
        const cleanBase = baseClass.trim();
        if (importedBaseClasses[cleanBase]) {
          const module = importedBaseClasses[cleanBase];
          return module.includes('django.db.models') ||
                 module.includes('django.contrib.gis.db.models') ||
                 module.endsWith('.models');
        }

        return false;
      };

      // Mantener un registro de las clases que son modelos
      const modelClasses = new Set<string>();

      // Lista de clases base comunes que indican que es un modelo
      const modelBaseClasses = [
        'Model',
        'models.Model',
        'TranslatableModel',
        'MPTTModel',
        'AbstractUser',
        'AbstractBaseUser',
        'TimeStampedModel',
        'BaseModel',
        'DjangoModel',
        'ChangeControlMixin',  // Aunque es un mixin, lo incluimos para detectar modelos que lo usan
        'SoftDeletableModel',
        'TimestampedModel',
        'UUIDModel',
        'TreeModel',
        'Page',
        'AbstractPage',
        'AbstractModel',
        'AbstractBaseModel'
      ];

      // Primera pasada: identificar todas las clases que heredan directamente de Model o clases base conocidas
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('class ')) {
          const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]+)\)/);
          if (classMatch) {
            const className = classMatch[1];
            const baseClasses = classMatch[2].split(',').map(c => c.trim());

            // Verificar si hereda de alguna clase base conocida explícitamente o a través de importación
            if (baseClasses.some(base =>
              modelBaseClasses.includes(base.split('.')?.pop() || base) ||
              isDjangoModel(base)
            )) {
              modelClasses.add(className);
            }
          }
        }
      }

      // Segunda pasada: identificar clases que heredan de modelos ya identificados
      let newModelsFound = true;
      while (newModelsFound) {
        newModelsFound = false;
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line.startsWith('class ')) {
            const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]+)\)/);
            if (classMatch) {
              const className = classMatch[1];
              if (!modelClasses.has(className)) {
                const baseClasses = classMatch[2].split(',').map(c => c.trim());
                // Si alguna clase base es un modelo conocido, esta también es un modelo
                if (baseClasses.some(base => modelClasses.has(base))) {
                  modelClasses.add(className);
                  newModelsFound = true;
                }
              }
            }
          }
        }
      }

      // Expresión regular para encontrar el inicio de una clase
      const classRegex = /^class\s+(\w+)\s*\(/;
      // Expresión regular para encontrar el inicio de la clase Meta
      const metaClassRegex = /^\s+class\s+Meta\s*:/;
      // Expresión regular para detectar decoradores @property
      const propertyDecoratorRegex = /^\s*@property\s*$/;

      let currentModel: DjangoModel | null = null;
      let inModelDefinition = false;
      let inMetaClass = false;
      let classIndentation = 0;
      let metaIndentation = 0; // Indentación de la línea `class Meta:`
      let fieldStartIndentation = 0;
      let currentFieldName = '';
      let currentFieldType = '';
      let currentFieldLine = 0;
      let parenthesesCount = 0; // Para rastrear paréntesis abiertos/cerrados
      let isPropertyMethod = false; // Para rastrear si el próximo método tiene el decorador @property

      // Patrones de campo compilados UNA sola vez (no dependen de la línea).
      // El último grupo captura el paréntesis de apertura (`\(?` dentro del grupo)
      // para que el conteo de paréntesis cuente tanto `(` como `)`. El tipo de campo
      // es siempre el grupo 2 tanto en patrones con prefijo como en importación directa.
      const fieldPatterns: RegExp[] = [
        new RegExp(`^\\s+(\\w+)\\s*=\\s*models\\.(\\w+)\\s*(\\(?.*)`)
      ];
      if (importAliases['models']) {
        fieldPatterns.push(new RegExp(`^\\s+(\\w+)\\s*=\\s*${importAliases['models']}\\.(\\w+)\\s*(\\(?.*)`));
      }
      if (directImports.length > 0) {
        const directImportsPattern = directImports.map(escapeRegExp).join('|');
        fieldPatterns.push(new RegExp(`^\\s+(\\w+)\\s*=\\s*(${directImportsPattern})\\s*(\\(?.*)`));
      }

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const indentMatch = line.match(/^(\s*)/);
        const indentation = indentMatch ? indentMatch[1].length : 0;

        // Detectar decorador @property
        if (line.trim().match(propertyDecoratorRegex)) {
          isPropertyMethod = true;
          continue;
        }

        // Detectar una nueva clase
        const classMatch = line.match(classRegex);
        if (classMatch && modelClasses.has(classMatch[1])) {
          // Guardar el modelo anterior si existe
          if (currentModel) {
            models.push(currentModel);
          }

          // Crear un nuevo modelo
          currentModel = {
            name: classMatch[1],
            lineNumber: i,
            fields: []
          };

          // Iniciar el seguimiento de la definición del modelo
          inModelDefinition = true;
          inMetaClass = false;
          classIndentation = indentation;
          isPropertyMethod = false;
          continue;
        }

        // Si no estamos dentro de un modelo, continuar
        if (!currentModel || !inModelDefinition) {
          isPropertyMethod = false;
          continue;
        }

        // Si es una línea vacía, continuar
        if (line.trim() === '') {
          continue;
        }

        // Detectar si estamos entrando en la clase Meta
        if (line.match(metaClassRegex)) {
          inMetaClass = true;
          metaIndentation = indentation;
          isPropertyMethod = false;
          continue;
        }

        // Salir de la clase Meta al volver a un nivel de indentación igual o menor
        // al de `class Meta:` (p. ej. un campo declarado tras Meta, caso #11).
        // Antes inMetaClass solo se reseteaba al cambiar de clase, perdiendo esos campos.
        if (inMetaClass && line.trim() !== '' && indentation <= metaIndentation) {
          inMetaClass = false;
        }

        // Si la indentación es menor o igual a la de la clase, hemos salido del modelo
        if (indentation <= classIndentation && line.trim() !== '') {
          // Guardar el modelo actual
          models.push(currentModel);
          currentModel = null;
          inModelDefinition = false;
          inMetaClass = false;
          isPropertyMethod = false;
          continue;
        }

        // Ignorar líneas dentro de la clase Meta
        if (inMetaClass) {
          continue;
        }

        // Detectar método con decorador @property
        const methodMatch = line.match(/^\s+def\s+(\w+)\s*\(/);
        if (isPropertyMethod && methodMatch) {
          currentModel.fields!.push({
            name: methodMatch[1],
            fieldType: 'property',
            lineNumber: i,
            isProperty: true
          });
          isPropertyMethod = false;
          continue;
        }

        // Construir expresión regular para detectar campos considerando alias e importaciones directas
        // Intentar cada patrón (ya compilados fuera del bucle)
        let fieldMatch: RegExpMatchArray | null = null;
        for (const regex of fieldPatterns) {
          const match = line.match(regex);
          if (match) {
            fieldMatch = match;
            break;
          }
        }

        if (fieldMatch) {
          // Si estábamos procesando un campo anterior, añadirlo al modelo
          if (currentFieldName && currentFieldType) {
            currentModel.fields!.push({
              name: currentFieldName,
              fieldType: currentFieldType,
              lineNumber: currentFieldLine
            });
          }

          // Iniciar el seguimiento de un nuevo campo. El tipo es siempre el grupo 2.
          currentFieldName = fieldMatch[1];
          currentFieldType = fieldMatch[2];
          currentFieldLine = i;
          fieldStartIndentation = indentation;

          // Contar paréntesis abiertos y cerrados en esta línea
          const openParens = (fieldMatch[fieldMatch.length - 1].match(/\(/g) || []).length;
          const closeParens = (fieldMatch[fieldMatch.length - 1].match(/\)/g) || []).length;
          parenthesesCount = openParens - closeParens;

          // Si los paréntesis están equilibrados, el campo está completo en esta línea
          if (parenthesesCount === 0) {
            currentModel.fields!.push({
              name: currentFieldName,
              fieldType: currentFieldType,
              lineNumber: currentFieldLine
            });
            currentFieldName = '';
            currentFieldType = '';
          }
        }
        // Continuación de un campo de múltiples líneas
        else if (currentFieldName && currentFieldType && parenthesesCount > 0) {
          // Contar paréntesis en esta línea
          const openParens = (line.match(/\(/g) || []).length;
          const closeParens = (line.match(/\)/g) || []).length;
          parenthesesCount += openParens - closeParens;

          // Si los paréntesis están equilibrados, el campo está completo
          if (parenthesesCount === 0) {
            currentModel.fields!.push({
              name: currentFieldName,
              fieldType: currentFieldType,
              lineNumber: currentFieldLine
            });
            currentFieldName = '';
            currentFieldType = '';
          }
        }
        // Nueva línea con la misma indentación que el nivel de campo, pero no es continuación
        else if (indentation === fieldStartIndentation && !line.trim().startsWith('#')) {
          // Verificar si es un nuevo campo con cualquier formato no capturado anteriormente
          const otherFieldRegex = /^\s+(\w+)\s*=\s*(\w+)(?:\.(\w+))?\s*(\(?.*)/;
          const otherFieldMatch = line.match(otherFieldRegex);

          if (otherFieldMatch) {
            // Si estábamos procesando un campo anterior, añadirlo al modelo
            if (currentFieldName && currentFieldType) {
              currentModel.fields!.push({
                name: currentFieldName,
                fieldType: currentFieldType,
                lineNumber: currentFieldLine
              });
            }

            // Iniciar el seguimiento de un nuevo campo
            currentFieldName = otherFieldMatch[1];
            // El tipo de campo puede ser con o sin prefijo
            currentFieldType = otherFieldMatch[3] || otherFieldMatch[2];
            currentFieldLine = i;

            // Contar paréntesis abiertos y cerrados en esta línea
            const openParens = (otherFieldMatch[4].match(/\(/g) || []).length;
            const closeParens = (otherFieldMatch[4].match(/\)/g) || []).length;
            parenthesesCount = openParens - closeParens;

            // Si los paréntesis están equilibrados, el campo está completo en esta línea
            if (parenthesesCount === 0) {
              currentModel.fields!.push({
                name: currentFieldName,
                fieldType: currentFieldType,
                lineNumber: currentFieldLine
              });
              currentFieldName = '';
              currentFieldType = '';
            }
          }
        }
      }

      // Añadir el último campo si existe
      if (currentFieldName && currentFieldType && currentModel) {
        currentModel.fields!.push({
          name: currentFieldName,
          fieldType: currentFieldType,
          lineNumber: currentFieldLine
        });
      }

      // Añadir el último modelo si existe
      if (currentModel) {
        models.push(currentModel);
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
      const content = this.stripComments(await readFile(viewsPath, 'utf8'));
      const lines = content.split('\n');

      // Expresión regular para encontrar funciones de vista
      const functionViewRegex = /^def\s+(\w+)\s*\(/;
      // Clase de vista, capturando las clases base para distinguir DRF.
      const classViewRegex = /^class\s+(\w+)\s*\(([^)]*)\)?/;

      for (let i = 0; i < lines.length; i++) {
        const functionMatch = lines[i].match(functionViewRegex);
        if (functionMatch) {
          views.push({
            name: functionMatch[1],
            lineNumber: i,
            isClass: false
          });
          continue;
        }

        const classMatch = lines[i].match(classViewRegex);
        if (classMatch) {
          // Clasificar como DRF según la clase base: *ViewSet (routers) o
          // *APIView / *GenericAPIView (APIView y vistas genéricas).
          const bases = (classMatch[2] || '')
            .split(',')
            .map(b => (b.trim().split('.').pop() || '').trim());
          let apiKind: 'viewset' | 'apiview' | undefined;
          if (bases.some(b => /ViewSet$/.test(b))) {
            apiKind = 'viewset';
          } else if (bases.some(b => /APIView$/.test(b))) {
            apiKind = 'apiview';
          }

          views.push({
            name: classMatch[1],
            lineNumber: i,
            isClass: true,
            apiKind
          });
        }
      }
    } catch (error) {
      reportError('Error al analizar vistas', error);
    }

    return views;
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
      const content = this.stripComments(await readFile(urlsPath, 'utf8'));
      const lines = content.split('\n');

      // Expresiones regulares para encontrar patrones de URL
      // `r?` admite raw strings (r'...'/r"...") en re_path()/url() (caso #9).
      // `[^'"]*` admite el patron vacio de la raiz del sitio: path('').
      const pathRegex = /path\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      const rePathRegex = /re_path\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      const urlRegex = /url\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*(\w+(?:\.\w+)*)/;

      // Expresión regular para encontrar includes
      const includeRegex = /include\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/;

      // Routers DRF: router.register(r'prefix', SomeViewSet[, ...]) (caso DRF/#12).
      const routerRegex = /\brouter\.register\s*\(\s*r?['"]([^'"]*)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      // Detecta el inicio de una llamada path()/re_path()/url() para unir continuaciones.
      const urlCallStartRegex = /\b(?:re_path|path|url)\s*\(/;

      for (let i = 0; i < lines.length; i++) {
        // Unir continuaciones cuando una llamada path()/re_path()/url() abre
        // paréntesis sin cerrarlos en la misma línea (definiciones multilínea).
        let logicalLine = lines[i];
        const startLine = i;
        if (urlCallStartRegex.test(logicalLine)) {
          let parenDepth =
            (logicalLine.match(/\(/g) || []).length - (logicalLine.match(/\)/g) || []).length;
          let j = i;
          while (parenDepth > 0 && j + 1 < lines.length) {
            j++;
            logicalLine += ' ' + lines[j].trim();
            parenDepth +=
              (lines[j].match(/\(/g) || []).length - (lines[j].match(/\)/g) || []).length;
          }
          i = j; // saltar las líneas ya consumidas
        }

        // Buscar patrones de URL directos
        let match = logicalLine.match(pathRegex) || logicalLine.match(rePathRegex) || logicalLine.match(urlRegex);
        if (match) {
          const pattern = prefix + match[1];
          urls.push({
            pattern: pattern,
            viewName: match[2],
            lineNumber: startLine
          });
          continue;
        }

        // Buscar registros de routers DRF (router.register).
        const routerMatch = logicalLine.match(routerRegex);
        if (routerMatch) {
          urls.push({
            pattern: prefix + routerMatch[1],
            viewName: routerMatch[2],
            lineNumber: startLine
          });
          continue;
        }

        // Buscar includes
        const includeMatch = logicalLine.match(includeRegex);
        if (includeMatch) {
          const includedModule = includeMatch[1];
          const includePrefix = includeMatch[2] || '';

          // Determinar la ruta del archivo incluido
          let includedFilePath = '';
          if (includedModule.endsWith('.urls')) {
            // Convertir formato de módulo a ruta de archivo
            const parts = includedModule.split('.');
            const appName = parts[0];

            // Buscar la aplicación en el proyecto
            const projectRoot = path.dirname(path.dirname(urlsPath));
            const appPath = path.resolve(projectRoot, appName);

            // Evitar path traversal: el nombre de app viene de include('...') en
            // un archivo analizado, así que se exige que la ruta resuelta quede
            // dentro del proyecto (descarta '..', rutas absolutas, etc.).
            const withinProject =
              appPath === projectRoot || appPath.startsWith(projectRoot + path.sep);

            if (withinProject && await pathExists(appPath)) {
              includedFilePath = path.join(appPath, 'urls.py');
            }
          }

          if (includedFilePath && await pathExists(includedFilePath)) {
            // Combinar prefijos
            const newPrefix = prefix + (includePrefix ? includePrefix : '');

            // Extraer URLs del archivo incluido con el prefijo actualizado
            const includedUrls = await this.extractUrls(includedFilePath, newPrefix, visited);
            urls.push(...includedUrls);
          }
        }
      }
    } catch (error) {
      reportError('Error al analizar URLs', error);
    }

    return urls;
  }

  /**
   * Extrae las clases de admin de un archivo admin.py
   */
  async extractAdminClasses(adminPath: string): Promise<DjangoAdminClass[]> {
    const adminClasses: DjangoAdminClass[] = [];

    try {
      const content = this.stripComments(await readFile(adminPath, 'utf8'));
      const lineOf = (index: number): number =>
        content.substring(0, index).split('\n').length - 1;

      // Clases ya asociadas a un modelo vía decorador, para no duplicarlas
      // en el escaneo de clases.
      const decoratedClasses = new Set<string>();

      // Decoradores @admin.register(A, B, ...): admite varios modelos y
      // decoradores apilados antes de la clase (se busca la primera `class` posterior).
      const decoratorRegex = /@admin\.register\s*\(([^)]*)\)/g;
      let decoratorMatch: RegExpExecArray | null;
      while ((decoratorMatch = decoratorRegex.exec(content)) !== null) {
        const models = decoratorMatch[1]
          .split(',')
          .map(m => m.trim())
          .filter(Boolean);
        const classAfter = content.substring(decoratorMatch.index).match(/\bclass\s+(\w+)\s*\(/);
        if (classAfter && models.length > 0) {
          decoratedClasses.add(classAfter[1]);
          adminClasses.push({
            name: classAfter[1],
            lineNumber: lineOf(decoratorMatch.index),
            modelName: models.join(', ')
          });
        }
      }

      // Clases de admin declaradas: ModelAdmin, inlines o herencia custom (*Admin).
      const classRegex = /class\s+(\w+)\s*\(\s*([\w.]+)\s*\)/g;
      let classMatch: RegExpExecArray | null;
      while ((classMatch = classRegex.exec(content)) !== null) {
        const className = classMatch[1];
        const baseName = classMatch[2].split('.').pop() || classMatch[2];
        const isAdminBase =
          /Admin$/.test(baseName) ||
          baseName === 'TabularInline' ||
          baseName === 'StackedInline';
        if (!isAdminBase || decoratedClasses.has(className)) {
          continue;
        }

        // Buscar `model = X` SOLO dentro del cuerpo de esta clase (hasta el
        // siguiente `class` en columna 0 o el final del archivo), no en todo el resto.
        const restAfter = content.substring(classMatch.index + classMatch[0].length);
        const nextClass = restAfter.search(/\nclass\s/);
        const body = nextClass >= 0 ? restAfter.substring(0, nextClass) : restAfter;
        const modelMatch = body.match(/\bmodel\s*=\s*(\w+)/);

        adminClasses.push({
          name: className,
          lineNumber: lineOf(classMatch.index),
          modelName: modelMatch ? modelMatch[1] : ''
        });
      }

      // Registros directos: admin.site.register(Model, AdminClass?).
      const registerRegex = /admin\.site\.register\s*\(\s*(\w+)(?:\s*,\s*(\w+))?\s*\)/g;
      let registerMatch: RegExpExecArray | null;
      while ((registerMatch = registerRegex.exec(content)) !== null) {
        adminClasses.push({
          name: registerMatch[2] || 'ModelAdmin',
          lineNumber: lineOf(registerMatch.index),
          modelName: registerMatch[1]
        });
      }

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
      // stripComments neutraliza comentarios (`#` y bloques `"""`) respetando las
      // cadenas, así que aquí ya no hace falta recortar comentarios a mano.
      const content = this.stripComments(await readFile(settingsPath, 'utf8'));
      const lines = content.split('\n');

      // Expresión regular para encontrar definiciones de variables
      const settingRegex = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Ignorar líneas vacías (los comentarios ya quedaron en blanco).
        if (line === '') {
          continue;
        }

        const match = line.match(settingRegex);
        if (match) {
          const startLine = i; // línea donde se declara el nombre del setting
          let value = match[2].trim();

          // Manejar valores multilínea contando el BALANCE de brackets (corchetes,
          // llaves y paréntesis). Antes se cortaba en el primer cierre encontrado, lo
          // que rompía estructuras anidadas como DATABASES = { "default": { ... } }.
          const countOpen = (s: string): number => (s.match(/[[{(]/g) || []).length;
          const countClose = (s: string): number => (s.match(/[\]})]/g) || []).length;
          let depth = countOpen(value) - countClose(value);

          if (depth > 0) {
            let j = i + 1;
            let multilineValue = value;

            while (j < lines.length && depth > 0) {
              const nextLine = lines[j].trim();
              multilineValue += ' ' + nextLine;
              depth += countOpen(nextLine) - countClose(nextLine);
              j++;
            }

            value = multilineValue;
            // Avanzar el índice para no re-escanear las líneas de continuación
            // ya consumidas (evita settings fantasma y trabajo duplicado).
            i = j - 1;
          }

          settings.push({
            name: match[1],
            value: value,
            lineNumber: startLine
          });
        }
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
      const content = this.stripComments(await readFile(tasksPath, 'utf8'));
      const lines = content.split('\n');

      // Nombres de decorador que corresponden a django.tasks.task (con o sin alias).
      const taskDecorators = new Set<string>();
      for (const raw of lines) {
        const importMatch = raw.trim().match(/^from\s+django\.tasks\s+import\s+(.+)$/);
        if (importMatch) {
          importMatch[1].split(',').forEach(part => {
            const aliasMatch = part.trim().match(/^task(?:\s+as\s+(\w+))?$/);
            if (aliasMatch) {
              taskDecorators.add(aliasMatch[1] || 'task');
            }
          });
        }
      }

      // Sin import de django.tasks no hay nada que identificar como tarea.
      if (taskDecorators.size === 0) {
        return tasks;
      }

      const decoratorRegex = /^@(\w+)\b/;
      const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;
      let pending = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        const decoratorMatch = line.match(decoratorRegex);
        if (decoratorMatch) {
          // Los decoradores pueden apilarse (@task + @otro): basta con que uno
          // sea de django.tasks para marcar la siguiente función como tarea.
          if (taskDecorators.has(decoratorMatch[1])) {
            pending = true;
          }
          continue;
        }

        const defMatch = line.match(defRegex);
        if (defMatch) {
          if (pending) {
            tasks.push({ name: defMatch[1], lineNumber: i });
          }
          pending = false;
          continue;
        }

        // Cualquier otra línea no vacía rompe la cadena decorador→def.
        if (line !== '') {
          pending = false;
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
      const content = this.stripComments(await readFile(serializersPath, 'utf8'));
      const lines = content.split('\n');
      const classRegex = /^class\s+(\w+)\s*\(([^)]*)\)/;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(classRegex);
        if (!match) {
          continue;
        }
        const bases = match[2].split(',').map(b => (b.trim().split('.').pop() || '').trim());
        if (!bases.some(b => /Serializer$/.test(b))) {
          continue;
        }

        // Buscar `model = X` dentro del cuerpo de la clase (hasta la siguiente
        // clase en columna 0), normalmente dentro de `class Meta:`.
        let modelName: string | undefined;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^class\s/.test(lines[j])) {
            break;
          }
          const modelMatch = lines[j].match(/^\s+model\s*=\s*(\w+)/);
          if (modelMatch) {
            modelName = modelMatch[1];
            break;
          }
        }

        serializers.push({ name: match[1], lineNumber: i, modelName });
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
      const content = this.stripComments(await readFile(schemasPath, 'utf8'));
      const lines = content.split('\n');
      const classRegex = /^class\s+(\w+)\s*\(([^)]*)\)/;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(classRegex);
        if (!match) {
          continue;
        }
        const bases = match[2].split(',').map(b => (b.trim().split('.').pop() || '').trim());
        if (bases.some(b => /Schema$/.test(b))) {
          schemas.push({ name: match[1], lineNumber: i });
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
      const content = this.stripComments(await readFile(apiPath, 'utf8'));
      const lines = content.split('\n');
      const decoratorRegex = /^@(\w+)\.(get|post|put|patch|delete)\s*\(/;
      const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;

      let pendingMethod: string | null = null;
      let pendingPath = '';
      let pendingLine = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        const decoratorMatch = line.match(decoratorRegex);
        if (decoratorMatch) {
          pendingMethod = decoratorMatch[2].toUpperCase();
          const pathMatch = line.match(/['"]([^'"]*)['"]/);
          pendingPath = pathMatch ? pathMatch[1] : '';
          pendingLine = i;
          continue;
        }

        const defMatch = line.match(defRegex);
        if (defMatch && pendingMethod) {
          endpoints.push({
            method: pendingMethod,
            path: pendingPath,
            handler: defMatch[1],
            lineNumber: pendingLine,
            framework: 'ninja',
            filePath: apiPath
          });
          pendingMethod = null;
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
      const content = this.stripComments(await readFile(filePath, 'utf8'));
      const lines = content.split('\n');
      const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;

      const parseMethods = (raw: string): string[] =>
        raw.split(',').map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);

      let pending: { method: string; path: string; line: number } | null = null;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        const apiViewMatch = line.match(/^@api_view\s*\(\s*\[([^\]]*)\]/);
        if (apiViewMatch) {
          const methods = parseMethods(apiViewMatch[1]);
          pending = { method: (methods.join(', ') || 'GET').toUpperCase(), path: '', line: i };
          continue;
        }

        const actionMatch = line.match(/^@action\s*\(/);
        if (actionMatch) {
          const methodsMatch = line.match(/methods\s*=\s*\[([^\]]*)\]/);
          const methods = methodsMatch ? parseMethods(methodsMatch[1]) : [];
          const urlPathMatch = line.match(/url_path\s*=\s*['"]([^'"]*)['"]/);
          pending = {
            method: (methods.join(', ') || 'GET').toUpperCase(),
            path: urlPathMatch ? urlPathMatch[1] : '',
            line: i
          };
          continue;
        }

        const defMatch = line.match(defRegex);
        if (defMatch && pending) {
          endpoints.push({
            method: pending.method,
            path: pending.path || defMatch[1],
            handler: defMatch[1],
            lineNumber: pending.line,
            framework: 'drf',
            filePath
          });
          pending = null;
        }
      }
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
      const content = this.stripComments(await readFile(formsPath, 'utf8'));
      const lines = content.split('\n');
      const classRegex = /^class\s+(\w+)\s*\(([^)]*)\)/;

      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(classRegex);
        if (!match) {
          continue;
        }
        const bases = match[2].split(',').map(b => (b.trim().split('.').pop() || '').trim());
        if (!bases.some(b => /Form$/.test(b))) {
          continue;
        }

        let modelName: string | undefined;
        for (let j = i + 1; j < lines.length; j++) {
          if (/^class\s/.test(lines[j])) {
            break;
          }
          const modelMatch = lines[j].match(/^\s+model\s*=\s*(\w+)/);
          if (modelMatch) {
            modelName = modelMatch[1];
            break;
          }
        }

        forms.push({ name: match[1], lineNumber: i, modelName });
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
      const content = this.stripComments(await readFile(signalsPath, 'utf8'));
      const lines = content.split('\n');
      const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;
      const signalDeclRegex = /^(\w+)\s*=\s*Signal\s*\(/;
      let pendingReceiver = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (/^@receiver\b/.test(line)) {
          pendingReceiver = true;
          continue;
        }
        if (/^@/.test(line)) {
          // Otro decorador apilado: no rompe la cadena hacia el def.
          continue;
        }

        const defMatch = line.match(defRegex);
        if (defMatch) {
          if (pendingReceiver) {
            signals.push({ name: defMatch[1], lineNumber: i, kind: 'receiver' });
          }
          pendingReceiver = false;
          continue;
        }

        const signalMatch = line.match(signalDeclRegex);
        if (signalMatch) {
          signals.push({ name: signalMatch[1], lineNumber: i, kind: 'signal' });
        }

        if (line !== '') {
          pendingReceiver = false;
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
      const content = this.stripComments(await readFile(tasksPath, 'utf8'));
      const lines = content.split('\n');
      const decoratorRegex = /^@(?:shared_task|\w+\.task)\b/;
      const defRegex = /^(?:async\s+)?def\s+(\w+)\s*\(/;
      let pending = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (decoratorRegex.test(line)) {
          pending = true;
          continue;
        }
        if (/^@/.test(line)) {
          continue;
        }

        const defMatch = line.match(defRegex);
        if (defMatch) {
          if (pending) {
            tasks.push({ name: defMatch[1], lineNumber: i });
          }
          pending = false;
          continue;
        }

        if (line !== '') {
          pending = false;
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

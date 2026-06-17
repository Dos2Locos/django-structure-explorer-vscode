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
      const content = await readFile(modelsPath, 'utf8');
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
        const directImportsPattern = directImports.join('|');
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
      const content = await readFile(viewsPath, 'utf8');
      const lines = content.split('\n');

      // Expresión regular para encontrar funciones de vista
      const functionViewRegex = /^def\s+(\w+)\s*\(/;
      // Expresión regular para encontrar clases de vista
      const classViewRegex = /^class\s+(\w+)\s*\(/;

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
          views.push({
            name: classMatch[1],
            lineNumber: i,
            isClass: true
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
  async extractUrls(urlsPath: string, prefix: string = ''): Promise<DjangoUrl[]> {
    const urls: DjangoUrl[] = [];

    try {
      const content = await readFile(urlsPath, 'utf8');
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
            const appPath = path.join(projectRoot, appName);

            if (await pathExists(appPath)) {
              includedFilePath = path.join(appPath, 'urls.py');
            }
          }

          if (includedFilePath && await pathExists(includedFilePath)) {
            // Combinar prefijos
            const newPrefix = prefix + (includePrefix ? includePrefix : '');

            // Extraer URLs del archivo incluido con el prefijo actualizado
            const includedUrls = await this.extractUrls(includedFilePath, newPrefix);
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
      const content = await readFile(adminPath, 'utf8');
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
      const content = await readFile(settingsPath, 'utf8');
      const lines = content.split('\n');

      // Expresión regular para encontrar definiciones de variables
      const settingRegex = /^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Ignorar comentarios y líneas vacías
        if (line.startsWith('#') || line === '') {
          continue;
        }

        const match = line.match(settingRegex);
        if (match) {
          let value = match[2].trim();

          // Eliminar comentarios al final de la línea
          const commentIndex = value.indexOf('#');
          if (commentIndex > 0) {
            value = value.substring(0, commentIndex).trim();
          }

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
          }

          settings.push({
            name: match[1],
            value: value,
            lineNumber: i
          });
        }
      }
    } catch (error) {
      reportError('Error al analizar settings', error);
    }

    return settings;
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
      console.error(`Error al leer directorios: ${error}`);
    }

    return dirs;
  }
}

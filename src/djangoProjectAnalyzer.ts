import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';

const readFile = util.promisify(fs.readFile);
const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

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
      if (fs.existsSync(settingsPath)) {
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
      if (fs.existsSync(urlsPath)) {
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
      
      if (fs.existsSync(appsPyPath) || fs.existsSync(modelsPyPath)) {
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
          console.log(`Detectado alias para models: ${aliasMatch[1]}`);
        }
        
        // Detectar importaciones directas de tipos de campo
        const directImportMatch = line.match(/^from\s+django\.db\.models\s+import\s+(.+)$/);
        if (directImportMatch) {
          const imports = directImportMatch[1].split(',').map(i => i.trim());
          directImports.push(...imports);
          console.log(`Detectadas importaciones directas: ${imports.join(', ')}`);
        }
      }
      
      // Mantener un registro de las clases que son modelos
      const modelClasses = new Set<string>();
      
      // Primera pasada: identificar todas las clases que heredan de Model
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('class ')) {
          const classMatch = line.match(/^class\s+(\w+)\s*\(([^)]+)\)/);          
          if (classMatch) {
            const className = classMatch[1];
            const baseClasses = classMatch[2].split(',').map(c => c.trim());
            
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
            
            // Verificar si hereda de alguna clase base conocida
            if (baseClasses.some(base => modelBaseClasses.includes(base.split('.')?.pop() || base))) {
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
      let fieldStartIndentation = 0;
      let currentFieldName = '';
      let currentFieldType = '';
      let currentFieldLine = 0;
      let parenthesesCount = 0; // Para rastrear paréntesis abiertos/cerrados
      let isPropertyMethod = false; // Para rastrear si el próximo método tiene el decorador @property
      
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
          isPropertyMethod = false;
          continue;
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
        let fieldRegexPatterns = [
          // Patrón estándar: name = models.CharField(...)
          `^\\s+(\\w+)\\s*=\\s*models\\.(\\w+)\\s*\\(?(.*)`
        ];
        
        // Añadir patrón para alias: name = m.CharField(...)
        if (importAliases['models']) {
          fieldRegexPatterns.push(`^\\s+(\\w+)\\s*=\\s*${importAliases['models']}\\.(\\w+)\\s*\\(?(.*)`)
        }
        
        // Añadir patrón para importaciones directas: name = CharField(...)
        if (directImports.length > 0) {
          const directImportsPattern = directImports.join('|');
          fieldRegexPatterns.push(`^\\s+(\\w+)\\s*=\\s*(${directImportsPattern})\\s*\\(?(.*)`);
        }
        
        // Intentar cada patrón
        let fieldMatch = null;
        let matchedPattern = '';
        for (const pattern of fieldRegexPatterns) {
          const regex = new RegExp(pattern);
          const match = line.match(regex);
          if (match) {
            fieldMatch = match;
            matchedPattern = pattern;
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
          
          // Iniciar el seguimiento de un nuevo campo
          currentFieldName = fieldMatch[1];
          
          // El tipo de campo depende del patrón que coincidió
          if (matchedPattern.includes('(\\w+)\\.(\\w+)')) {
            // Patrón con prefijo (models.CharField o alias.CharField)
            currentFieldType = fieldMatch[2];
          } else {
            // Patrón de importación directa (CharField)
            currentFieldType = fieldMatch[2];
          }
          
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
          const otherFieldRegex = /^\s+(\w+)\s*=\s*(\w+)(?:\.(\w+))?\s*\(?(.*)/;
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
      
      console.log(`Modelos extraídos: ${models.length}`);
      for (const model of models) {
        console.log(`Modelo: ${model.name}, Campos: ${model.fields?.length || 0}`);
      }
      
    } catch (error) {
      console.error(`Error al analizar modelos: ${error}`);
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
      console.error(`Error al analizar vistas: ${error}`);
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
      const pathRegex = /path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      const rePathRegex = /re_path\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      const urlRegex = /url\s*\(\s*['"]([^'"]+)['"]\s*,\s*(\w+(?:\.\w+)*)/;
      
      // Expresión regular para encontrar includes
      const includeRegex = /include\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*['"]([^'"]+)['"]\s*)?\)/;
      
      for (let i = 0; i < lines.length; i++) {
        // Buscar patrones de URL directos
        let match = lines[i].match(pathRegex) || lines[i].match(rePathRegex) || lines[i].match(urlRegex);
        if (match) {
          const pattern = prefix + match[1];
          urls.push({
            pattern: pattern,
            viewName: match[2],
            lineNumber: i
          });
          continue;
        }
        
        // Buscar includes
        const includeMatch = lines[i].match(includeRegex);
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
            
            if (fs.existsSync(appPath)) {
              includedFilePath = path.join(appPath, 'urls.py');
            }
          }
          
          if (includedFilePath && fs.existsSync(includedFilePath)) {
            // Combinar prefijos
            const newPrefix = prefix + (includePrefix ? includePrefix : '');
            
            // Extraer URLs del archivo incluido con el prefijo actualizado
            const includedUrls = await this.extractUrls(includedFilePath, newPrefix);
            urls.push(...includedUrls);
          }
        }
      }
    } catch (error) {
      console.error(`Error al analizar URLs: ${error}`);
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
      
      // Buscar todas las clases de admin
      const classRegex = /class\s+(\w+)\s*\(\s*(?:admin\.)?(\w+Admin|TabularInline|StackedInline)\s*\)/g;
      let classMatch;
      while ((classMatch = classRegex.exec(content)) !== null) {
        const adminClass: DjangoAdminClass = {
          name: classMatch[1],
          lineNumber: content.substring(0, classMatch.index).split('\n').length - 1,
          modelName: ''
        };
        
        // Buscar el modelo asociado
        const modelRegex = new RegExp(`model\\s*=\\s*(\\w+)`, 'g');
        const modelContent = content.substring(classMatch.index, content.length);
        const modelMatch = modelRegex.exec(modelContent);
        if (modelMatch) {
          adminClass.modelName = modelMatch[1];
        }
        
        adminClasses.push(adminClass);
      }
      
      // Buscar registros directos con admin.site.register
      const registerRegex = /admin\.site\.register\s*\(\s*(\w+)(?:\s*,\s*(\w+))?\s*\)/g;
      let registerMatch;
      while ((registerMatch = registerRegex.exec(content)) !== null) {
        const modelName = registerMatch[1];
        const adminClassName = registerMatch[2] || 'ModelAdmin';
        
        adminClasses.push({
          name: adminClassName,
          lineNumber: content.substring(0, registerMatch.index).split('\n').length - 1,
          modelName: modelName
        });
      }
      
      // Buscar decoradores de register
      const decoratorRegex = /@admin\.register\s*\(\s*(\w+)\s*\)\s*\n+\s*class\s+(\w+)/g;
      let decoratorMatch;
      while ((decoratorMatch = decoratorRegex.exec(content)) !== null) {
        const modelName = decoratorMatch[1];
        const adminClassName = decoratorMatch[2];
        
        adminClasses.push({
          name: adminClassName,
          lineNumber: content.substring(0, decoratorMatch.index).split('\n').length - 1,
          modelName: modelName
        });
      }
      
    } catch (error) {
      console.error(`Error al analizar clases de admin: ${error}`);
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
          
          // Manejar valores multilínea
          if ((value.includes('{') && !value.includes('}')) || 
              (value.includes('[') && !value.includes(']')) ||
              (value.includes('(') && !value.includes(')'))) {
            
            // Buscar el final de la definición multilínea
            let j = i + 1;
            let multilineValue = value;
            
            while (j < lines.length) {
              const nextLine = lines[j].trim();
              multilineValue += ' ' + nextLine;
              
              if ((value.includes('{') && nextLine.includes('}')) || 
                  (value.includes('[') && nextLine.includes(']')) ||
                  (value.includes('(') && nextLine.includes(')'))) {
                break;
              }
              
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
      console.error(`Error al analizar settings: ${error}`);
    }
    
    return settings;
  }
  
  /**
   * Obtiene todos los directorios en un directorio dado
   */
  private async getDirectories(dir: string): Promise<string[]> {
    const dirs: string[] = [];
    
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('__')) {
          dirs.push(fullPath);
          
          // Recursivamente buscar en subdirectorios
          const subdirs = await this.getDirectories(fullPath);
          dirs.push(...subdirs);
        }
      }
    } catch (error) {
      console.error(`Error al leer directorios: ${error}`);
    }
    
    return dirs;
  }
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoProjectAnalyzer } from './djangoProjectAnalyzer';

export class DjangoStructureProvider implements vscode.TreeDataProvider<DjangoTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<DjangoTreeItem | undefined | null | void> = new vscode.EventEmitter<DjangoTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<DjangoTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
  
  private analyzer: DjangoProjectAnalyzer;
  private projectRoot: string | undefined;

  constructor() {
    this.analyzer = new DjangoProjectAnalyzer();
    this.projectRoot = this.findDjangoProjectRoot();
  }

  refresh(): void {
    this.projectRoot = this.findDjangoProjectRoot();
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DjangoTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    if (!this.projectRoot) {
      return Promise.resolve([]);
    }

    // Depurar el elemento actual
    if (element) {
      console.log('Tipo de elemento:', element.contextValue);
      console.log('Etiqueta:', element.label);
      console.log('Tiene campos:', (element as any).modelFields ? 'Sí' : 'No');
    }

    if (!element) {
      // Nivel raíz - mostrar la estructura principal del proyecto
      return this.getProjectStructure();
    } else if (element.contextValue === 'app') {
      // Nivel de aplicación - mostrar modelos, vistas, etc.
      return this.getAppStructure(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'models') {
      // Mostrar los modelos de la aplicación
      return this.getModels(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'views') {
      // Mostrar las vistas de la aplicación
      return this.getViews(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'urls') {
      // Mostrar las URLs de la aplicación
      return this.getUrls(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'admin') {
      // Mostrar las clases de admin de la aplicación
      return this.getAdminClasses(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'main-urls') {
      // Mostrar las URLs globales del proyecto
      return this.getUrls(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'settings') {
      // Mostrar las variables definidas en settings.py
      return this.getSettings(element.resourceUri!.fsPath);
    } else if (element.contextValue === 'model') {
      // Mostrar los campos de un modelo
      console.log('Procesando modelo para mostrar campos');
      return this.getModelFields(element);
    }
    
    console.log('No se encontró un manejador para el tipo:', element?.contextValue);
    return [];
  }

  private findDjangoProjectRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }

    for (const folder of workspaceFolders) {
      const managePyPath = path.join(folder.uri.fsPath, 'manage.py');
      if (fs.existsSync(managePyPath)) {
        return folder.uri.fsPath;
      }
    }

    return undefined;
  }

  private async getProjectStructure(): Promise<DjangoTreeItem[]> {
    if (!this.projectRoot) {
      return [];
    }

    const items: DjangoTreeItem[] = [];

    // Añadir settings
    const settingsFiles = await this.analyzer.findSettingsFiles(this.projectRoot);
    if (settingsFiles.length > 0) {
      const settingsItem = new DjangoTreeItem(
        'Settings',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Settings',
          arguments: [settingsFiles[0]]
        },
        vscode.Uri.file(path.dirname(settingsFiles[0])),
        'settings'
      );
      settingsItem.iconPath = new vscode.ThemeIcon('settings-gear');
      items.push(settingsItem);
    }

    // Añadir urls.py principal
    const mainUrlsFile = await this.analyzer.findMainUrlsFile(this.projectRoot);
    if (mainUrlsFile) {
      const urlsItem = new DjangoTreeItem(
        'URLs',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir URLs',
          arguments: [mainUrlsFile]
        },
        vscode.Uri.file(mainUrlsFile),
        'main-urls'
      );
      urlsItem.iconPath = new vscode.ThemeIcon('link');
      items.push(urlsItem);
    }

    // Añadir aplicaciones
    const apps = await this.analyzer.findDjangoApps(this.projectRoot);
    for (const app of apps) {
      const appName = path.basename(app);
      const appItem = new DjangoTreeItem(
        appName,
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        vscode.Uri.file(app),
        'app'
      );
      appItem.iconPath = new vscode.ThemeIcon('package');
      items.push(appItem);
    }

    return items;
  }

  private async getAppStructure(appPath: string): Promise<DjangoTreeItem[]> {
    const items: DjangoTreeItem[] = [];
    const appName = path.basename(appPath);

    // Modelos
    const modelsPath = path.join(appPath, 'models.py');
    if (fs.existsSync(modelsPath)) {
      const modelsItem = new DjangoTreeItem(
        'Modelos',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Modelos',
          arguments: [modelsPath]
        },
        vscode.Uri.file(modelsPath),
        'models'
      );
      modelsItem.iconPath = new vscode.ThemeIcon('database');
      items.push(modelsItem);
    }

    // Vistas
    const viewsPath = path.join(appPath, 'views.py');
    if (fs.existsSync(viewsPath)) {
      const viewsItem = new DjangoTreeItem(
        'Vistas',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Vistas',
          arguments: [viewsPath]
        },
        vscode.Uri.file(viewsPath),
        'views'
      );
      viewsItem.iconPath = new vscode.ThemeIcon('eye');
      items.push(viewsItem);
    }

    // URLs
    const urlsPath = path.join(appPath, 'urls.py');
    if (fs.existsSync(urlsPath)) {
      const urlsItem = new DjangoTreeItem(
        'URLs',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir URLs',
          arguments: [urlsPath]
        },
        vscode.Uri.file(urlsPath),
        'urls'
      );
      urlsItem.iconPath = new vscode.ThemeIcon('link');
      items.push(urlsItem);
    }

    // Admin
    const adminPath = path.join(appPath, 'admin.py');
    if (fs.existsSync(adminPath)) {
      const adminItem = new DjangoTreeItem(
        'Admin',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Admin',
          arguments: [adminPath]
        },
        vscode.Uri.file(adminPath),
        'admin'
      );
      adminItem.iconPath = new vscode.ThemeIcon('shield');
      items.push(adminItem);
    }

    return items;
  }

  private async getModels(modelsPath: string): Promise<DjangoTreeItem[]> {
    const models = await this.analyzer.extractModels(modelsPath);
    console.log('Modelos encontrados:', models.length);
    
    return models.map(model => {
      console.log(`Modelo: ${model.name}, Campos: ${model.fields?.length || 0}`);
      if (model.fields) {
        console.log('Campos del modelo:', JSON.stringify(model.fields));
      }
      
      // Crear una copia de los campos para evitar problemas de referencia
      const fieldsData = model.fields ? [...model.fields] : [];
      
      const modelItem = new DjangoTreeItem(
        model.name,
        fieldsData.length > 0 
          ? vscode.TreeItemCollapsibleState.Collapsed 
          : vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Modelo',
          arguments: [modelsPath, model.lineNumber]
        },
        vscode.Uri.file(modelsPath),
        'model'
      );
      modelItem.iconPath = new vscode.ThemeIcon('symbol-class');
      
      // Almacenar los campos del modelo en el elemento para acceder a ellos más tarde
      modelItem.tooltip = `Modelo: ${model.name}`;
      modelItem.description = `${fieldsData.length} campos`;
      
      // No podemos modificar command directamente porque es de solo lectura
      // En su lugar, almacenamos los campos como datos personalizados
      
      // También guardar en una propiedad personalizada para mayor seguridad
      (modelItem as any).modelFields = fieldsData;
      
      return modelItem;
    });
  }

  private async getViews(viewsPath: string): Promise<DjangoTreeItem[]> {
    const views = await this.analyzer.extractViews(viewsPath);
    return views.map(view => {
      const viewItem = new DjangoTreeItem(
        view.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Vista',
          arguments: [viewsPath, view.lineNumber]
        },
        vscode.Uri.file(viewsPath),
        'view'
      );
      viewItem.iconPath = view.isClass 
        ? new vscode.ThemeIcon('symbol-class') 
        : new vscode.ThemeIcon('symbol-method');
      return viewItem;
    });
  }

  private async getUrls(urlsPath: string): Promise<DjangoTreeItem[]> {
    const urls = await this.analyzer.extractUrls(urlsPath);
    return urls.map(url => {
      const urlItem = new DjangoTreeItem(
        url.pattern,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir URL',
          arguments: [urlsPath, url.lineNumber]
        },
        vscode.Uri.file(urlsPath),
        'url'
      );
      urlItem.description = url.viewName;
      urlItem.iconPath = new vscode.ThemeIcon('link');
      return urlItem;
    });
  }

  private async getAdminClasses(adminPath: string): Promise<DjangoTreeItem[]> {
    const adminClasses = await this.analyzer.extractAdminClasses(adminPath);
    return adminClasses.map(adminClass => {
      const adminItem = new DjangoTreeItem(
        adminClass.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Clase Admin',
          arguments: [adminPath, adminClass.lineNumber]
        },
        vscode.Uri.file(adminPath),
        'admin-class'
      );
      adminItem.iconPath = new vscode.ThemeIcon('symbol-class');
      return adminItem;
    });
  }

  private async getSettings(settingsDir: string): Promise<DjangoTreeItem[]> {
    const settingsFiles = await this.analyzer.findSettingsFiles(this.projectRoot!);
    if (settingsFiles.length === 0) {
      return [];
    }
    
    const settingsPath = settingsFiles[0];
    const settings = await this.analyzer.extractSettings(settingsPath);
    
    return settings.map(setting => {
      const settingItem = new DjangoTreeItem(
        setting.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Setting',
          arguments: [settingsPath, setting.lineNumber]
        },
        vscode.Uri.file(settingsPath),
        'setting'
      );
      settingItem.description = setting.value;
      settingItem.iconPath = new vscode.ThemeIcon('symbol-constant');
      return settingItem;
    });
  }

  private async getModelFields(modelItem: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    // Recuperar los campos del modelo almacenados en el elemento
    const fields = (modelItem as any).modelFields || [];
    const modelsPath = modelItem.resourceUri!.fsPath;
    
    console.log('Modelo:', modelItem.label);
    console.log('Campos encontrados:', fields.length);
    console.log('Campos:', JSON.stringify(fields));
    
    // Si no hay campos, intentar obtenerlos de nuevo
    if (fields.length === 0) {
      console.log('No se encontraron campos almacenados, intentando obtenerlos de nuevo');
      try {
        // Intentar extraer el modelo de nuevo para obtener sus campos
        const models = await this.analyzer.extractModels(modelsPath);
        const modelName = modelItem.label?.toString() || '';
        const model = models.find(m => m.name === modelName);
        
        if (model && model.fields && model.fields.length > 0) {
          console.log(`Se encontraron ${model.fields.length} campos para el modelo ${modelName}`);
          // Actualizar los campos en el elemento
          (modelItem as any).modelFields = model.fields;
          return this.getModelFields(modelItem); // Llamada recursiva con los campos actualizados
        }
      } catch (error) {
        console.error('Error al intentar obtener campos del modelo:', error);
      }
    }
    
    return fields.map((field: any) => {
      console.log(`Creando elemento para el campo: ${field.name}, tipo: ${field.fieldType || field.type}, isProperty: ${field.isProperty}`);
      const fieldItem = new DjangoTreeItem(
        field.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Abrir Campo',
          arguments: [modelsPath, field.lineNumber]
        },
        vscode.Uri.file(modelsPath),
        field.isProperty ? 'model-property' : 'model-field'
      );
      
      // Usar un icono diferente para propiedades
      if (field.isProperty) {
        fieldItem.iconPath = new vscode.ThemeIcon('symbol-method');
      } else {
        fieldItem.iconPath = new vscode.ThemeIcon('symbol-field');
      }
      
      // Usar fieldType o type, dependiendo de cuál esté disponible
      fieldItem.description = field.fieldType || field.type || 'Unknown';
      fieldItem.tooltip = `${field.isProperty ? 'Propiedad' : 'Campo'}: ${field.name}\nTipo: ${field.fieldType || field.type || 'Unknown'}`;
      return fieldItem;
    });
  }
}

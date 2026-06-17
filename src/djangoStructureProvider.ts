import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoProjectAnalyzer, ModelField } from './djangoProjectAnalyzer';

/**
 * Comprueba de forma asíncrona si una ruta existe, sin bloquear el event loop.
 */
async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

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
    try {
      return await this.getChildrenInternal(element);
    } catch (error) {
      // Red de seguridad: cualquier fallo inesperado deja el árbol vacío pero
      // avisa al usuario, en vez de romper el TreeDataProvider en silencio.
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[DjangoStructureExplorer] Error en getChildren: ${message}`);
      vscode.window.showErrorMessage(`Django Structure Explorer: error inesperado. ${message}`);
      return [];
    }
  }

  private async getChildrenInternal(element?: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    // Capturar projectRoot en local: refresh() puede reasignarlo a mitad de una
    // llamada async, así que se usa una referencia estable durante todo el método.
    const projectRoot = this.projectRoot;
    if (!projectRoot) {
      return [];
    }

    if (!element) {
      // Root level - show main project structure
      return this.getProjectStructure();
    }

    if (element.contextValue === 'config') {
      // Configuration group - show settings and main URLs
      const items: DjangoTreeItem[] = [];

      // Add settings
      const settingsFiles = await this.analyzer.findSettingsFiles(projectRoot);
      if (settingsFiles.length > 0) {
        const settingsItem = new DjangoTreeItem(
          'Settings',
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            command: 'djangoStructureExplorer.openFile',
            title: 'Open Settings',
            arguments: [settingsFiles[0]]
          },
          vscode.Uri.file(path.dirname(settingsFiles[0])),
          'settings'
        );
        settingsItem.iconPath = new vscode.ThemeIcon('settings-gear');
        items.push(settingsItem);
      }

      // Add main urls.py
      const mainUrlsFile = await this.analyzer.findMainUrlsFile(projectRoot);
      if (mainUrlsFile) {
        const urlsItem = new DjangoTreeItem(
          'URLs',
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            command: 'djangoStructureExplorer.openFile',
            title: 'Open URLs',
            arguments: [mainUrlsFile]
          },
          vscode.Uri.file(mainUrlsFile),
          'main-urls'
        );
        urlsItem.iconPath = new vscode.ThemeIcon('link');
        items.push(urlsItem);
      }

      return items;
    }

    if (element.contextValue === 'apps') {
      // Applications group - show all apps
      const apps = await this.analyzer.findDjangoApps(projectRoot);
      return Promise.all(apps.map(app => {
        const appName = path.basename(app);
        const appItem = new DjangoTreeItem(
          appName,
          vscode.TreeItemCollapsibleState.Collapsed,
          undefined,
          vscode.Uri.file(app),
          'app'
        );
        appItem.iconPath = new vscode.ThemeIcon('package');
        return appItem;
      }));
    }

    // Las ramas restantes requieren un resourceUri asociado.
    // Guardamos contra resourceUri ausente en lugar de usar aserciones non-null.
    const uriContexts = ['app', 'models', 'views', 'urls', 'admin', 'main-urls', 'settings'];
    if (uriContexts.includes(element.contextValue ?? '')) {
      if (!element.resourceUri) {
        return [];
      }
      const fsPath = element.resourceUri.fsPath;
      switch (element.contextValue) {
        case 'app':
          return this.getAppStructure(fsPath);
        case 'models':
          return this.getModels(fsPath);
        case 'views':
          return this.getViews(fsPath);
        case 'urls':
        case 'main-urls':
          return this.getUrls(fsPath);
        case 'admin':
          return this.getAdminClasses(fsPath);
        case 'settings':
          return this.getSettings(fsPath);
      }
    }

    if (element.contextValue === 'model') {
      return this.getModelFields(element);
    }

    return [];
  }

  private findDjangoProjectRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return undefined;
    }

    // Chequeo síncrono acotado al número de raíces del workspace (habitualmente 1).
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

    // Add configuration files group
    const configItem = new DjangoTreeItem(
      'Configuration',
      vscode.TreeItemCollapsibleState.Expanded,  // Mostrar expandido por defecto
      undefined,
      undefined,
      'config'
    );
    configItem.iconPath = new vscode.ThemeIcon('gear');
    items.push(configItem);

    // Add applications group
    const appsItem = new DjangoTreeItem(
      'Applications',
      vscode.TreeItemCollapsibleState.Expanded,  // Mostrar expandido por defecto
      undefined,
      undefined,
      'apps'
    );
    appsItem.iconPath = new vscode.ThemeIcon('layers');
    items.push(appsItem);

    // Los grupos raíz (Configuration, Applications) se devuelven en orden fijo
    // e intencional; no se ordenan con el comparador de datos de usuario.
    return items;
  }

  private sortItems(items: DjangoTreeItem[]): DjangoTreeItem[] {
    const sortOrder = vscode.workspace.getConfiguration('djangoStructureExplorer').get('sortOrder', 'alphabetical');

    if (sortOrder === 'alphabetical') {
      return items.sort((a, b) => a.label.toString().localeCompare(b.label.toString()));
    } else if (sortOrder === 'alphabeticalDesc') {
      return items.sort((a, b) => b.label.toString().localeCompare(a.label.toString()));
    }

    return items; // codeOrder - mantener el orden original
  }

  private async getAppStructure(appPath: string): Promise<DjangoTreeItem[]> {
    const items: DjangoTreeItem[] = [];

    // Models
    const modelsPath = path.join(appPath, 'models.py');
    if (await pathExists(modelsPath)) {
      const modelsItem = new DjangoTreeItem(
        'Models',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Models',
          arguments: [modelsPath]
        },
        vscode.Uri.file(modelsPath),
        'models'
      );
      modelsItem.iconPath = new vscode.ThemeIcon('database');
      items.push(modelsItem);
    }

    // Views
    const viewsPath = path.join(appPath, 'views.py');
    if (await pathExists(viewsPath)) {
      const viewsItem = new DjangoTreeItem(
        'Views',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Views',
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
    if (await pathExists(urlsPath)) {
      const urlsItem = new DjangoTreeItem(
        'URLs',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open URLs',
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
    if (await pathExists(adminPath)) {
      const adminItem = new DjangoTreeItem(
        'Admin',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Admin',
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

    const items = models.map(model => {
      // Create a copy of fields to avoid reference issues
      const fieldsData = model.fields ? [...model.fields] : [];

      const modelItem = new DjangoTreeItem(
        model.name,
        fieldsData.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Model',
          arguments: [modelsPath, model.lineNumber]
        },
        vscode.Uri.file(modelsPath),
        'model'
      );
      modelItem.iconPath = new vscode.ThemeIcon('symbol-class');

      modelItem.tooltip = `Model: ${model.name}`;
      modelItem.description = `${fieldsData.length} fields`;

      // Almacenar los campos del modelo de forma tipada para acceso posterior
      modelItem.modelFields = fieldsData;

      return modelItem;
    });

    return this.sortItems(items);
  }

  private async getViews(viewsPath: string): Promise<DjangoTreeItem[]> {
    const views = await this.analyzer.extractViews(viewsPath);
    const items = views.map(view => {
      const viewItem = new DjangoTreeItem(
        view.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open View',
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

    return this.sortItems(items);
  }

  private async getUrls(urlsPath: string): Promise<DjangoTreeItem[]> {
    const urls = await this.analyzer.extractUrls(urlsPath);
    const items = urls.map(url => {
      const urlItem = new DjangoTreeItem(
        url.pattern,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open URL',
          arguments: [urlsPath, url.lineNumber]
        },
        vscode.Uri.file(urlsPath),
        'url'
      );
      urlItem.description = url.viewName;
      urlItem.iconPath = new vscode.ThemeIcon('link');
      return urlItem;
    });

    return this.sortItems(items);
  }

  private async getAdminClasses(adminPath: string): Promise<DjangoTreeItem[]> {
    const adminClasses = await this.analyzer.extractAdminClasses(adminPath);
    const items = adminClasses.map(adminClass => {
      const adminItem = new DjangoTreeItem(
        adminClass.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Admin Class',
          arguments: [adminPath, adminClass.lineNumber]
        },
        vscode.Uri.file(adminPath),
        'admin-class'
      );
      adminItem.iconPath = new vscode.ThemeIcon('symbol-class');
      return adminItem;
    });

    return this.sortItems(items);
  }

  private async getSettings(settingsDir: string): Promise<DjangoTreeItem[]> {
    if (!this.projectRoot) {
      return [];
    }

    const settingsFiles = await this.analyzer.findSettingsFiles(this.projectRoot);
    if (settingsFiles.length === 0) {
      return [];
    }

    const settingsPath = settingsFiles[0];
    const settings = await this.analyzer.extractSettings(settingsPath);

    const items = settings.map(setting => {
      const settingItem = new DjangoTreeItem(
        setting.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Setting',
          arguments: [settingsPath, setting.lineNumber]
        },
        vscode.Uri.file(settingsPath),
        'setting'
      );
      settingItem.description = setting.value;
      settingItem.iconPath = new vscode.ThemeIcon('symbol-constant');
      return settingItem;
    });

    return this.sortItems(items);
  }

  private async getModelFields(modelItem: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    if (!modelItem.resourceUri) {
      return [];
    }
    const modelsPath = modelItem.resourceUri.fsPath;

    // Campos almacenados de forma tipada en el item del árbol
    let fields: ModelField[] = modelItem.modelFields ?? [];

    // Si no hay campos, intentar extraerlos de nuevo (una sola vez)
    if (fields.length === 0) {
      const models = await this.analyzer.extractModels(modelsPath);
      const modelName = modelItem.label?.toString() || '';
      const model = models.find(m => m.name === modelName);

      if (model && model.fields && model.fields.length > 0) {
        modelItem.modelFields = model.fields;
        fields = model.fields;
      }
    }

    return fields.map((field) => {
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

      fieldItem.description = field.fieldType || 'Unknown';
      fieldItem.tooltip = `${field.isProperty ? 'Propiedad' : 'Campo'}: ${field.name}\nTipo: ${field.fieldType || 'Unknown'}`;
      return fieldItem;
    });
  }
}

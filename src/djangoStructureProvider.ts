import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoProjectAnalyzer, ModelField, DjangoApiEndpoint, DEFAULT_EXCLUDED_DIRS } from './djangoProjectAnalyzer';

/**
 * Busca, en anchura y con profundidad acotada, el primer directorio que contenga
 * manage.py por debajo de `start`. Recorre en BFS porque la raíz del proyecto
 * suele estar a uno o dos niveles, y omite directorios pesados (dependencias,
 * entornos virtuales, cachés, ocultos) para no congelar VS Code en proyectos
 * grandes. Es síncrono a propósito: se invoca desde el constructor y refresh().
 *
 * Función de módulo (sin dependencias de VS Code) para poder probarla de forma
 * aislada con fixtures de disco.
 */
export function findManagePyDir(start: string, maxDepth = 4): string | undefined {
  let frontier: string[] = [start];

  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];

    for (const dir of frontier) {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        // Directorios sin permisos: se omiten sin interrumpir la búsqueda.
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (
          entry.name.startsWith('.') ||
          entry.name.startsWith('__') ||
          DEFAULT_EXCLUDED_DIRS.has(entry.name)
        ) {
          continue;
        }

        const childDir = path.join(dir, entry.name);
        if (fs.existsSync(path.join(childDir, 'manage.py'))) {
          return childDir;
        }
        next.push(childDir);
      }
    }

    frontier = next;
  }

  return undefined;
}

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
  /** Texto de filtro aplicado a los items hoja del árbol (Fase D). */
  private filterText = '';

  constructor() {
    this.analyzer = new DjangoProjectAnalyzer();
    this.projectRoot = this.findDjangoProjectRoot();
  }

  refresh(): void {
    this.projectRoot = this.findDjangoProjectRoot();
    this._onDidChangeTreeData.fire();
  }

  /** Raíz del proyecto Django (carpeta con manage.py), si la hay. */
  getProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  /** Filtro activo actual (cadena vacía si no hay filtro). */
  get currentFilter(): string {
    return this.filterText;
  }

  /**
   * Fija (o limpia) el filtro de items hoja y refresca el árbol. El filtro
   * se aplica por subcadena (sin distinguir mayúsculas) sobre las etiquetas
   * de los hijos de cada nodo; los nodos contenedores no se filtran.
   */
  setFilter(text: string): void {
    this.filterText = text.trim();
    vscode.commands.executeCommand(
      'setContext',
      'djangoStructureExplorer.filterActive',
      this.filterText.length > 0
    );
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
      // Registrar el error completo (con `stack`) para ver el stacktrace en la
      // consola de Developer Tools; el mensaje breve va al aviso al usuario.
      console.error('[DjangoStructureExplorer] Error en getChildren:', error);
      vscode.window.showErrorMessage(`Django Structure Explorer: error inesperado. ${message}`);
      return [];
    }
  }

  private async getChildrenInternal(element?: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    // Capturar projectRoot en local: refresh() puede reasignarlo a mitad de una
    // llamada async, así que se usa una referencia estable durante todo el método.
    const projectRoot = this.projectRoot;
    if (!projectRoot) {
      // No se encontró manage.py: el workspace no es un proyecto Django. En vez
      // de un árbol vacío y silencioso, en el nivel raíz se muestra un item
      // informativo que orienta al usuario (las ramas hijas no aplican).
      if (element) {
        return [];
      }
      const emptyItem = new DjangoTreeItem(
        'No se detectó un proyecto Django',
        vscode.TreeItemCollapsibleState.None,
        undefined,
        undefined,
        'empty'
      );
      emptyItem.description = 'no se encontró manage.py';
      emptyItem.tooltip =
        'No se encontró ningún manage.py en el workspace. Abre una carpeta que ' +
        'contenga manage.py (también se detecta en subcarpetas como backend/ o src/) ' +
        'y usa el botón de recargar.';
      emptyItem.iconPath = new vscode.ThemeIcon('info');
      return [emptyItem];
    }

    // Afina el escaneo con los patrones del .gitignore antes de listar apps,
    // settings o plantillas. Se incluyen las raíces del workspace además de la
    // del proyecto: en monorepos con proyecto anidado (manage.py en backend/) el
    // .gitignore suele vivir en la raíz del workspace, no junto al proyecto.
    // Es idempotente por conjunto de raíces, así que apenas cuesta.
    const ignoreRoots = new Set<string>([projectRoot]);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      ignoreRoots.add(folder.uri.fsPath);
    }
    await this.analyzer.loadIgnorePatterns([...ignoreRoots]);

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
    const uriContexts = ['app', 'models', 'views', 'urls', 'admin', 'main-urls', 'settings', 'tasks', 'partials', 'templates', 'serializers', 'schemas', 'api', 'forms', 'signals', 'commands', 'celery-tasks'];
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
        case 'tasks':
          return this.getTasks(fsPath);
        case 'partials':
          return this.getPartials(element);
        case 'templates':
          return this.getTemplates(fsPath);
        case 'serializers':
          return this.getSerializers(fsPath);
        case 'schemas':
          return this.getSchemas(fsPath);
        case 'api':
          return this.getApiEndpoints(element);
        case 'forms':
          return this.getForms(fsPath);
        case 'signals':
          return this.getSignals(fsPath);
        case 'commands':
          return this.getCommands(element);
        case 'celery-tasks':
          return this.getCeleryTasks(fsPath);
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
      // Caso habitual: manage.py vive en la propia raíz del workspace.
      const managePyPath = path.join(folder.uri.fsPath, 'manage.py');
      if (fs.existsSync(managePyPath)) {
        return folder.uri.fsPath;
      }
      // Caso monorepo / proyecto anidado: el workspace no es el padre directo de
      // manage.py (p. ej. backend/, src/, apps/api/). Se busca hacia abajo.
      const nested = findManagePyDir(folder.uri.fsPath);
      if (nested) {
        return nested;
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

  /**
   * Aplica el filtro activo (por subcadena en la etiqueta) y luego ordena.
   * Usar en los getters de items hoja en lugar de sortItems directamente.
   */
  private finalizeItems(items: DjangoTreeItem[]): DjangoTreeItem[] {
    if (!this.filterText) {
      return this.sortItems(items);
    }
    const needle = this.filterText.toLowerCase();
    const filtered = items.filter(item =>
      item.label.toString().toLowerCase().includes(needle)
    );
    return this.sortItems(filtered);
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

    // Tasks (framework de Tasks de Django 6)
    const tasksPath = path.join(appPath, 'tasks.py');
    if (await pathExists(tasksPath)) {
      const tasksItem = new DjangoTreeItem(
        'Tasks',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Tasks',
          arguments: [tasksPath]
        },
        vscode.Uri.file(tasksPath),
        'tasks'
      );
      tasksItem.iconPath = new vscode.ThemeIcon('checklist');
      items.push(tasksItem);
    }

    // Partials de plantilla (Django 6). Solo se añade el nodo si la app define
    // alguno; los partials encontrados se cachean en el item para no reescanear.
    const partials = await this.analyzer.findAppPartials(appPath);
    if (partials.length > 0) {
      const partialsItem = new DjangoTreeItem(
        'Partials',
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        vscode.Uri.file(appPath),
        'partials'
      );
      partialsItem.iconPath = new vscode.ThemeIcon('symbol-snippet');
      partialsItem.partials = partials;
      items.push(partialsItem);
    }

    // Templates (.html de la app)
    const templateFiles = await this.analyzer.findAppTemplates(appPath);
    if (templateFiles.length > 0) {
      const templatesItem = new DjangoTreeItem(
        'Templates',
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        vscode.Uri.file(appPath),
        'templates'
      );
      templatesItem.iconPath = new vscode.ThemeIcon('file-directory');
      items.push(templatesItem);
    }

    // Serializers de DRF (serializers.py)
    const serializersPath = path.join(appPath, 'serializers.py');
    if (await pathExists(serializersPath)) {
      const serializersItem = new DjangoTreeItem(
        'Serializers',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Serializers',
          arguments: [serializersPath]
        },
        vscode.Uri.file(serializersPath),
        'serializers'
      );
      serializersItem.iconPath = new vscode.ThemeIcon('symbol-class');
      items.push(serializersItem);
    }

    // Schemas de django-ninja (schemas.py)
    const schemasPath = path.join(appPath, 'schemas.py');
    if (await pathExists(schemasPath)) {
      const schemasItem = new DjangoTreeItem(
        'Schemas',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Schemas',
          arguments: [schemasPath]
        },
        vscode.Uri.file(schemasPath),
        'schemas'
      );
      schemasItem.iconPath = new vscode.ThemeIcon('symbol-interface');
      items.push(schemasItem);
    }

    // API REST: endpoints de django-ninja (api.py) + DRF basados en decorador
    // (@api_view/@action en views.py/viewsets.py). Los router.register() de DRF
    // ya se muestran en el nodo URLs.
    const apiEndpoints: DjangoApiEndpoint[] = [];
    const apiPath = path.join(appPath, 'api.py');
    if (await pathExists(apiPath)) {
      apiEndpoints.push(...await this.analyzer.extractNinjaEndpoints(apiPath));
    }
    for (const drfFile of ['views.py', 'viewsets.py']) {
      const drfPath = path.join(appPath, drfFile);
      if (await pathExists(drfPath)) {
        apiEndpoints.push(...await this.analyzer.extractDrfEndpoints(drfPath));
      }
    }
    if (apiEndpoints.length > 0) {
      const apiItem = new DjangoTreeItem(
        'API',
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        vscode.Uri.file(appPath),
        'api'
      );
      apiItem.iconPath = new vscode.ThemeIcon('plug');
      apiItem.apiEndpoints = apiEndpoints;
      items.push(apiItem);
    }

    // Forms (forms.py)
    const formsPath = path.join(appPath, 'forms.py');
    if (await pathExists(formsPath)) {
      const formsItem = new DjangoTreeItem(
        'Forms',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Forms',
          arguments: [formsPath]
        },
        vscode.Uri.file(formsPath),
        'forms'
      );
      formsItem.iconPath = new vscode.ThemeIcon('symbol-structure');
      items.push(formsItem);
    }

    // Signals (signals.py)
    const signalsPath = path.join(appPath, 'signals.py');
    if (await pathExists(signalsPath)) {
      const signalsItem = new DjangoTreeItem(
        'Signals',
        vscode.TreeItemCollapsibleState.Collapsed,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Signals',
          arguments: [signalsPath]
        },
        vscode.Uri.file(signalsPath),
        'signals'
      );
      signalsItem.iconPath = new vscode.ThemeIcon('broadcast');
      items.push(signalsItem);
    }

    // Management commands (management/commands/*.py)
    const commands = await this.analyzer.findManagementCommands(appPath);
    if (commands.length > 0) {
      const commandsItem = new DjangoTreeItem(
        'Commands',
        vscode.TreeItemCollapsibleState.Collapsed,
        undefined,
        vscode.Uri.file(path.join(appPath, 'management', 'commands')),
        'commands'
      );
      commandsItem.iconPath = new vscode.ThemeIcon('terminal');
      items.push(commandsItem);
    }

    // Celery tasks (tasks.py con @shared_task / @app.task), nodo aparte de las
    // Tasks de Django 6. Solo se añade si hay alguna tarea de Celery.
    const tasksPathForCelery = path.join(appPath, 'tasks.py');
    if (await pathExists(tasksPathForCelery)) {
      const celeryTasks = await this.analyzer.extractCeleryTasks(tasksPathForCelery);
      if (celeryTasks.length > 0) {
        const celeryItem = new DjangoTreeItem(
          'Celery Tasks',
          vscode.TreeItemCollapsibleState.Collapsed,
          {
            command: 'djangoStructureExplorer.openFile',
            title: 'Open Celery Tasks',
            arguments: [tasksPathForCelery]
          },
          vscode.Uri.file(tasksPathForCelery),
          'celery-tasks'
        );
        celeryItem.iconPath = new vscode.ThemeIcon('rocket');
        items.push(celeryItem);
      }
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

    return this.finalizeItems(items);
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

      // Etiqueta de tipo (DRF) y decoradores como descripción combinada.
      const parts: string[] = [];
      if (view.apiKind === 'viewset') {
        parts.push('DRF ViewSet');
        viewItem.iconPath = new vscode.ThemeIcon('symbol-interface');
      } else if (view.apiKind === 'apiview') {
        parts.push('DRF APIView');
        viewItem.iconPath = new vscode.ThemeIcon('symbol-interface');
      }

      const decorators = view.decorators ?? [];
      if (decorators.length > 0) {
        const decoLabel = decorators.map(d => `@${d}`).join(' ');
        parts.push(decoLabel);
        // Marcar visualmente las vistas con control de acceso/protección.
        const guarded = decorators.some(d =>
          /login_required|permission_required|staff_member_required|user_passes_test|csrf_protect|csrf_exempt/.test(d)
        );
        if (guarded) {
          viewItem.iconPath = new vscode.ThemeIcon('lock');
        }
        viewItem.tooltip = `${view.name}\nDecoradores: ${decoLabel}`;
      }
      if (parts.length > 0) {
        viewItem.description = parts.join(' · ');
      }
      return viewItem;
    });

    return this.finalizeItems(items);
  }

  private async getTemplates(appPath: string): Promise<DjangoTreeItem[]> {
    const files = await this.analyzer.findAppTemplates(appPath);
    const items = files.map(file => {
      // Etiqueta relativa al directorio templates/ cuando es posible.
      const norm = file.replace(/\\/g, '/');
      const marker = '/templates/';
      const idx = norm.lastIndexOf(marker);
      const label = idx >= 0 ? norm.substring(idx + marker.length) : path.basename(file);

      const item = new DjangoTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Template',
          arguments: [file]
        },
        vscode.Uri.file(file),
        'template'
      );
      item.iconPath = new vscode.ThemeIcon('file-code');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getSerializers(serializersPath: string): Promise<DjangoTreeItem[]> {
    const serializers = await this.analyzer.extractSerializers(serializersPath);
    const items = serializers.map(serializer => {
      const item = new DjangoTreeItem(
        serializer.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Serializer',
          arguments: [serializersPath, serializer.lineNumber]
        },
        vscode.Uri.file(serializersPath),
        'serializer'
      );
      item.iconPath = new vscode.ThemeIcon('symbol-class');
      if (serializer.modelName) {
        item.description = serializer.modelName;
      }
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getSchemas(schemasPath: string): Promise<DjangoTreeItem[]> {
    const schemas = await this.analyzer.extractSchemas(schemasPath);
    const items = schemas.map(schema => {
      const item = new DjangoTreeItem(
        schema.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Schema',
          arguments: [schemasPath, schema.lineNumber]
        },
        vscode.Uri.file(schemasPath),
        'schema'
      );
      item.iconPath = new vscode.ThemeIcon('symbol-interface');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getApiEndpoints(element: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    let endpoints = element.apiEndpoints ?? [];
    if (endpoints.length === 0 && element.resourceUri) {
      const appPath = element.resourceUri.fsPath;
      const apiPath = path.join(appPath, 'api.py');
      if (await pathExists(apiPath)) {
        endpoints = endpoints.concat(await this.analyzer.extractNinjaEndpoints(apiPath));
      }
      for (const drfFile of ['views.py', 'viewsets.py']) {
        const drfPath = path.join(appPath, drfFile);
        if (await pathExists(drfPath)) {
          endpoints = endpoints.concat(await this.analyzer.extractDrfEndpoints(drfPath));
        }
      }
    }

    const items = endpoints.map(endpoint => {
      const label = endpoint.path ? `${endpoint.method} ${endpoint.path}` : endpoint.method;
      const item = new DjangoTreeItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Endpoint',
          arguments: [endpoint.filePath, endpoint.lineNumber]
        },
        vscode.Uri.file(endpoint.filePath),
        'api-endpoint'
      );
      item.description = `${endpoint.framework} · ${endpoint.handler}`;
      item.iconPath = new vscode.ThemeIcon('symbol-event');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getForms(formsPath: string): Promise<DjangoTreeItem[]> {
    const forms = await this.analyzer.extractForms(formsPath);
    const items = forms.map(form => {
      const item = new DjangoTreeItem(
        form.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Form',
          arguments: [formsPath, form.lineNumber]
        },
        vscode.Uri.file(formsPath),
        'form'
      );
      item.iconPath = new vscode.ThemeIcon('symbol-structure');
      if (form.modelName) {
        item.description = form.modelName;
      }
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getSignals(signalsPath: string): Promise<DjangoTreeItem[]> {
    const signals = await this.analyzer.extractSignals(signalsPath);
    const items = signals.map(signal => {
      const item = new DjangoTreeItem(
        signal.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Signal',
          arguments: [signalsPath, signal.lineNumber]
        },
        vscode.Uri.file(signalsPath),
        'signal'
      );
      item.description = signal.kind === 'receiver' ? 'receiver' : 'Signal';
      item.iconPath = new vscode.ThemeIcon(signal.kind === 'receiver' ? 'symbol-method' : 'broadcast');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getCommands(element: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    if (!element.resourceUri) {
      return [];
    }
    // resourceUri apunta a management/commands; la app es dos niveles arriba.
    const appPath = path.dirname(path.dirname(element.resourceUri.fsPath));
    const commands = await this.analyzer.findManagementCommands(appPath);

    const items = commands.map(command => {
      const item = new DjangoTreeItem(
        command.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Command',
          arguments: [command.filePath]
        },
        vscode.Uri.file(command.filePath),
        'command'
      );
      item.iconPath = new vscode.ThemeIcon('terminal');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getCeleryTasks(tasksPath: string): Promise<DjangoTreeItem[]> {
    const tasks = await this.analyzer.extractCeleryTasks(tasksPath);
    const items = tasks.map(task => {
      const item = new DjangoTreeItem(
        task.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Celery Task',
          arguments: [tasksPath, task.lineNumber]
        },
        vscode.Uri.file(tasksPath),
        'celery-task'
      );
      item.iconPath = new vscode.ThemeIcon('rocket');
      return item;
    });

    return this.finalizeItems(items);
  }

  private async getUrls(urlsPath: string): Promise<DjangoTreeItem[]> {
    const urls = await this.analyzer.extractUrls(urlsPath);
    const items = urls.map(url => {
      const urlItem = new DjangoTreeItem(
        url.pattern || '/',
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open URL',
          // url.filePath puede diferir de urlsPath si la ruta viene de un include().
          arguments: [url.filePath, url.lineNumber]
        },
        vscode.Uri.file(url.filePath),
        'url'
      );
      urlItem.description = url.viewName;
      urlItem.iconPath = new vscode.ThemeIcon('link');
      return urlItem;
    });

    return this.finalizeItems(items);
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

    return this.finalizeItems(items);
  }

  private async getTasks(tasksPath: string): Promise<DjangoTreeItem[]> {
    const tasks = await this.analyzer.extractTasks(tasksPath);
    const items = tasks.map(task => {
      const taskItem = new DjangoTreeItem(
        task.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Task',
          arguments: [tasksPath, task.lineNumber]
        },
        vscode.Uri.file(tasksPath),
        'task'
      );
      taskItem.iconPath = new vscode.ThemeIcon('symbol-event');
      return taskItem;
    });

    return this.finalizeItems(items);
  }

  private async getPartials(element: DjangoTreeItem): Promise<DjangoTreeItem[]> {
    // Partials cacheados al construir el nodo de la app; si faltan (p. ej. nodo
    // reconstruido), se reescanean a partir de la ruta de la app.
    let partials = element.partials ?? [];
    if (partials.length === 0 && element.resourceUri) {
      partials = await this.analyzer.findAppPartials(element.resourceUri.fsPath);
    }

    const items = partials.map(partial => {
      const partialItem = new DjangoTreeItem(
        partial.name,
        vscode.TreeItemCollapsibleState.None,
        {
          command: 'djangoStructureExplorer.openFile',
          title: 'Open Partial',
          arguments: [partial.templatePath, partial.lineNumber]
        },
        vscode.Uri.file(partial.templatePath),
        'partial'
      );
      partialItem.description = path.basename(partial.templatePath);
      partialItem.iconPath = new vscode.ThemeIcon('symbol-snippet');
      return partialItem;
    });

    return this.finalizeItems(items);
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

    return this.finalizeItems(items);
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

import * as vscode from 'vscode';
import * as fs from 'fs';
import { DjangoStructureProvider } from './djangoStructureProvider';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoOutlineProvider } from './djangoOutlineProvider';
import { DjangoDefinitionProvider } from './djangoDefinitionProvider';
import { initPythonParser } from './pythonParser';

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

/**
 * Comandos de manage.py de uso frecuente ofrecidos en el QuickPick del runner.
 */
// Las descripciones se escriben en inglés (idioma fuente de la localización) y
// se traducen en tiempo de ejecución con vscode.l10n.t() al construir el
// QuickPick (durante la activación, cuando el bundle ya está cargado).
const COMMON_MANAGE_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
  { command: 'runserver', description: 'Start the development server' },
  { command: 'makemigrations', description: 'Create migrations from your models' },
  { command: 'migrate', description: 'Apply migrations to the database' },
  { command: 'showmigrations', description: 'Show the migration status' },
  { command: 'shell', description: 'Open the interactive Django shell' },
  { command: 'dbshell', description: 'Open the database shell' },
  { command: 'createsuperuser', description: 'Create a superuser' },
  { command: 'collectstatic', description: 'Collect static files' },
  { command: 'check', description: 'Check the project for problems' },
  { command: 'test', description: 'Run the test suite' }
];

/** Terminal reutilizable para los comandos de manage.py. */
let manageTerminal: vscode.Terminal | undefined;

/**
 * Un nombre de comando de gestión de Django es un módulo Python importable:
 * solo letras, dígitos y guion bajo. Validar antes de ejecutarlo evita la
 * inyección de shell cuando el nombre procede de una fuente indirecta (p. ej.
 * el nombre de un fichero en management/commands/ mostrado en el árbol).
 */
const VALID_COMMAND_NAME = /^[A-Za-z0-9_]+$/;

/**
 * Ruta de intérprete admisible: nombre o ruta (con espacios) sin metacaracteres
 * de shell. Evita inyección si pythonPath llegara a contener `;`, `|`, `&`, `$`,
 * comillas invertidas o saltos de línea.
 */
const VALID_PYTHON_PATH = /^[A-Za-z0-9_.\/\\:\- ]+$/;

/**
 * Ejecuta `python manage.py <commandLine>` en una terminal dedicada, ubicada en
 * la raíz del proyecto. El intérprete es configurable
 * (djangoStructureExplorer.pythonPath, por defecto "python").
 */
function runManagePy(projectRoot: string, commandLine: string): void {
  const pythonPath = vscode.workspace
    .getConfiguration('djangoStructureExplorer')
    .get<string>('pythonPath', 'python');

  if (!VALID_PYTHON_PATH.test(pythonPath)) {
    vscode.window.showErrorMessage(
      `Django Structure Explorer: djangoStructureExplorer.pythonPath no válido: ${pythonPath}`
    );
    return;
  }

  if (!manageTerminal || manageTerminal.exitStatus !== undefined) {
    manageTerminal = vscode.window.createTerminal({ name: 'Django', cwd: projectRoot });
  }
  manageTerminal.show();
  manageTerminal.sendText(`${pythonPath} manage.py ${commandLine}`);
}

export function activate(context: vscode.ExtensionContext) {
  // Calentar el parser de tree-sitter en segundo plano: carga el runtime WASM y la
  // gramática de Python para que la primera expansión de modelos no pague esa latencia.
  // Es idempotente; los extractores también lo invocan de forma perezosa.
  void initPythonParser().catch(err => {
    console.error('Django Structure Explorer: fallo al inicializar el parser de Python:', err);
  });

  const djangoStructureProvider = new DjangoStructureProvider();
  const djangoOutlineProvider = new DjangoOutlineProvider();
  const djangoDefinitionProvider = new DjangoDefinitionProvider();

  const treeView = vscode.window.createTreeView('djangoStructureExplorer', {
    treeDataProvider: djangoStructureProvider
  });

  const syncFilterDescription = () => {
    const filter = djangoStructureProvider.currentFilter;
    treeView.description = filter ? vscode.l10n.t('filter: {0}', filter) : undefined;
  };

  context.subscriptions.push(
    treeView,
    vscode.languages.registerDocumentSymbolProvider({ language: 'python', pattern: '**/*.py' }, djangoOutlineProvider),
    // Navegación cruzada (F12 / Ctrl+clic): URL names, plantillas y relaciones de modelo.
    vscode.languages.registerDefinitionProvider({ language: 'python', pattern: '**/*.py' }, djangoDefinitionProvider),
    vscode.languages.registerDefinitionProvider(
      [
        { language: 'html', pattern: '**/templates/**/*.html' },
        { language: 'django-html' },
        { pattern: '**/templates/**/*.html' }
      ],
      djangoDefinitionProvider
    ),
    vscode.commands.registerCommand('djangoStructureExplorer.refresh', () => djangoStructureProvider.refresh()),
    vscode.commands.registerCommand('djangoStructureExplorer.openFile', async (filePath: string, lineNumber?: number) => {
      if (!(await pathExists(filePath))) {
        vscode.window.showErrorMessage(vscode.l10n.t('The file {0} does not exist.', filePath));
        return;
      }
      const doc = await vscode.workspace.openTextDocument(filePath);
      const editor = await vscode.window.showTextDocument(doc);
      if (lineNumber !== undefined) {
        const position = new vscode.Position(lineNumber, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
      }
    }),
    // Fase C: runner de manage.py. Sin argumento muestra un QuickPick con los
    // comandos habituales (y una opción para escribir uno libre).
    vscode.commands.registerCommand('djangoStructureExplorer.runManageCommand', async () => {
      const projectRoot = djangoStructureProvider.getProjectRoot();
      if (!projectRoot) {
        vscode.window.showErrorMessage(vscode.l10n.t('Django Structure Explorer: manage.py not found in the workspace.'));
        return;
      }

      const items: vscode.QuickPickItem[] = COMMON_MANAGE_COMMANDS.map(c => ({
        label: c.command,
        description: vscode.l10n.t(c.description)
      }));
      const customLabel = `$(pencil) ${vscode.l10n.t('Other command…')}`;
      items.push({ label: customLabel, description: vscode.l10n.t('Type a custom manage.py command') });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: vscode.l10n.t('Select a manage.py command')
      });
      if (!picked) {
        return;
      }

      let commandLine = picked.label;
      if (picked.label === customLabel) {
        const input = await vscode.window.showInputBox({
          prompt: vscode.l10n.t('manage.py command (with arguments)'),
          placeHolder: vscode.l10n.t('e.g. loaddata fixtures/initial.json')
        });
        if (!input || !input.trim()) {
          return;
        }
        commandLine = input.trim();
        // Validar el nombre del comando (primer token). Los argumentos van
        // libres a propósito: el usuario los teclea para su propia terminal.
        const commandName = commandLine.split(/\s+/)[0];
        if (!VALID_COMMAND_NAME.test(commandName)) {
          vscode.window.showErrorMessage(vscode.l10n.t('Django Structure Explorer: invalid command name: {0}', commandName));
          return;
        }
      }

      runManagePy(projectRoot, commandLine);
    }),
    // Ejecuta un comando de gestión personalizado desde su nodo del árbol.
    vscode.commands.registerCommand('djangoStructureExplorer.runCustomCommand', (item?: DjangoTreeItem) => {
      const projectRoot = djangoStructureProvider.getProjectRoot();
      if (!projectRoot) {
        vscode.window.showErrorMessage(vscode.l10n.t('Django Structure Explorer: manage.py not found in the workspace.'));
        return;
      }
      const name = item?.label?.toString();
      if (!name) {
        return;
      }
      if (!VALID_COMMAND_NAME.test(name)) {
        vscode.window.showErrorMessage(vscode.l10n.t('Django Structure Explorer: invalid command name: {0}', name));
        return;
      }
      runManagePy(projectRoot, name);
    }),
    // Fase D: filtrar / limpiar el filtro de los items hoja del árbol.
    vscode.commands.registerCommand('djangoStructureExplorer.filter', async () => {
      const input = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Filter tree items by name'),
        placeHolder: vscode.l10n.t('Search text (empty to clear)'),
        value: djangoStructureProvider.currentFilter
      });
      if (input === undefined) {
        return;
      }
      djangoStructureProvider.setFilter(input);
      syncFilterDescription();
    }),
    vscode.commands.registerCommand('djangoStructureExplorer.clearFilter', () => {
      djangoStructureProvider.setFilter('');
      syncFilterDescription();
    })
  );
}

export function deactivate() {
  if (manageTerminal) {
    manageTerminal.dispose();
    manageTerminal = undefined;
  }
}

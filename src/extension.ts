import * as vscode from 'vscode';
import * as fs from 'fs';
import { DjangoStructureProvider } from './djangoStructureProvider';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoOutlineProvider } from './djangoOutlineProvider';
import { DjangoDefinitionProvider } from './djangoDefinitionProvider';

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
const COMMON_MANAGE_COMMANDS: ReadonlyArray<{ command: string; description: string }> = [
  { command: 'runserver', description: 'Iniciar el servidor de desarrollo' },
  { command: 'makemigrations', description: 'Crear migraciones a partir de los modelos' },
  { command: 'migrate', description: 'Aplicar migraciones a la base de datos' },
  { command: 'showmigrations', description: 'Mostrar el estado de las migraciones' },
  { command: 'shell', description: 'Abrir el shell interactivo de Django' },
  { command: 'dbshell', description: 'Abrir el shell de la base de datos' },
  { command: 'createsuperuser', description: 'Crear un superusuario' },
  { command: 'collectstatic', description: 'Recopilar los ficheros estáticos' },
  { command: 'check', description: 'Comprobar el proyecto en busca de problemas' },
  { command: 'test', description: 'Ejecutar la batería de tests' }
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
 * Ejecuta `python manage.py <commandLine>` en una terminal dedicada, ubicada en
 * la raíz del proyecto. El intérprete es configurable
 * (djangoStructureExplorer.pythonPath, por defecto "python").
 */
function runManagePy(projectRoot: string, commandLine: string): void {
  const pythonPath = vscode.workspace
    .getConfiguration('djangoStructureExplorer')
    .get<string>('pythonPath', 'python');

  if (!manageTerminal || manageTerminal.exitStatus !== undefined) {
    manageTerminal = vscode.window.createTerminal({ name: 'Django', cwd: projectRoot });
  }
  manageTerminal.show();
  manageTerminal.sendText(`${pythonPath} manage.py ${commandLine}`);
}

export function activate(context: vscode.ExtensionContext) {
  const djangoStructureProvider = new DjangoStructureProvider();
  const djangoOutlineProvider = new DjangoOutlineProvider();
  const djangoDefinitionProvider = new DjangoDefinitionProvider();

  const treeView = vscode.window.createTreeView('djangoStructureExplorer', {
    treeDataProvider: djangoStructureProvider
  });

  const syncFilterDescription = () => {
    const filter = djangoStructureProvider.currentFilter;
    treeView.description = filter ? `filtro: ${filter}` : undefined;
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
        vscode.window.showErrorMessage(`El archivo ${filePath} no existe.`);
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
        vscode.window.showErrorMessage('Django Structure Explorer: no se encontró manage.py en el workspace.');
        return;
      }

      const items: vscode.QuickPickItem[] = COMMON_MANAGE_COMMANDS.map(c => ({
        label: c.command,
        description: c.description
      }));
      const customLabel = '$(pencil) Otro comando…';
      items.push({ label: customLabel, description: 'Escribir un comando de manage.py personalizado' });

      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: 'Selecciona un comando de manage.py'
      });
      if (!picked) {
        return;
      }

      let commandLine = picked.label;
      if (picked.label === customLabel) {
        const input = await vscode.window.showInputBox({
          prompt: 'Comando de manage.py (con argumentos)',
          placeHolder: 'p. ej. loaddata fixtures/initial.json'
        });
        if (!input || !input.trim()) {
          return;
        }
        commandLine = input.trim();
        // Validar el nombre del comando (primer token). Los argumentos van
        // libres a propósito: el usuario los teclea para su propia terminal.
        const commandName = commandLine.split(/\s+/)[0];
        if (!VALID_COMMAND_NAME.test(commandName)) {
          vscode.window.showErrorMessage(`Django Structure Explorer: nombre de comando no válido: ${commandName}`);
          return;
        }
      }

      runManagePy(projectRoot, commandLine);
    }),
    // Ejecuta un comando de gestión personalizado desde su nodo del árbol.
    vscode.commands.registerCommand('djangoStructureExplorer.runCustomCommand', (item?: DjangoTreeItem) => {
      const projectRoot = djangoStructureProvider.getProjectRoot();
      if (!projectRoot) {
        vscode.window.showErrorMessage('Django Structure Explorer: no se encontró manage.py en el workspace.');
        return;
      }
      const name = item?.label?.toString();
      if (!name) {
        return;
      }
      if (!VALID_COMMAND_NAME.test(name)) {
        vscode.window.showErrorMessage(`Django Structure Explorer: nombre de comando no válido: ${name}`);
        return;
      }
      runManagePy(projectRoot, name);
    }),
    // Fase D: filtrar / limpiar el filtro de los items hoja del árbol.
    vscode.commands.registerCommand('djangoStructureExplorer.filter', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Filtrar elementos del árbol por nombre',
        placeHolder: 'Texto a buscar (vacío para limpiar)',
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

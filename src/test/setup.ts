/**
 * Bootstrap de Mocha: intercepta require('vscode') con un stub minimo.
 *
 * El analizador importa 'vscode' solo para notificar errores
 * (vscode.window.showErrorMessage). Fuera del host de extensiones ese modulo
 * no existe, asi que lo sustituimos para poder ejecutar tests unitarios puros
 * sin descargar el harness de Electron.
 */
import * as Module from 'module';

// TreeItem mínimo: djangoTreeItem.ts hace `class DjangoTreeItem extends
// vscode.TreeItem` en top-level, así que el stub debe exponer una clase real
// para que el módulo (y quien lo importe) cargue fuera del host de extensiones.
class TreeItemStub {
  tooltip?: string;
  contextValue?: string;
  iconPath?: unknown;
  constructor(public label: string, public collapsibleState?: number) {}
}

class EventEmitterStub {
  event = (): void => undefined;
  fire = (): void => undefined;
  dispose = (): void => undefined;
}

// Las claves replican a propósito la API real de `vscode` (clases y enums en
// PascalCase), así que aquí se exime la regla de nomenclatura camelCase.
/* eslint-disable @typescript-eslint/naming-convention */
const vscodeStub = {
  window: {
    showErrorMessage: (): undefined => undefined
  },
  workspace: {
    workspaceFolders: undefined
  },
  // Stub de vscode.l10n: sustituye los marcadores {n} por los argumentos, sin
  // traducir (los tests se ejecutan en el idioma fuente, inglés).
  l10n: {
    t: (message: string, ...args: unknown[]): string =>
      message.replace(/\{(\d+)\}/g, (_match, index) => String(args[Number(index)]))
  },
  TreeItem: TreeItemStub,
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class { constructor(public id: string) {} },
  EventEmitter: EventEmitterStub,
  Uri: { file: (p: string): { fsPath: string } => ({ fsPath: p }) }
};
/* eslint-enable @typescript-eslint/naming-convention */

const moduleRef = Module as unknown as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown;
};
const originalLoad = moduleRef._load;
moduleRef._load = function (request: string, parent: unknown, isMain: boolean): unknown {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

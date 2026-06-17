/**
 * Bootstrap de Mocha: intercepta require('vscode') con un stub minimo.
 *
 * El analizador importa 'vscode' solo para notificar errores
 * (vscode.window.showErrorMessage). Fuera del host de extensiones ese modulo
 * no existe, asi que lo sustituimos para poder ejecutar tests unitarios puros
 * sin descargar el harness de Electron.
 */
import * as Module from 'module';

const vscodeStub = {
  window: {
    showErrorMessage: (): undefined => undefined
  }
};

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

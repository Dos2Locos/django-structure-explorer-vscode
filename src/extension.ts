import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DjangoStructureProvider } from './djangoStructureProvider';
import { DjangoTreeItem } from './djangoTreeItem';
import { DjangoOutlineProvider } from './djangoOutlineProvider';

export function activate(context: vscode.ExtensionContext) {
  const djangoStructureProvider = new DjangoStructureProvider();
  const djangoOutlineProvider = new DjangoOutlineProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('djangoStructureExplorer', djangoStructureProvider),
    vscode.languages.registerDocumentSymbolProvider({ language: 'python', pattern: '**/*.py' }, djangoOutlineProvider),
    vscode.commands.registerCommand('djangoStructureExplorer.refresh', () => djangoStructureProvider.refresh()),
    vscode.commands.registerCommand('djangoStructureExplorer.openFile', async (filePath: string, lineNumber?: number) => {
      if (!fs.existsSync(filePath)) {
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
    })
  );
}

export function deactivate() {}

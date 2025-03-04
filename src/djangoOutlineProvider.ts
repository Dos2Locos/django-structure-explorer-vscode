import * as vscode from 'vscode';
import { DjangoProjectAnalyzer } from './djangoProjectAnalyzer';
import * as path from 'path';

export class DjangoOutlineProvider implements vscode.DocumentSymbolProvider {
  private analyzer: DjangoProjectAnalyzer;

  constructor() {
    this.analyzer = new DjangoProjectAnalyzer();
  }

  public async provideDocumentSymbols(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.DocumentSymbol[]> {
    const symbols: vscode.DocumentSymbol[] = [];
    const fileName = path.basename(document.fileName);

    // Solo procesar archivos Python
    if (!document.fileName.endsWith('.py')) {
      return [];
    }

    try {
      // Analizar el archivo según su tipo
      if (fileName === 'models.py') {
        const models = await this.analyzer.extractModels(document.fileName);
        for (const model of models) {
          const modelSymbol = new vscode.DocumentSymbol(
            model.name,
            'class',
            vscode.SymbolKind.Class,
            new vscode.Range(model.lineNumber, 0, model.lineNumber, 0),
            new vscode.Range(model.lineNumber, 0, model.lineNumber, 0)
          );

          // Añadir campos como hijos del modelo
          if (model.fields) {
            for (const field of model.fields) {
              const fieldSymbol = new vscode.DocumentSymbol(
                field.name,
                field.fieldType || '',
                field.isProperty ? vscode.SymbolKind.Property : vscode.SymbolKind.Field,
                new vscode.Range(field.lineNumber, 0, field.lineNumber, 0),
                new vscode.Range(field.lineNumber, 0, field.lineNumber, 0)
              );
              modelSymbol.children.push(fieldSymbol);
            }
          }

          symbols.push(modelSymbol);
        }
      } else if (fileName === 'views.py') {
        const views = await this.analyzer.extractViews(document.fileName);
        for (const view of views) {
          const viewSymbol = new vscode.DocumentSymbol(
            view.name,
            view.isClass ? 'class' : 'function',
            view.isClass ? vscode.SymbolKind.Class : vscode.SymbolKind.Function,
            new vscode.Range(view.lineNumber, 0, view.lineNumber, 0),
            new vscode.Range(view.lineNumber, 0, view.lineNumber, 0)
          );
          symbols.push(viewSymbol);
        }
      } else if (fileName === 'urls.py') {
        const urls = await this.analyzer.extractUrls(document.fileName);
        for (const url of urls) {
          const urlSymbol = new vscode.DocumentSymbol(
            url.pattern,
            url.viewName,
            vscode.SymbolKind.Variable,
            new vscode.Range(url.lineNumber, 0, url.lineNumber, 0),
            new vscode.Range(url.lineNumber, 0, url.lineNumber, 0)
          );
          symbols.push(urlSymbol);
        }
      } else if (fileName === 'admin.py') {
        const adminClasses = await this.analyzer.extractAdminClasses(document.fileName);
        for (const adminClass of adminClasses) {
          const adminSymbol = new vscode.DocumentSymbol(
            adminClass.name,
            `Admin for ${adminClass.modelName}`,
            vscode.SymbolKind.Class,
            new vscode.Range(adminClass.lineNumber, 0, adminClass.lineNumber, 0),
            new vscode.Range(adminClass.lineNumber, 0, adminClass.lineNumber, 0)
          );
          symbols.push(adminSymbol);
        }
      }
    } catch (error) {
      console.error('Error al extraer símbolos:', error);
    }

    return symbols;
  }
}

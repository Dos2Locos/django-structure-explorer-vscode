import * as vscode from 'vscode';
import { ModelField, DjangoPartial, DjangoApiEndpoint, DjangoView } from './djangoProjectAnalyzer';

export class DjangoTreeItem extends vscode.TreeItem {
  /**
   * Campos del modelo asociados a este item (solo para items de tipo 'model').
   * Tipado explícito en lugar del antiguo canal lateral `(item as any).modelFields`.
   */
  public modelFields?: ModelField[];

  /**
   * Partials de plantilla asociados a este item (solo para items 'partials').
   * Se cachean al construir el nodo de la app para no reescanear al expandir.
   */
  public partials?: DjangoPartial[];

  /**
   * Endpoints REST (django-ninja + DRF) cacheados al construir el nodo 'api'
   * de la app, para no reescanear varios ficheros al expandir.
   */
  public apiEndpoints?: DjangoApiEndpoint[];

  /**
   * Vistas (ya divididas en front/API por `apiKind`) cacheadas en los nodos
   * 'views-front' y 'views-api' para no reparsear `views.py`/`viewsets.py` al
   * expandir. Cada vista lleva su `filePath` de origen.
   */
  public views?: DjangoView[];

  /**
   * Nodos-categoría hijos cacheados en los nodos de agrupación 'front-group' y
   * 'api-group'. Se construyen al armar la app y se devuelven tal cual al expandir.
   */
  public groupChildren?: DjangoTreeItem[];

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly resourceUri?: vscode.Uri,
    public readonly contextValue?: string
  ) {
    super(label, collapsibleState);
    this.tooltip = this.label;
    if (contextValue) {
      this.contextValue = contextValue;
    }
  }
}

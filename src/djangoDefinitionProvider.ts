import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DjangoProjectAnalyzer, DjangoLocation } from './djangoProjectAnalyzer';

interface QuotedString {
  value: string;
  start: number; // índice del primer carácter del contenido (tras la comilla)
  end: number;   // índice tras el último carácter del contenido
}

/**
 * Devuelve la cadena entrecomillada que contiene la posición dada, si la hay.
 */
function stringAtPosition(line: string, character: number): QuotedString | undefined {
  const regex = /(['"])((?:\\.|(?!\1).)*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(line)) !== null) {
    const start = match.index + 1;
    const end = start + match[2].length;
    if (character >= start && character <= end) {
      return { value: match[2], start, end };
    }
  }
  return undefined;
}

/**
 * Provee "Ir a definición" (F12 / Ctrl+clic) para navegación cruzada de Django:
 *  - nombres de URL: reverse('app:detail') / {% url 'app:detail' %} → urls.py
 *  - plantillas: render()/get_template()/TemplateResponse()/template_name y
 *    {% extends %}/{% include %} → fichero .html
 *  - relaciones de modelo: ForeignKey/OneToOneField/ManyToManyField → class del modelo
 *
 * La lógica de resolución vive en DjangoProjectAnalyzer (pura y testeable); aquí
 * solo se interpreta el contexto del cursor y se traduce a vscode.Location.
 */
export class DjangoDefinitionProvider implements vscode.DefinitionProvider {
  private analyzer = new DjangoProjectAnalyzer();

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Definition | undefined> {
    const projectRoot = this.findProjectRoot(document.uri);
    if (!projectRoot) {
      return undefined;
    }

    const line = document.lineAt(position.line).text;
    const quoted = stringAtPosition(line, position.character);
    const before = quoted
      ? line.substring(0, quoted.start - 1)
      : line.substring(0, position.character);

    // 1) Nombre de URL: reverse(...) / reverse_lazy(...) / {% url '...' %}
    if (quoted && /(?:reverse(?:_lazy)?\s*\(\s*)$|(?:\{%\s*url\s+)$/.test(before)) {
      const loc = await this.analyzer.findUrlName(projectRoot, quoted.value);
      return loc ? this.toLocation(loc) : undefined;
    }

    // 2) Plantilla: render/get_template/select_template/TemplateResponse/
    //    template_name=  y  {% extends %} / {% include %}
    const templateContext =
      /render\s*\([^)]*$|get_template\s*\(\s*$|select_template\s*\(\s*$|TemplateResponse\s*\([^)]*$|template_name\s*=\s*$|\{%\s*(?:extends|include)\s+$/;
    if (quoted && templateContext.test(before)) {
      const file = await this.analyzer.findTemplateFile(projectRoot, quoted.value);
      return file
        ? new vscode.Location(vscode.Uri.file(file), new vscode.Position(0, 0))
        : undefined;
    }

    // 3) Relación de modelo: ForeignKey / OneToOneField / ManyToManyField
    const relationRegex = /\b(?:ForeignKey|OneToOneField|ManyToManyField)\s*\(/;
    if (relationRegex.test(line)) {
      let target: string | undefined;
      if (quoted && relationRegex.test(before)) {
        target = quoted.value; // 'app.Model' o 'Model'
      } else {
        const wordRange = document.getWordRangeAtPosition(position);
        if (wordRange) {
          target = document.getText(wordRange);
        }
      }
      if (target && target !== 'self' && target !== 'models') {
        const loc = await this.analyzer.findModelClass(projectRoot, target);
        if (loc) {
          return this.toLocation(loc);
        }
      }
    }

    return undefined;
  }

  private toLocation(loc: DjangoLocation): vscode.Location {
    return new vscode.Location(vscode.Uri.file(loc.filePath), new vscode.Position(loc.lineNumber, 0));
  }

  /**
   * Localiza la raíz del proyecto (carpeta con manage.py) a partir del documento:
   * primero la carpeta de workspace, y si no, subiendo por el árbol de directorios.
   */
  private findProjectRoot(uri: vscode.Uri): string | undefined {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder && fs.existsSync(path.join(folder.uri.fsPath, 'manage.py'))) {
      return folder.uri.fsPath;
    }

    let dir = path.dirname(uri.fsPath);
    const root = path.parse(dir).root;
    while (dir !== root) {
      if (fs.existsSync(path.join(dir, 'manage.py'))) {
        return dir;
      }
      dir = path.dirname(dir);
    }

    return folder?.uri.fsPath;
  }
}

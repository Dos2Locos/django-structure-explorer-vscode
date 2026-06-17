import * as assert from 'assert';
import * as path from 'path';
import { DjangoProjectAnalyzer } from '../djangoProjectAnalyzer';

// __dirname en runtime = <root>/out/test ; los fixtures viven en src/test (no se compilan).
const FIXTURES = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'criticalapp');
const FIXTURES_COMMENTS = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'commentsapp');
const FIXTURES_CYCLE = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'robustness');

describe('DjangoProjectAnalyzer — red de seguridad de parsing (Fase 4)', () => {
  const analyzer = new DjangoProjectAnalyzer();

  describe('extractModels', () => {
    it('detecta los tres modelos, incluida la herencia de base abstracta', async () => {
      const models = await analyzer.extractModels(path.join(FIXTURES, 'models.py'));
      const names = models.map(m => m.name);
      assert.deepStrictEqual(
        new Set(names),
        new Set(['TimeStamped', 'Category', 'Article'])
      );
    });

    // [Fase 2 · conteo de parentesis] El regex usa `\(?` que consume el parentesis
    // de apertura, asi que un campo de una sola linea queda con parenthesesCount = -1
    // y se trata como "pendiente": solo se vuelca al coincidir el siguiente campo o
    // en EOF. El ultimo campo antes de un cambio de clase a mitad de archivo se pierde
    // (aqui, `updated` de TimeStamped). Se activara en RED->GREEN en Fase 2.
    it('[Fase 2] captura todos los campos de un modelo a mitad de archivo', async () => {
      const models = await analyzer.extractModels(path.join(FIXTURES, 'models.py'));
      const ts = models.find(m => m.name === 'TimeStamped');
      const fieldNames = (ts?.fields ?? []).map(f => f.name);
      assert.ok(fieldNames.includes('created'), 'falta el campo created');
      assert.ok(fieldNames.includes('updated'), 'falta el campo updated');
    });

    it('captura campos estandar, multilinea y @property de Article', async () => {
      const models = await analyzer.extractModels(path.join(FIXTURES, 'models.py'));
      const article = models.find(m => m.name === 'Article');
      const fieldNames = (article?.fields ?? []).map(f => f.name);
      for (const expected of ['title', 'summary', 'body', 'category']) {
        assert.ok(fieldNames.includes(expected), `falta el campo ${expected}`);
      }
    });

    // [Fase 2 · #11] Un campo declarado DESPUES de la clase Meta se pierde porque
    // inMetaClass no se resetea por indentacion. Se activara en RED->GREEN en Fase 2.
    it('[Fase 2 #11] captura un campo declarado tras la clase Meta', async () => {
      const models = await analyzer.extractModels(path.join(FIXTURES, 'models.py'));
      const category = models.find(m => m.name === 'Category');
      const fieldNames = (category?.fields ?? []).map(f => f.name);
      assert.ok(fieldNames.includes('slug'), 'el campo slug declarado tras Meta deberia detectarse');
    });
  });

  describe('extractUrls', () => {
    it('captura una ruta path() con vista CBV .as_view()', async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const patterns = urls.map(u => u.pattern);
      assert.ok(patterns.includes('about/'), 'falta la ruta about/');
    });

    // [Fase 2 · #9] Las raw strings r'...' en re_path() no se reconocen.
    it("[Fase 2 #9] captura re_path() con raw string r'...'", async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const views = urls.map(u => u.viewName);
      assert.ok(views.includes('views.year_archive'), 'falta la vista de re_path con raw string');
    });

    // [Fase 2 · #9] Las raw strings r'...' en url() no se reconocen.
    it("[Fase 2 #9] captura url() con raw string r'...'", async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const views = urls.map(u => u.viewName);
      assert.ok(views.includes('views.legacy'), 'falta la vista de url con raw string');
    });

    // [Fase 2 · patron vacio] path('') de la raiz se ignora porque el regex exige [^'"]+.
    it("[Fase 2] captura path('') de la raiz del sitio", async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const views = urls.map(u => u.viewName);
      assert.ok(views.includes('views.home'), 'falta la ruta raiz');
    });
  });

  describe('extractAdminClasses', () => {
    it('detecta todas las clases de admin declaradas', async () => {
      const admins = await analyzer.extractAdminClasses(path.join(FIXTURES, 'admin.py'));
      const names = admins.map(a => a.name);
      for (const expected of ['ArticleAdmin', 'SharedAdmin', 'LegacyAdmin']) {
        assert.ok(names.includes(expected), `falta la clase admin ${expected}`);
      }
    });
  });

  describe('extractSettings', () => {
    it('detecta settings simples, de lista y de diccionario', async () => {
      const settings = await analyzer.extractSettings(path.join(FIXTURES, 'settings.py'));
      const names = settings.map(s => s.name);
      for (const expected of ['SECRET_KEY', 'DEBUG', 'ALLOWED_HOSTS', 'INSTALLED_APPS', 'DATABASES']) {
        assert.ok(names.includes(expected), `falta el setting ${expected}`);
      }
    });

    it('[Fase 3] captura el valor completo de un dict anidado (balance de brackets)', async () => {
      const settings = await analyzer.extractSettings(path.join(FIXTURES, 'settings.py'));
      const databases = settings.find(s => s.name === 'DATABASES');
      assert.ok(databases, 'falta el setting DATABASES');
      // El valor debe incluir el dict anidado completo, no truncarse en el primer '}'.
      assert.ok(databases!.value.includes('sqlite3'), 'el valor de DATABASES se truncó antes del motor');
      assert.ok(databases!.value.trim().endsWith('}'), 'el valor de DATABASES no cerró el dict externo');
    });
  });

  describe('Fase 3 — refinamiento de URLs y admin', () => {
    it('[Fase 3] captura una ruta path() declarada en varias líneas', async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const views = urls.map(u => u.viewName);
      assert.ok(views.includes('views.contact'), 'falta la ruta path() multilínea');
    });

    it('[Fase 3] captura un router.register() de DRF', async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES, 'urls.py'));
      const authors = urls.find(u => u.viewName === 'views.AuthorViewSet');
      assert.ok(authors, 'falta el registro del router DRF');
      assert.strictEqual(authors!.pattern, 'authors');
    });

    it('[Fase 3] asocia varios modelos a un @admin.register(A, B)', async () => {
      const admins = await analyzer.extractAdminClasses(path.join(FIXTURES, 'admin.py'));
      const shared = admins.find(a => a.name === 'SharedAdmin');
      assert.ok(shared, 'falta SharedAdmin');
      assert.strictEqual(shared!.modelName, 'Category, TimeStamped');
    });

    it('[Fase 3] no duplica una clase admin ya registrada por decorador', async () => {
      const admins = await analyzer.extractAdminClasses(path.join(FIXTURES, 'admin.py'));
      const articleAdmins = admins.filter(a => a.name === 'ArticleAdmin');
      assert.strictEqual(articleAdmins.length, 1, 'ArticleAdmin no debería duplicarse');
      assert.strictEqual(articleAdmins[0].modelName, 'Article');
    });
  });

  // Debilidad del parser con comentarios: no debe detectar símbolos dentro de
  // código comentado (# de línea ni bloques de triple comilla), pero SÍ debe
  // conservar las '#' que aparecen dentro de cadenas legítimas.
  describe('Comentarios — # de línea y docstrings multilínea', () => {
    describe('extractModels', () => {
      it('no detecta clases ni campos comentados, sí los reales', async () => {
        const models = await analyzer.extractModels(path.join(FIXTURES_COMMENTS, 'models.py'));
        const names = models.map(m => m.name);
        assert.deepStrictEqual(new Set(names), new Set(['Producto']), 'solo Producto es un modelo real');

        const producto = models.find(m => m.name === 'Producto');
        const fields = (producto?.fields ?? []).map(f => f.name);
        assert.ok(fields.includes('nombre'), 'falta el campo nombre');
        assert.ok(fields.includes('activo'), 'falta el campo activo (con comentario al final)');
        assert.ok(!fields.includes('descripcion'), 'no debe capturar un campo comentado');
        assert.ok(!fields.includes('precio_antiguo'), 'no debe capturar un campo dentro del docstring');
      });
    });

    describe('extractUrls', () => {
      it('no detecta rutas comentadas, sí las reales', async () => {
        const urls = await analyzer.extractUrls(path.join(FIXTURES_COMMENTS, 'urls.py'));
        const views = urls.map(u => u.viewName);
        assert.ok(views.includes('views.inicio'), 'falta la ruta real inicio');
        assert.ok(views.includes('views.contacto'), 'falta la ruta real contacto');
        assert.ok(!views.includes('views.viejo'), 'no debe capturar una ruta comentada');
        assert.ok(!views.includes('views.extra'), 'no debe capturar una ruta comentada al final');
      });
    });

    describe('extractAdminClasses', () => {
      it('no detecta clases de admin comentadas, sí las reales', async () => {
        const admins = await analyzer.extractAdminClasses(path.join(FIXTURES_COMMENTS, 'admin.py'));
        const names = admins.map(a => a.name);
        assert.ok(names.includes('ProductoAdmin'), 'falta ProductoAdmin real');
        assert.ok(!names.includes('ProductoViejoAdmin'), 'no debe capturar un admin comentado');
        assert.ok(!names.includes('ViejoAdmin'), 'no debe capturar un register() comentado');
      });
    });

    describe('extractSettings', () => {
      it('no detecta settings comentados ni dentro de docstrings, sí los reales', async () => {
        const settings = await analyzer.extractSettings(path.join(FIXTURES_COMMENTS, 'settings.py'));
        const names = settings.map(s => s.name);
        assert.ok(names.includes('DEBUG'), 'falta DEBUG');
        assert.ok(names.includes('ALLOWED_HOSTS'), 'falta ALLOWED_HOSTS');
        assert.ok(names.includes('REAL_SETTING'), 'falta REAL_SETTING');
        assert.ok(!names.includes('SECRET_KEY'), 'no debe capturar un setting comentado');
        assert.ok(!names.includes('FAKE_SETTING'), 'no debe capturar un setting dentro de un docstring');
      });

      it("conserva una '#' dentro de una cadena (no la trata como comentario)", async () => {
        const settings = await analyzer.extractSettings(path.join(FIXTURES_COMMENTS, 'settings.py'));
        const color = settings.find(s => s.name === 'COLOR_FONDO');
        assert.ok(color, 'falta el setting COLOR_FONDO');
        assert.ok(color!.value.includes('#ffffff'), 'el valor con # dentro de la cadena no debe truncarse');
      });
    });
  });

  // Robustez adicional (revisión de código): no debe colgarse ni producir
  // entradas fantasma ante entradas adversas o estructuras multilínea.
  describe('Robustez del parser', () => {
    it('no entra en recursión infinita con includes circulares', async () => {
      // a.urls incluye b.urls y b.urls incluye a.urls (ciclo).
      const urls = await analyzer.extractUrls(path.join(FIXTURES_CYCLE, 'a', 'urls.py'));
      // Lo importante es que TERMINE; además no debe duplicar indefinidamente.
      const aurls = urls.filter(u => u.viewName === 'views.a_index');
      assert.ok(aurls.length <= 1, 'la ruta de a no debe repetirse por el ciclo');
    });

    it('no se rompe con un import que contiene metacaracteres de regex', async () => {
      // models.py con `from django.db.models import (CharField)` → el paréntesis
      // rompía new RegExp(...) y dejaba los campos vacíos en silencio.
      const models = await analyzer.extractModels(path.join(FIXTURES_CYCLE, 'regexapp', 'models.py'));
      const m = models.find(x => x.name === 'Cosa');
      assert.ok(m, 'debe detectar el modelo Cosa pese al import con paréntesis');
      const fields = (m?.fields ?? []).map(f => f.name);
      assert.ok(fields.includes('nombre'), 'debe capturar el campo pese al import problemático');
    });

    it('no genera settings fantasma a partir de líneas de un valor multilínea', async () => {
      const settings = await analyzer.extractSettings(path.join(FIXTURES_COMMENTS, 'settings.py'));
      const names = settings.map(s => s.name);
      // DATABASES (multilínea) no debe inyectar claves internas como settings.
      assert.ok(names.includes('REAL_SETTING'), 'falta REAL_SETTING tras el bloque multilínea');
    });
  });
});

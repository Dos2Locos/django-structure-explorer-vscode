import * as assert from 'assert';
import * as path from 'path';
import { DjangoProjectAnalyzer } from '../djangoProjectAnalyzer';

// __dirname en runtime = <root>/out/test ; los fixtures viven en src/test (no se compilan).
const FIXTURES = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'criticalapp');
const FIXTURES_COMMENTS = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'commentsapp');
const FIXTURES_CYCLE = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'robustness');
const FIXTURES_DJ6 = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'django6app');
const FIXTURES_CELERY = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'celeryapp');
const FIXTURES_REST = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'restapp');

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

  // Django 6: framework de Tasks (tasks.py / @task) y partials de plantilla.
  describe('Django 6 — Tasks y partials', () => {
    describe('extractTasks', () => {
      it('detecta funciones decoradas con @task y @task(...)', async () => {
        const tasks = await analyzer.extractTasks(path.join(FIXTURES_DJ6, 'tasks.py'));
        const names = tasks.map(t => t.name);
        assert.ok(names.includes('send_welcome_email'), 'falta la tarea @task');
        assert.ok(names.includes('rebuild_search_index'), 'falta la tarea @task(...)');
      });

      it('no marca como tareas las funciones sin decorador @task', async () => {
        const tasks = await analyzer.extractTasks(path.join(FIXTURES_DJ6, 'tasks.py'));
        const names = tasks.map(t => t.name);
        assert.ok(!names.includes('helper_no_es_tarea'), 'no debe capturar una función sin @task');
        assert.ok(!names.includes('funcion_normal'), 'no debe capturar una función normal');
      });

      it('no detecta tareas de Celery (sin import de django.tasks)', async () => {
        const tasks = await analyzer.extractTasks(path.join(FIXTURES_CELERY, 'tasks.py'));
        assert.strictEqual(tasks.length, 0, 'no debe confundir @shared_task/@app.task con Tasks de Django');
      });
    });

    describe('extractPartials / findAppPartials', () => {
      it('detecta las definiciones partialdef, incluida la variante inline', async () => {
        const partials = await analyzer.findAppPartials(FIXTURES_DJ6);
        const names = partials.map(p => p.name);
        assert.ok(names.includes('product-card'), 'falta el partial product-card');
        assert.ok(names.includes('sidebar'), 'falta el partial sidebar (inline)');
      });

      it('ignora partialdef dentro de comentarios y el uso {% partial %}', async () => {
        const partials = await analyzer.findAppPartials(FIXTURES_DJ6);
        const names = partials.map(p => p.name);
        assert.ok(!names.includes('partial-comentado'), 'no debe detectar un partialdef comentado');
        // {% partial product-card %} es uso, no definición: no debe duplicar.
        const productCard = partials.filter(p => p.name === 'product-card');
        assert.strictEqual(productCard.length, 1, 'el uso {% partial %} no debe contar como definición');
      });
    });
  });

  // DRF + django-ninja: serializers, schemas, endpoints y marcado de ViewSets.
  describe('DRF y django-ninja', () => {
    describe('extractSerializers', () => {
      it('detecta serializers de DRF y asocia el modelo de Meta', async () => {
        const serializers = await analyzer.extractSerializers(path.join(FIXTURES_REST, 'serializers.py'));
        const names = serializers.map(s => s.name);
        assert.ok(names.includes('ArticleSerializer'), 'falta ArticleSerializer');
        assert.ok(names.includes('PlainSerializer'), 'falta PlainSerializer');
        assert.ok(!names.includes('NoEsSerializer'), 'no debe capturar una clase que no es serializer');
        const article = serializers.find(s => s.name === 'ArticleSerializer');
        assert.strictEqual(article?.modelName, 'Article', 'debe asociar el modelo Article del Meta');
      });
    });

    describe('extractSchemas', () => {
      it('detecta schemas de ninja (Schema y ModelSchema)', async () => {
        const schemas = await analyzer.extractSchemas(path.join(FIXTURES_REST, 'schemas.py'));
        const names = schemas.map(s => s.name);
        assert.ok(names.includes('ArticleOut'), 'falta ArticleOut (Schema)');
        assert.ok(names.includes('ArticleIn'), 'falta ArticleIn (ModelSchema)');
        assert.ok(!names.includes('NoEsSchema'), 'no debe capturar una clase que no es schema');
      });
    });

    describe('extractNinjaEndpoints', () => {
      it('detecta operaciones @api/@router con método y ruta', async () => {
        const endpoints = await analyzer.extractNinjaEndpoints(path.join(FIXTURES_REST, 'api.py'));
        const list = endpoints.find(e => e.handler === 'list_articles');
        assert.ok(list, 'falta el endpoint list_articles');
        assert.strictEqual(list?.method, 'GET');
        assert.strictEqual(list?.path, '/articles');
        const create = endpoints.find(e => e.handler === 'create_article');
        assert.strictEqual(create?.method, 'POST');
        assert.strictEqual(create?.path, '/articles/{article_id}');
        assert.ok(endpoints.every(e => e.framework === 'ninja'), 'todos deben ser ninja');
      });
    });

    describe('extractDrfEndpoints', () => {
      it('detecta @api_view y @action, no las funciones normales', async () => {
        const endpoints = await analyzer.extractDrfEndpoints(path.join(FIXTURES_REST, 'views.py'));
        const handlers = endpoints.map(e => e.handler);
        assert.ok(handlers.includes('stats'), 'falta el endpoint @api_view stats');
        assert.ok(handlers.includes('publish'), 'falta la acción @action publish');
        assert.ok(!handlers.includes('vista_normal'), 'no debe capturar una vista normal');

        const stats = endpoints.find(e => e.handler === 'stats');
        assert.ok(stats?.method.includes('GET') && stats?.method.includes('POST'), 'stats debe listar GET y POST');
        const publish = endpoints.find(e => e.handler === 'publish');
        assert.strictEqual(publish?.method, 'POST');
        assert.strictEqual(publish?.path, 'publish', 'debe usar el url_path de la acción');
      });
    });

    describe('extractViews — marcado DRF', () => {
      it('marca ViewSets y APIView/generics, deja las vistas normales sin marca', async () => {
        const views = await analyzer.extractViews(path.join(FIXTURES_REST, 'views.py'));
        const byName = (n: string) => views.find(v => v.name === n);
        assert.strictEqual(byName('ArticleViewSet')?.apiKind, 'viewset');
        assert.strictEqual(byName('ArticleListView')?.apiKind, 'apiview', 'ListAPIView termina en APIView');
        assert.strictEqual(byName('PingView')?.apiKind, 'apiview');
        assert.strictEqual(byName('vista_normal')?.apiKind, undefined, 'una vista normal no debe marcarse');
      });
    });
  });
});

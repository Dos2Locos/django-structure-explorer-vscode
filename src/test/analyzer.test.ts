import * as assert from 'assert';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { DjangoProjectAnalyzer, DEFAULT_EXCLUDED_DIRS, isApiView, partitionAppViews, DjangoView } from '../djangoProjectAnalyzer';
import { findManagePyDir, DjangoStructureProvider } from '../djangoStructureProvider';

// __dirname en runtime = <root>/out/test ; los fixtures viven en src/test (no se compilan).
const FIXTURES = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'criticalapp');
const FIXTURES_COMMENTS = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'commentsapp');
const FIXTURES_CYCLE = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'robustness');
const FIXTURES_DJ6 = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'django6app');
const FIXTURES_CELERY = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'celeryapp');
const FIXTURES_REST = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'restapp');
const FIXTURES_NAV = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'navproj');
const FIXTURES_DECORATED = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'decoratedapp');
const FIXTURES_SPLIT = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'splitsettings');
const FIXTURES_NESTED = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'nestedproj');
const FIXTURES_DEEP = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'deepproj');
const FIXTURES_IGNORED_ROOT = path.resolve(__dirname, '..', '..', 'src', 'test', 'fixtures', 'ignoredroot');

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

    // Regresión señalada por Codex en la PR: un modelo con decorador de clase
    // (envuelto por tree-sitter en decorated_definition) no debe perderse.
    it('[Codex] detecta modelos con decorador de clase y sus subclases', async () => {
      const models = await analyzer.extractModels(path.join(FIXTURES_DECORATED, 'models.py'));
      const names = models.map(m => m.name);
      assert.ok(names.includes('Auditada'), 'falta el modelo decorado Auditada');
      assert.ok(names.includes('HijaDeAuditada'), 'falta la subclase del modelo decorado (herencia transitiva)');
    });

    // Regresión señalada por Codex: el prefijo del path() externo debe propagarse
    // a las rutas incluidas (path('b/', include('b.urls')) → b/lista/, no lista/).
    it('[Codex] propaga el prefijo externo del path() a las rutas incluidas', async () => {
      const urls = await analyzer.extractUrls(path.join(FIXTURES_CYCLE, 'a', 'urls.py'));
      const leaf = urls.find(u => u.viewName === 'views.b_list');
      assert.ok(leaf, 'falta la ruta hoja incluida desde b.urls');
      assert.strictEqual(leaf!.pattern, 'b/lista/', 'la ruta incluida debe llevar el prefijo del path() externo');
      // Porta el fix de #3: una URL incluida apunta a SU fichero, no al de cabecera.
      assert.ok(leaf!.filePath.endsWith(path.join('b', 'urls.py')), 'la URL incluida debe apuntar a su propio urls.py');
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

    describe('isApiView — partición Front/API del árbol', () => {
      it('clasifica como API las vistas DRF y deja en Front las normales', async () => {
        const views = await analyzer.extractViews(path.join(FIXTURES_REST, 'views.py'));
        const apiNames = views.filter(isApiView).map(v => v.name);
        const frontNames = views.filter(v => !isApiView(v)).map(v => v.name);

        // ViewSets / APIView / generics → API
        assert.ok(apiNames.includes('ArticleViewSet'), 'ArticleViewSet debe ir a API');
        assert.ok(apiNames.includes('ArticleListView'), 'ListAPIView debe ir a API');
        assert.ok(apiNames.includes('PingView'), 'APIView debe ir a API');
        // Función decorada con @api_view → API (aunque no tenga apiKind)
        assert.ok(apiNames.includes('stats'), '@api_view stats debe ir a API');
        // Vista normal sin marca ni decorador → Front
        assert.ok(frontNames.includes('vista_normal'), 'vista_normal debe ir a Front');
        assert.ok(!apiNames.includes('vista_normal'), 'vista_normal no debe ir a API');
      });
    });

    describe('extractUrls — ficheros de rutas con nombre alternativo', () => {
      it('extrae rutas de un api_urls.py (path y router.register), no solo de urls.py', async () => {
        const urls = await analyzer.extractUrls(path.join(FIXTURES_REST, 'api_urls.py'));
        const patterns = urls.map(u => u.pattern);
        assert.ok(patterns.includes('stats/'), 'debe extraer la ruta path("stats/")');
        assert.ok(patterns.includes('articles'), 'debe extraer el prefijo de router.register("articles")');
      });
    });

    describe('partitionAppViews — reparto Front/API por fichero', () => {
      it('manda a Front solo lo de views.py y descarta los helpers de viewsets.py', () => {
        const views: DjangoView[] = [
          { name: 'HomeView', lineNumber: 1, isClass: true, filePath: '/app/views.py' },
          { name: 'stats', lineNumber: 9, isClass: false, decorators: ['api_view'], filePath: '/app/views.py' },
          { name: 'ArticleViewSet', lineNumber: 1, isClass: true, apiKind: 'viewset', filePath: '/app/viewsets.py' },
          // Helper/mixin en viewsets.py: ni front ni API → se descarta.
          { name: 'AuditMixin', lineNumber: 20, isClass: true, filePath: '/app/viewsets.py' }
        ];
        const { front, api } = partitionAppViews(views);
        const frontNames = front.map(v => v.name);
        const apiNames = api.map(v => v.name);

        assert.deepStrictEqual(frontNames, ['HomeView'], 'Front solo debe contener vistas de views.py');
        assert.ok(apiNames.includes('ArticleViewSet') && apiNames.includes('stats'), 'API debe incluir el ViewSet y la función @api_view');
        assert.ok(!frontNames.includes('AuditMixin') && !apiNames.includes('AuditMixin'), 'el helper de viewsets.py no debe aparecer en ninguna sección');
      });
    });
  });

  // Estructura adicional: forms, signals, comandos de gestión y tareas de Celery.
  describe('Estructura adicional', () => {
    it('extractForms detecta Form/ModelForm y asocia el modelo del Meta', async () => {
      const forms = await analyzer.extractForms(path.join(FIXTURES_REST, 'forms.py'));
      const names = forms.map(f => f.name);
      assert.ok(names.includes('ArticleForm'), 'falta ArticleForm');
      assert.ok(names.includes('ContactForm'), 'falta ContactForm');
      assert.ok(!names.includes('NoEsForm'), 'no debe capturar una clase que no es form');
      assert.strictEqual(forms.find(f => f.name === 'ArticleForm')?.modelName, 'Article');
    });

    it('extractSignals detecta receivers y señales personalizadas', async () => {
      const signals = await analyzer.extractSignals(path.join(FIXTURES_REST, 'signals.py'));
      const receiver = signals.find(s => s.name === 'on_article_saved');
      assert.strictEqual(receiver?.kind, 'receiver', 'on_article_saved debe ser un receiver');
      const custom = signals.find(s => s.name === 'article_published');
      assert.strictEqual(custom?.kind, 'signal', 'article_published debe ser una señal');
      assert.ok(!signals.some(s => s.name === 'funcion_normal'), 'no debe capturar una función sin @receiver');
    });

    it('findManagementCommands lista los comandos por nombre de fichero (sin __init__)', async () => {
      const commands = await analyzer.findManagementCommands(FIXTURES_REST);
      const names = commands.map(c => c.name);
      assert.ok(names.includes('import_articles'), 'falta el comando import_articles');
      assert.ok(!names.includes('__init__'), 'no debe listar __init__.py');
    });

    it('extractCeleryTasks detecta @shared_task y @app.task, no @task de Django', async () => {
      const tasks = await analyzer.extractCeleryTasks(path.join(FIXTURES_CELERY, 'tasks.py'));
      const names = tasks.map(t => t.name);
      assert.ok(names.includes('enviar_correo'), 'falta la tarea @shared_task');
      assert.ok(names.includes('otra_tarea_celery'), 'falta la tarea @app.task');
      // Y a la inversa: las tareas de Django no deben colarse como Celery.
      const djangoAsCelery = await analyzer.extractCeleryTasks(path.join(FIXTURES_DJ6, 'tasks.py'));
      assert.strictEqual(djangoAsCelery.length, 0, '@task de django.tasks no es una tarea de Celery');
    });
  });

  // Decoradores de vistas (Fase D): se capturan los decoradores de nivel
  // superior para señalar control de acceso/protección en el árbol.
  describe('Decoradores en vistas', () => {
    it('captura decoradores de nivel superior en vistas de función', async () => {
      const views = await analyzer.extractViews(path.join(FIXTURES_NAV, 'blog', 'views.py'));
      const dashboard = views.find(v => v.name === 'dashboard');
      assert.deepStrictEqual(dashboard?.decorators, ['login_required']);

      const manage = views.find(v => v.name === 'manage_authors');
      assert.deepStrictEqual(
        manage?.decorators,
        ['permission_required', 'require_http_methods'],
        'debe acumular varios decoradores apilados'
      );
    });

    it('no asigna decoradores a vistas sin ellos ni los arrastra', async () => {
      const views = await analyzer.extractViews(path.join(FIXTURES_NAV, 'blog', 'views.py'));
      const publicIndex = views.find(v => v.name === 'public_index');
      assert.strictEqual(publicIndex?.decorators, undefined, 'public_index no tiene decoradores');
      const listView = views.find(v => v.name === 'AuthorListView');
      assert.strictEqual(listView?.decorators, undefined, 'la clase posterior no hereda decoradores previos');
    });

    it('descarta el módulo y los argumentos del decorador (@api_view)', async () => {
      const views = await analyzer.extractViews(path.join(FIXTURES_REST, 'views.py'));
      const stats = views.find(v => v.name === 'stats');
      assert.deepStrictEqual(stats?.decorators, ['api_view']);
    });
  });

  // findMainUrlsFile debe reconocer el paquete de configuración aunque use un
  // paquete de settings dividido (config/settings/base.py), no solo settings.py.
  describe('findMainUrlsFile — paquetes de settings divididos', () => {
    it('devuelve el urls.py del paquete config con settings/ dividido', async () => {
      const local = new DjangoProjectAnalyzer();
      const mainUrls = await local.findMainUrlsFile(FIXTURES_SPLIT);
      assert.ok(mainUrls, 'debe encontrar el urls.py raíz pese a no haber settings.py plano');
      assert.ok(
        mainUrls!.replace(/\\/g, '/').endsWith('splitsettings/config/urls.py'),
        'debe devolver config/urls.py, no el urls.py de la app'
      );
    });

    it('no devuelve el urls.py de una app sin paquete de configuración', async () => {
      const local = new DjangoProjectAnalyzer();
      const mainUrls = await local.findMainUrlsFile(FIXTURES_SPLIT);
      assert.ok(!mainUrls!.replace(/\\/g, '/').includes('blogapp'), 'blogapp/urls.py no es la raíz');
    });

    it('findSettingsFiles surfacea un módulo del paquete settings/ dividido', async () => {
      const local = new DjangoProjectAnalyzer();
      const settingsFiles = await local.findSettingsFiles(FIXTURES_SPLIT);
      const normalized = settingsFiles.map(f => f.replace(/\\/g, '/'));
      assert.ok(
        normalized.some(f => f.endsWith('splitsettings/config/settings/base.py')),
        'debe surfacear config/settings/base.py para que aparezca el nodo Settings'
      );
    });
  });

  // Workspace que no es un proyecto Django: en el stub de tests
  // workspace.workspaceFolders es undefined, así que no hay manage.py.
  describe('Vista sin proyecto Django', () => {
    it('muestra un item informativo en la raíz en vez de un árbol vacío', async () => {
      const provider = new DjangoStructureProvider();
      const children = await provider.getChildren();
      assert.strictEqual(children.length, 1, 'debe haber un único item informativo');
      assert.strictEqual(children[0].contextValue, 'empty', 'el item debe marcarse como vacío');
      assert.ok(!children[0].command, 'el item informativo no debe ser clicable');
    });

    it('no expande ramas hijas cuando no hay proyecto', async () => {
      const provider = new DjangoStructureProvider();
      const [info] = await provider.getChildren();
      const grandchildren = await provider.getChildren(info);
      assert.deepStrictEqual(grandchildren, [], 'sin proyecto no hay nodos hijos');
    });
  });

  // Localización recursiva de la raíz: manage.py puede vivir en un subdirectorio
  // (monorepo, proyecto en backend/), no solo en la raíz del workspace.
  describe('findManagePyDir — búsqueda recursiva de la raíz', () => {
    it('encuentra manage.py en un subdirectorio anidado (no en la raíz)', () => {
      const root = findManagePyDir(FIXTURES_NESTED);
      assert.ok(root, 'debe localizar la raíz anidada');
      assert.strictEqual(path.basename(root!), 'backend', 'manage.py vive en backend/');
    });

    it('no desciende a directorios excluidos (dist, node_modules, venv…)', () => {
      // El único manage.py de este proyecto cuelga de dist/: debe ignorarse.
      const root = findManagePyDir(FIXTURES_IGNORED_ROOT);
      assert.strictEqual(root, undefined, 'no debe localizar un manage.py dentro de un directorio excluido');
    });

    it('respeta el límite de profundidad', () => {
      // manage.py está a dos niveles (wrap/inner): con maxDepth=1 no se alcanza.
      assert.strictEqual(findManagePyDir(FIXTURES_DEEP, 1), undefined, 'con profundidad 1 no debe encontrarlo');
      const root = findManagePyDir(FIXTURES_DEEP);
      assert.ok(root && path.basename(root) === 'inner', 'con la profundidad por defecto sí debe encontrarlo');
    });

    it('devuelve undefined si no hay manage.py bajo la raíz', () => {
      // criticalapp es una app suelta, sin manage.py en su árbol.
      assert.strictEqual(findManagePyDir(FIXTURES), undefined);
    });
  });

  // Exclusión de directorios por .gitignore: el escaneo debe omitir las carpetas
  // declaradas en el .gitignore del proyecto, además de la lista por defecto.
  // El escenario se construye en un directorio temporal en runtime: un .gitignore
  // versionado dentro de los fixtures haría que git ignorase el propio fixture.
  describe('Exclusión por .gitignore', () => {
    let tmpRoot: string;

    before(() => {
      tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dse-gitignore-'));
      fs.writeFileSync(
        path.join(tmpRoot, '.gitignore'),
        // Mezcla deliberada: directorio simple, comentario, glob, negación y ruta
        // anidada. Solo "secret_app" debe acabar en la lista de exclusión.
        '# carpetas privadas\nsecret_app/\n*.log\n!keep_this\nnested/dir\n'
      );
      for (const app of ['realapp', 'secret_app']) {
        const appDir = path.join(tmpRoot, app);
        fs.mkdirSync(appDir, { recursive: true });
        fs.writeFileSync(path.join(appDir, 'models.py'), 'from django.db import models\n');
      }
    });

    after(() => {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    it('por defecto (sin cargar .gitignore) detecta también la app ignorada', async () => {
      const local = new DjangoProjectAnalyzer();
      const apps = await local.findDjangoApps(tmpRoot);
      const names = apps.map(a => path.basename(a));
      assert.ok(names.includes('realapp'), 'debe detectar la app real');
      assert.ok(names.includes('secret_app'), 'sin cargar .gitignore, secret_app aún se detecta');
    });

    it('tras loadIgnorePatterns omite la carpeta declarada en .gitignore', async () => {
      const local = new DjangoProjectAnalyzer();
      await local.loadIgnorePatterns(tmpRoot);
      const apps = await local.findDjangoApps(tmpRoot);
      const names = apps.map(a => path.basename(a));
      assert.ok(names.includes('realapp'), 'la app real debe seguir apareciendo');
      assert.ok(!names.includes('secret_app'), 'secret_app/ está en .gitignore y debe excluirse');
    });

    it('fusiona el .gitignore de la raíz del workspace con la del proyecto anidado', async () => {
      // Monorepo: .gitignore en la raíz del workspace, manage.py + apps en backend/.
      const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dse-monorepo-'));
      try {
        fs.writeFileSync(path.join(ws, '.gitignore'), 'secret_app/\n');
        const backend = path.join(ws, 'backend');
        for (const app of ['realapp', 'secret_app']) {
          const appDir = path.join(backend, app);
          fs.mkdirSync(appDir, { recursive: true });
          fs.writeFileSync(path.join(appDir, 'models.py'), 'from django.db import models\n');
        }

        const local = new DjangoProjectAnalyzer();
        // El provider pasa [proyecto, raíz(es) del workspace]; aquí lo emulamos.
        await local.loadIgnorePatterns([backend, ws]);
        const names = (await local.findDjangoApps(backend)).map(a => path.basename(a));
        assert.ok(names.includes('realapp'), 'la app real debe aparecer');
        assert.ok(
          !names.includes('secret_app'),
          'la carpeta ignorada en el .gitignore de la raíz del workspace debe excluirse aun con proyecto anidado'
        );
      } finally {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    });

    it('loadIgnorePatterns es inocuo si el proyecto no tiene .gitignore', async () => {
      const local = new DjangoProjectAnalyzer();
      // FIXTURES_NAV no tiene .gitignore: no debe lanzar ni alterar la detección.
      await local.loadIgnorePatterns(FIXTURES_NAV);
      const apps = await local.findDjangoApps(FIXTURES_NAV);
      assert.ok(apps.some(a => path.basename(a) === 'blog'), 'la app blog debe detectarse igual');
    });

    it('la lista por defecto cubre los directorios pesados habituales', () => {
      for (const expected of ['node_modules', 'venv', '.git', '__pycache__', 'migrations']) {
        assert.ok(DEFAULT_EXCLUDED_DIRS.has(expected), `${expected} debería estar excluido por defecto`);
      }
    });
  });

  // Navegación cruzada (helpers puros que respaldan el DefinitionProvider).
  describe('Navegación cruzada', () => {
    it('findUrlName resuelve un nombre de URL (con y sin namespace)', async () => {
      const conNs = await analyzer.findUrlName(FIXTURES_NAV, 'blog:author-detail');
      assert.ok(conNs, 'debe resolver el nombre con namespace');
      assert.ok(conNs!.filePath.endsWith(path.join('blog', 'urls.py')), 'debe apuntar a blog/urls.py');
      const sinNs = await analyzer.findUrlName(FIXTURES_NAV, 'author-detail');
      assert.ok(sinNs, 'debe resolver el nombre sin namespace');
      assert.deepStrictEqual(sinNs, conNs, 'el namespace no cambia la definición localizada');
    });

    it('findUrlName devuelve undefined si el nombre no existe', async () => {
      const loc = await analyzer.findUrlName(FIXTURES_NAV, 'no-existe');
      assert.strictEqual(loc, undefined);
    });

    it('findTemplateFile resuelve una ruta de plantilla relativa', async () => {
      const file = await analyzer.findTemplateFile(FIXTURES_NAV, 'blog/detail.html');
      assert.ok(file, 'debe encontrar la plantilla');
      assert.ok(file!.replace(/\\/g, '/').endsWith('blog/templates/blog/detail.html'));
    });

    it('findModelClass resuelve un modelo por nombre y por app.Model', async () => {
      const porNombre = await analyzer.findModelClass(FIXTURES_NAV, 'Author');
      assert.ok(porNombre, 'debe encontrar la clase Author');
      assert.ok(porNombre!.filePath.endsWith(path.join('blog', 'models.py')));
      const porApp = await analyzer.findModelClass(FIXTURES_NAV, 'blog.Author');
      assert.deepStrictEqual(porApp, porNombre, 'app.Model debe resolver igual que Model');
    });

    it('findAppTemplates lista las plantillas de la app', async () => {
      const templates = await analyzer.findAppTemplates(path.join(FIXTURES_NAV, 'blog'));
      const names = templates.map(t => path.basename(t)).sort();
      assert.deepStrictEqual(names, ['base.html', 'detail.html']);
    });
  });
});

# Debilidades conocidas del parser

> Estado: **resuelto** (comentarios `#` y bloques `"""`/`'''`). Ver "Implementación" al final.
> Última actualización: 2026-06-17.

El analizador (`src/djangoProjectAnalyzer.ts`) es un parser **basado en regex línea a línea**, no un parser AST de Python. Esto lo hace rápido y sin dependencias, pero arrastra limitaciones inherentes. La más relevante detectada hasta ahora es el tratamiento de comentarios, en sus **dos formas**:

1. Comentarios de una línea (`#`).
2. Comentarios / docstrings multilínea con triple comilla (`"""..."""`, `'''...'''`).

Ambos comparten la misma causa raíz: **el parser no mantiene contexto de comentario ni de cadena**; trata cada línea de forma aislada.

---

## 1. El parser no ignora los comentarios de Python (`#`)

### Síntoma

Código comentado se interpreta como código real y aparece como símbolo en el árbol del explorador (falsos positivos).

```python
# urls.py
urlpatterns = [
    path('activo/', views.activo),
    # path('viejo/', views.viejo),   # <-- comentado, NO debería aparecer
]
```

```python
# models.py
class Usuario(models.Model):
    nombre = models.CharField(max_length=100)
    # edad = models.IntegerField()    # <-- comentado, NO debería aparecer como campo

# class ModeloViejo(models.Model):    # <-- clase comentada, NO debería aparecer
#     pass
```

En ambos casos, las líneas comentadas hacen *match* con las regex y se muestran como rutas, campos o clases reales.

### Causa raíz

Todos los bucles de extracción iteran las líneas crudas y aplican la regex directamente, **sin un paso previo que descarte líneas comentadas** ni que recorte comentarios en línea (`código  # comentario`).

Bucles afectados en `src/djangoProjectAnalyzer.ts`:

| Extractor / zona | Línea aprox. | Qué detecta |
|---|---|---|
| Detección de imports de modelos | 142, 163 | `from django.db import models`, alias |
| Detección de clases modelo (2 pasadas) | 223, 246 | `class X(models.Model)` |
| Detección de campos y `@property` | 299 | `campo = models.CharField(...)` |
| `extractUrls` — vistas | 526 | `def vista`, `class VistaCBV` |
| `extractUrls` — `urlpatterns` | 578 | `path()`, `re_path()`, `url()`, `include()`, routers DRF |
| `extractAdminClasses` | ~693 | `@admin.register`, `class XAdmin` |
| `extractSettings` | 752 | settings simples / lista / dict |

### Por qué el arreglo NO es trivial (`line.split('#')[0]`)

Un recorte ingenuo al primer `#` **rompe casos legítimos** porque `#` puede aparecer dentro de literales de cadena:

```python
re_path(r'^pagina#seccion$', views.x)        # '#' dentro de raw string
ALLOWED_HOSTS = ['ejemplo.com']              # sin problema
ADMIN_URL = 'panel/#dashboard'               # '#' dentro de string de un setting
path('precio/<str:moneda>/', ...)            # ok, pero ilustra strings con caracteres especiales
```

Si se corta en el primer `#`, esas líneas se truncan y dejan de parsearse o se parsean mal.

### Enfoque de arreglo propuesto

Añadir un helper **consciente de cadenas** que elimine únicamente el comentario real (el `#` que está fuera de comillas), respetando comillas simples, dobles y *raw strings*. Algo como:

```ts
/**
 * Devuelve la línea sin su comentario Python (`#` fuera de cadenas).
 * Respeta comillas simples/dobles. No intenta cubrir triple-comillas
 * multilínea (ver limitación 2).
 */
private stripComment(line: string): string {
  let inSingle = false;
  let inDouble = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble) {
      return line.slice(0, k);
    }
  }
  return line;
}
```

Puntos de integración: aplicar `stripComment(...)` a `lines[i]` al inicio de **cada** bucle de extracción de la tabla anterior, antes de hacer `.trim()` y los `.match()`. Conviene un único punto de normalización para no duplicar lógica.

Ojo con `extractUrls` (línea 578): acumula líneas lógicas multilínea (balance de paréntesis) concatenando `lines[j]`; el recorte de comentario debe hacerse **por cada línea física** antes de concatenar, no sobre la línea lógica ya unida.

### Tests a añadir (TDD)

Crear casos en `src/test/analyzer.test.ts` que verifiquen que NO se capturan:
- `path()` / `re_path()` / `url()` comentados
- campos de modelo comentados
- clases (`class X(models.Model)`) comentadas
- registros de admin comentados
- settings comentados

Y que SÍ se siguen capturando líneas con `#` dentro de cadenas (regresión del `stripComment`).

---

## 2. El parser no ignora docstrings / comentarios multilínea (`"""`, `'''`)

### Síntoma

Código "comentado" dentro de un bloque de triple comilla se detecta como real:

```python
# models.py
class Usuario(models.Model):
    """
    Modelo de usuario.

    Ejemplo de campo que YA NO usamos:
        edad = models.IntegerField()   # <-- dentro del docstring, NO debería aparecer
    """
    nombre = models.CharField(max_length=100)
```

```python
"""
Versión antigua del urlconf, conservada como referencia:
    path('viejo/', views.viejo)        # <-- NO debería aparecer
"""
urlpatterns = [
    path('activo/', views.activo),
]
```

### Causa raíz

El `stripComment` por línea (punto 1) **no basta**: una triple comilla abre un bloque que puede abarcar muchas líneas, y todo su contenido debe ignorarse hasta el cierre. Esto exige **estado entre líneas**, no se resuelve mirando una línea de forma aislada.

Casos a contemplar:
- Apertura y cierre en líneas distintas (`"""` ... varias líneas ... `"""`).
- Triple comilla simple (`'''`) y doble (`"""`).
- Docstring de una sola línea (`"""texto"""`) — abre y cierra en la misma línea, no debe activar el estado multilínea.
- *Raw* / *f-string* triples (`r"""..."""`, `f"""..."""`).
- **No confundir** con asignaciones legítimas multilínea de un setting:
  ```python
  DESCRIPCION = """
  texto largo
  """
  ```
  Aquí el `"""` es el *valor* de un setting real; el reto es distinguir "string usado como valor" de "string usado como comentario/docstring suelto". Como heurística, un bloque triple-comilla **suelto** (que no es el lado derecho de una asignación ni el cuerpo inmediato esperado) se trata como comentario; en la práctica, lo seguro es: ignorar el *contenido interno* del bloque para la detección de símbolos, pero permitir que la línea de apertura que contiene `NOMBRE = """` siga siendo parseable por `extractSettings`.

### Enfoque de arreglo propuesto

Sustituir el simple `stripComment` por un **preprocesado con estado** que recorra el archivo una vez y produzca, para cada línea, una versión "limpia para análisis":

```ts
/**
 * Recorre el contenido y marca/blanquea las regiones que son comentario:
 *  - comentarios de línea (`#` fuera de cadenas)
 *  - bloques de triple comilla (""" o ''') que no son el valor de una asignación
 * Devuelve las líneas con el contenido de comentario neutralizado, preservando
 * el número de líneas (para no romper los offsets de `range`/`line`).
 */
private stripComments(content: string): string[] {
  // Estado a mantener entre líneas:
  //   - tripleQuote: null | '"""' | "'''"  (bloque abierto)
  // Por línea: si NO estamos en bloque, aplicar stripComment (punto 1) y
  //   detectar aperturas de triple comilla (contando cierres en la misma línea).
  // Si estamos en bloque, blanquear hasta encontrar el cierre.
}
```

Claves de implementación:
- **Preservar el número de líneas** (devolver `string[]` del mismo tamaño) para no descuadrar los cálculos de `line`/`range` que hacen los extractores (p. ej. `content.substring(0, index).split('\n').length`).
- Reutilizar la lógica de `stripComment` (consciente de comillas simples/dobles) del punto 1 para el `#` cuando no se está dentro de un bloque triple.
- Aplicar este preprocesado **una sola vez** al cargar el contenido del archivo, y que todos los extractores consuman las líneas ya limpias.

---

## 3. Limitaciones relacionadas (mismo origen: parser por regex, no AST)

En el radar, menor prioridad:

- **Continuaciones de línea con `\`**: no se tratan como línea lógica única (salvo el caso de paréntesis en `extractUrls`).
- **f-strings con expresiones complejas**: el escaneo carácter a carácter no interpreta `{...}` anidados; poco probable que afecte a la detección de símbolos, pero conviene tenerlo presente.

---

## Resumen de seguimiento

- [x] Implementar un preprocesado consciente de cadenas (`#` fuera de comillas)
- [x] Estado entre líneas para bloques `"""`/`'''`, preservando longitud y conteo de líneas
- [x] Integrar el preprocesado en TODOS los extractores (models, views, urls, admin, settings)
- [x] Tests de no-captura: código comentado con `#`, dentro de docstrings y bloques triple multilínea
- [x] Tests de regresión: `#` dentro de cadenas (`COLOR_FONDO = '#ffffff'`)

## Implementación

Resuelto con un único método `DjangoProjectAnalyzer.stripComments(content)` (en
`src/djangoProjectAnalyzer.ts`), aplicado tras `readFile` en los cinco
extractores. En lugar de un `stripComment` por línea + un `stripComments` con
estado por separado, se unificó en **un escáner carácter a carácter** que:

- mantiene estado entre líneas para bloques de triple comilla;
- reemplaza por **espacios** el contenido de comentario (comentarios `#` y el
  interior de bloques `"""`/`'''`), conservando delimitadores y `\n` →
  **misma longitud y mismo número de líneas**, así que `lineOf` y `split('\n')`
  siguen siendo válidos sin tocar la lógica de los extractores;
- conserva intactas las cadenas de una sola línea (valores que el parser
  necesita), evitando interpretar una `#` interna como comentario.

Como efecto colateral se eliminó el recorte manual de comentarios de
`extractSettings`, que truncaba el valor en la primera `#` aunque estuviera
dentro de una cadena (caso `COLOR_FONDO = '#ffffff'`).

Tests en `src/test/analyzer.test.ts` (fixture aislada
`src/test/fixtures/commentsapp/`).

### Pendiente (menor)

- Continuaciones de línea con `\` (ver punto 3).
- f-strings con expresiones `{...}` anidadas (poco probable que afecte).

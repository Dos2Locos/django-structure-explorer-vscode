"""Fixture de settings que cubre casos CRITICAL del parser.

Casos cubiertos:
- Setting simple con comentario inline.
- Setting booleano.
- Setting de lista multilinea.
- Setting de diccionario anidado multilinea.
"""
SECRET_KEY = "dev-key"  # no usar en produccion
DEBUG = True

ALLOWED_HOSTS = [
    "localhost",
    "127.0.0.1",
]

INSTALLED_APPS = [
    "django.contrib.admin",
    "criticalapp",
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": "db.sqlite3",
    }
}

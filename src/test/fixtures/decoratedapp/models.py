"""Fixture: modelos con decorador de clase (regresión señalada por Codex).

tree-sitter envuelve `@deco\nclass X(...)` en un `decorated_definition`, así que
el extractor debe desenvolverlo o el modelo (y sus subclases) desaparecen.
"""
from django.db import models
import reversion


@reversion.register()
class Auditada(models.Model):
    nombre = models.CharField(max_length=50)


# Subclase de un modelo decorado: debe detectarse por herencia transitiva.
class HijaDeAuditada(Auditada):
    extra = models.CharField(max_length=10)

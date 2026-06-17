"""Fixture de modelos que cubre casos CRITICAL del parser.

Casos cubiertos:
- Modelo base abstracto con clase Meta (herencia detectable en 2 pasadas).
- Campo declarado DESPUES de la clase Meta (caso #11).
- Comentario inline con parentesis que descuadra el conteo (caso #10).
- Campo multilinea.
- Metodo @property.
"""
from django.db import models


class TimeStamped(models.Model):
    created = models.DateTimeField(auto_now_add=True)
    updated = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Category(TimeStamped):
    name = models.CharField(max_length=50)

    class Meta:
        verbose_name_plural = "Categories"
        ordering = ["name"]

    # Este campo se declara DESPUES de la clase Meta (caso #11).
    slug = models.SlugField(unique=True)


class Article(TimeStamped):
    title = models.CharField(max_length=200)
    summary = models.TextField(blank=True)  # resumen corto (ojo al ) del comentario)
    body = models.TextField(
        help_text="Texto completo del articulo (markdown soportado)",
    )
    category = models.ForeignKey(Category, on_delete=models.CASCADE)

    @property
    def is_long(self):
        return len(self.body) > 1000

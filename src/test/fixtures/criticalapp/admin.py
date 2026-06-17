"""Fixture de admin que cubre casos CRITICAL del parser.

Casos cubiertos:
- Decorador de registro simple con un modelo.
- Decorador de registro con varios modelos.
- Clase admin con atributo de modelo explicito.
- Registro directo en el sitio de administracion.
"""
from django.contrib import admin

from .models import Category, Article, TimeStamped


@admin.register(Article)
class ArticleAdmin(admin.ModelAdmin):
    list_display = ("title", "category")


@admin.register(Category, TimeStamped)
class SharedAdmin(admin.ModelAdmin):
    pass


class LegacyAdmin(admin.ModelAdmin):
    model = Category


admin.site.register(Category, LegacyAdmin)

"""Fixture de admin que cubre casos CRITICAL del parser.

Casos cubiertos:
- @admin.register(Model) decorador simple.
- @admin.register(Model, OtroModel) decorador con varios modelos.
- Clase admin con model = ... explicito.
- admin.site.register(Model, AdminClass) registro directo.
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

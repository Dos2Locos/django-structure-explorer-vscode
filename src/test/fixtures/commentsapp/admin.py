from django.contrib import admin
from .models import Producto


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    pass


# @admin.register(Producto)
# class ProductoViejoAdmin(admin.ModelAdmin):
#     pass

# admin.site.register(Producto, ViejoAdmin)

from django.urls import path, include
from . import views

urlpatterns = [
    path('back/', include('a.urls')),
    # Ruta hoja para verificar que el prefijo del path() externo ('b/') se
    # propaga a las rutas incluidas (regresión señalada por Codex).
    path('lista/', views.b_list),
]

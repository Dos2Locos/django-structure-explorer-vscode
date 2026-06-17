from django.urls import path
from . import views

urlpatterns = [
    path('inicio/', views.inicio),
    # path('viejo/', views.viejo),
    path('contacto/', views.contacto),  # ruta de contacto
]

# urlpatterns += [path('extra/', views.extra)]

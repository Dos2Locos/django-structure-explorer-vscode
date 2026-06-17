"""Fixture de URLs que cubre casos CRITICAL del parser.

Casos cubiertos:
- path('') de la raiz del sitio (patron vacio).
- path() con vista CBV .as_view().
- re_path() con raw string r'...' (caso #9).
- url() con raw string r'...' (caso #9).
- include() de otra app.
"""
from django.urls import path, re_path, include
from django.conf.urls import url
from rest_framework import routers

from . import views

router = routers.DefaultRouter()
router.register(r'authors', views.AuthorViewSet)

urlpatterns = [
    path('', views.home, name='home'),
    path('about/', views.AboutView.as_view(), name='about'),
    re_path(r'^articles/(?P<year>[0-9]{4})/$', views.year_archive, name='year'),
    url(r'^legacy/$', views.legacy, name='legacy'),
    path(
        'contact/',
        views.contact,
        name='contact',
    ),
    path('blog/', include('blog.urls')),
]

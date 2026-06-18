from django.urls import path
from . import views

urlpatterns = [
    path("autores/<int:pk>/", views.detail, name="author-detail"),
    path("", views.index, name="index"),
]

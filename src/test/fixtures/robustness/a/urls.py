from django.urls import path, include
from . import views

urlpatterns = [
    path('a/', views.a_index),
    path('b/', include('b.urls')),
]

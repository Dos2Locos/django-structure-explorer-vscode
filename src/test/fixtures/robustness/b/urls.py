from django.urls import path, include

urlpatterns = [
    path('back/', include('a.urls')),
]

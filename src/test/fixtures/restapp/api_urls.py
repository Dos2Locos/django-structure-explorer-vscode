from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import ArticleViewSet, stats

router = DefaultRouter()
router.register(r"articles", ArticleViewSet)

urlpatterns = [
    path("stats/", stats, name="article-stats"),
]
urlpatterns += router.urls

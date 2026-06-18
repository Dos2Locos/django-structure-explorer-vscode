from rest_framework import viewsets, generics
from rest_framework.decorators import api_view, action
from rest_framework.views import APIView
from rest_framework.response import Response

from .models import Article
from .serializers import ArticleSerializer


class ArticleViewSet(viewsets.ModelViewSet):
    queryset = Article.objects.all()
    serializer_class = ArticleSerializer

    @action(detail=True, methods=["post"], url_path="publish")
    def publish(self, request, pk=None):
        return Response({})


class ArticleListView(generics.ListAPIView):
    serializer_class = ArticleSerializer


class PingView(APIView):
    def get(self, request):
        return Response({"ping": "pong"})


@api_view(["GET", "POST"])
def stats(request):
    return Response({})


def vista_normal(request):
    return None

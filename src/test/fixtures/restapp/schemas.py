from ninja import Schema, ModelSchema

from .models import Article


class ArticleOut(Schema):
    id: int
    titulo: str


class ArticleIn(ModelSchema):
    class Meta:
        model = Article
        fields = ["titulo"]


class NoEsSchema:
    pass

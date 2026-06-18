from ninja import NinjaAPI, Router

api = NinjaAPI()
router = Router()


@api.get("/articles")
def list_articles(request):
    return []


@router.post("/articles/{article_id}", response=dict)
def create_article(request, article_id: int):
    return {}


@api.delete("/articles/{article_id}")
def delete_article(request, article_id: int):
    return {}

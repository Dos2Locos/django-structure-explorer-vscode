from django.contrib.auth.decorators import login_required, permission_required
from django.views.decorators.http import require_http_methods
from django.views.generic import ListView


@login_required
def dashboard(request):
    return None


@permission_required("blog.add_author")
@require_http_methods(["GET", "POST"])
def manage_authors(request):
    return None


def public_index(request):
    return None


class AuthorListView(ListView):
    model = "Author"

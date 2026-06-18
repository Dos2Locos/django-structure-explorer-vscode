from django.db.models.signals import post_save
from django.dispatch import receiver, Signal

from .models import Article

article_published = Signal()


@receiver(post_save, sender=Article)
def on_article_saved(sender, instance, **kwargs):
    pass


def funcion_normal():
    pass

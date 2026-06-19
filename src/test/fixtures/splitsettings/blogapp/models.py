from django.db import models


class Post(models.Model):
    titulo = models.CharField(max_length=200)

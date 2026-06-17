from django.db import models
from django.db.models import (
    CharField,
    TextField,
)


class Cosa(models.Model):
    nombre = models.CharField(max_length=10)
    titulo = models.TextField()

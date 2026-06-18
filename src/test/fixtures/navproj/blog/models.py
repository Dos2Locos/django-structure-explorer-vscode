from django.db import models


class Author(models.Model):
    nombre = models.CharField(max_length=100)


class Book(models.Model):
    autor = models.ForeignKey(Author, on_delete=models.CASCADE)

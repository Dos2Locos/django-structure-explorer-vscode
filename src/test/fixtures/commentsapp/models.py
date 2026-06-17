from django.db import models


class Producto(models.Model):
    """
    Modelo de producto.

    Campo histórico que ya no usamos:
        precio_antiguo = models.IntegerField()
    """
    nombre = models.CharField(max_length=100)
    # descripcion = models.TextField()   # campo comentado
    activo = models.BooleanField(default=True)  # comentario al final


# class ProductoViejo(models.Model):
#     codigo = models.CharField(max_length=10)

from celery import shared_task


@shared_task
def enviar_correo():
    pass


@app.task
def otra_tarea_celery():
    pass

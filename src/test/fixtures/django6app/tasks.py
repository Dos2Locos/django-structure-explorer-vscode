from django.tasks import task


@task
def send_welcome_email(user_id):
    # Comentario con la palabra task que no debe confundir al parser.
    pass


@task(priority=5, queue_name="default")
def rebuild_search_index():
    pass


async def helper_no_es_tarea():
    pass


def funcion_normal():
    pass

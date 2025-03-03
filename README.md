# Django Structure Explorer

Una extensión para Visual Studio Code que proporciona una vista de estructura de proyectos Django similar a PyCharm.

## Características

- Vista de árbol de la estructura del proyecto Django
- Navegación rápida a modelos, vistas, URLs y clases del admin
- Agrupación por aplicaciones Django
- Visualización de configuraciones (settings)
- Acceso directo a archivos importantes del proyecto

## Requisitos

- Visual Studio Code v1.60.0 o superior
- Proyecto Django

## Uso

1. Abre un proyecto Django en VSCode
2. La extensión se activará automáticamente al detectar el archivo `manage.py`
3. Accede a la vista "Django Explorer" en el panel lateral del explorador
4. Navega por la estructura de tu proyecto Django

## Configuración

Esta extensión no requiere configuración adicional.

## Notas de desarrollo

Para contribuir al desarrollo de esta extensión:

1. Clona este repositorio
2. Ejecuta `npm install`
3. Abre el proyecto en VSCode
4. Presiona F5 para iniciar una nueva ventana con la extensión cargada
5. Realiza cambios en el código
6. Recarga la ventana de VSCode para ver los cambios aplicados

## Solución de problemas git

Si al intentar hacer `git pull` aparece el error "refusing to merge unrelated histories", 
utiliza el siguiente comando:

```
git pull origin main --allow-unrelated-histories
```

Este error suele ocurrir cuando el repositorio local y el remoto comenzaron como proyectos 
separados sin un historial común.

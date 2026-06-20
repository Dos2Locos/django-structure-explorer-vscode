# Django Structure Explorer

![Django Structure Explorer](https://raw.githubusercontent.com/Dos2Locos/django-structure-explorer-vscode/main/images/icon.png)

A Visual Studio Code extension that provides a PyCharm-like Django project structure explorer, making it easier to navigate and understand your Django projects.

## Features

- **Project Structure Tree View**: Quickly visualize your entire Django project structure
- **Smart Django Detection**: Automatically identifies Django apps, models, views, and more
- **Nested Project Root Detection**: Finds `manage.py` even when it lives in a subfolder (monorepos, projects under `backend/`, `src/`, `apps/api/`, …), not only at the workspace root
- **`.gitignore`-Aware Scanning**: Skips heavy directories (dependencies, virtualenvs, caches) and also honors the folders declared in your project's `.gitignore`, keeping the tree focused on real source
- **Model Field Explorer**: View detailed information about model fields and their types
- **Admin Class Detection**: Navigate to admin classes and their associated models
- **URL Patterns**: Explore URL patterns and their associated views
- **Settings Explorer**: Browse through your Django settings
- **Property Method Support**: Identifies and displays @property methods in models
- **Django 6 Tasks**: Detects background tasks declared in `tasks.py` with `@task` (from `django.tasks`)
- **Django 6 Template Partials**: Lists `{% partialdef %}` definitions found in your app templates
- **DRF Serializers**: Lists serializers from `serializers.py`, with the associated model when declared
- **DRF / django-ninja API**: Per-app "API" node with django-ninja operations (`@api/@router.get/post/...`) and DRF decorator endpoints (`@api_view`, `@action`); ViewSets/APIView are also flagged in the Views node
- **django-ninja Schemas**: Lists `Schema` / `ModelSchema` classes from `schemas.py`
- **Forms**: Lists `Form` / `ModelForm` classes from `forms.py`, with the associated model
- **Signals**: Lists `@receiver` handlers and custom `Signal()` declarations from `signals.py`
- **Management Commands**: Lists custom `manage.py` commands from `management/commands/`
- **Celery Tasks**: Detects `@shared_task` / `@app.task` in `tasks.py` (separate from Django 6 Tasks)
- **Templates**: Per-app node listing the app's `.html` templates
- **Go to Definition**: F12 / Ctrl+click navigation across the project:
  - URL names — `reverse('app:detail')` and `{% url 'app:detail' %}` → `urls.py`
  - Templates — `render()`, `template_name`, `{% extends %}` / `{% include %}` → the `.html` file
  - Model relations — `ForeignKey` / `OneToOneField` / `ManyToManyField` target → the model class
- **manage.py Runner**: Run common commands (`runserver`, `makemigrations`, `migrate`, `shell`, `test`, …) from the view toolbar, or run a custom management command directly from its node in the tree. The interpreter is configurable via `djangoStructureExplorer.pythonPath`
- **View Decorators**: Function/class-based views show their top-level decorators (e.g. `@login_required`, `@permission_required`); access-controlled views are flagged with a lock icon
- **Filter**: Filter the tree's leaf items by name from the view toolbar (clear it with the dedicated button)
- **Localized UI (English / Spanish)**: The extension follows VS Code's display language — English by default, and Spanish when the editor is set to Spanish

## Why Use Django Structure Explorer?

If you're transitioning from PyCharm to VS Code or simply want a better way to navigate your Django projects, this extension provides:

- **Improved Navigation**: Quickly jump to any component in your Django project
- **Better Understanding**: Visualize the relationships between different parts of your project
- **Time Saving**: No more searching through files to find models, views, or URLs
- **Enhanced Productivity**: Focus on coding, not on finding files

## Installation

Install this extension from the VS Code Marketplace:

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Django Structure Explorer"
4. Click Install

Or install using the VS Code Quick Open (Ctrl+P):

```
ext install Dos2Locos.django-structure-explorer
```

## Usage

1. Open a Django project in VS Code
2. The extension activates automatically when it detects a `manage.py` file (including one nested in a subfolder, e.g. `backend/manage.py`)
3. Access the "Django Explorer" view in the Explorer sidebar
4. Navigate through your Django project structure

### Exploring Models

Click on any model to see its fields and properties. The extension shows:

- Field names and types
- Property methods (with a distinct icon)
- Direct navigation to field definitions

### Exploring Views

Browse through your views with information about:

- Function-based views
- Class-based views
- Direct navigation to view definitions

### Exploring URLs

Examine your URL patterns with details about:

- URL patterns
- Associated views
- URL namespaces

## Requirements

- Visual Studio Code v1.73.0 or higher
- A Django project

## Extension Settings

This extension works out of the box. Optional settings:

- `djangoStructureExplorer.sortOrder` — how tree items are sorted (`alphabetical`, `alphabeticalDesc`, `codeOrder`)
- `djangoStructureExplorer.pythonPath` — Python interpreter used to run `manage.py` commands (e.g. `python`, `python3`, or a virtualenv path)

## Known Issues

- Complex custom model fields may not be detected correctly
- Very large Django projects might experience slight performance delays

## Roadmap

Future plans for this extension include:

- Support for Django templates exploration
- Integration with Django REST Framework
- Custom field type detection improvements
- Performance optimizations for large projects
- Theme-aware icons and styling

## Contributing

Contributions are welcome! To contribute to this extension:

1. Fork the repository
2. Clone your fork
3. Run `npm install`
4. Make your changes
5. Test your changes by pressing F5 to launch a new VS Code window with the extension loaded
6. Submit a pull request

## License

This extension is licensed under the [MIT License](LICENSE.md).

## About

Developed by [Dos2Locos](https://github.com/Dos2Locos) to make Django development in VS Code more enjoyable and productive.

---

**Enjoy coding with Django Structure Explorer!**

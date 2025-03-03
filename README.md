# Django Structure Explorer

![Django Structure Explorer](https://raw.githubusercontent.com/Dos2Locos/django-structure-explorer-vscode/main/images/icon.png)

A Visual Studio Code extension that provides a PyCharm-like Django project structure explorer, making it easier to navigate and understand your Django projects.

## Features

- **Project Structure Tree View**: Quickly visualize your entire Django project structure
- **Smart Django Detection**: Automatically identifies Django apps, models, views, and more
- **Model Field Explorer**: View detailed information about model fields and their types
- **Admin Class Detection**: Navigate to admin classes and their associated models
- **URL Patterns**: Explore URL patterns and their associated views
- **Settings Explorer**: Browse through your Django settings
- **Property Method Support**: Identifies and displays @property methods in models

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
2. The extension activates automatically when it detects a `manage.py` file
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

- Visual Studio Code v1.60.0 or higher
- A Django project

## Extension Settings

This extension works out of the box with no additional configuration required.

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

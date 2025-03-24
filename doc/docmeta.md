# Meta Documentation

Guidelines for documentation.

## How documentation is organized

This documentation exists in the Puter repository.
You may be reading this on the GitHub wiki instead, which we generate
from the repository docs. These docs are always under a directory
named `doc/`.

From [./contributors/structure.md](./contributors/structure.md):
> The top-level `doc` directory contains the file you're reading right now.
> Its scope is documentation for using and contributing to Puter in general,
> and linking to more specific documentation in other places.
>
> All `doc` directories will have a `README.md` which should be considered as
> the index file for the documentation. All documentation under a `doc`
> directory should be accessible via a path of links starting from `README.md`.

### Documentation Structure

The top-level `doc` directory contains the following subdirectories:

- `api/` - API documentation for Puter services
- `contributors/` - Documentation for contributors to the Puter project
- `devmeta/` - Meta documentation for developers
- `i18n/` - Internationalization documentation
- `planning/` - Project planning documentation
- `self-hosters/` - Documentation for self-hosting Puter
- `uncategorized/` - Miscellaneous documentation

Module-specific documentation follows a similar structure, with each module having its own `doc` directory. For contributor-specific documentation within a module, use a `contributors` subdirectory within the module's `doc` directory.

## Docs Styleguide

### "is" and "is not"

- When "A is B", bold "is": "A **is** B" (`A **is** B`)
- When "A is not B", bold "not": "A is **not** B" (`A is **not** B`)

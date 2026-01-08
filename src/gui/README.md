# Puter GUI

This directory contains the frontend/GUI code for Puter's web-based operating system interface.

## Overview

The Puter GUI is a web-based desktop environment built with vanilla JavaScript. It provides a familiar desktop experience directly in your browser, including a taskbar, windows, file manager, and various built-in applications.

## Directory Structure

- `src/` - Main source code for the GUI
- `doc/` - Documentation files
  - `el0.md` - Documentation for the el0 utility
  - `utils.md` - Documentation for utility functions
  - `webpack_attempts.md` - Notes on webpack configuration
- `webpack/` - Webpack configuration files

## Development

### Getting Started

To run Puter locally with the GUI:

```bash
# From the project root
npm install
npm start
```

The GUI will be available at http://puter.localhost:4100 (or the next available port).

For detailed setup instructions, see the main [README.md](../../README.md) in the project root.

## Architecture

The GUI follows these conventions:

- **Code Style**: Uses standard whitespace conventions (see [CONTRIBUTING.md](../../CONTRIBUTING.md#style-changes))
- **Modular Design**: Components are organized by functionality
- **Event-Driven**: Utilizes a pub/sub pattern for component communication

## Contributing

Contributions to improve the GUI are welcome! Please:

1. Read the main [CONTRIBUTING.md](../../CONTRIBUTING.md) guide
2. Follow the existing code style in this directory
3. Test your changes thoroughly in different browsers
4. Keep PRs focused on a single feature or fix

## Related Documentation

- [Main Project README](../../README.md)
- [Contributing Guidelines](../../CONTRIBUTING.md)
- [Backend Documentation](../backend/CONTRIBUTING.md)

## Resources

- [Live Demo](https://puter.com)
- [Discord Community](https://discord.com/invite/PQcx7Teh8u)
- [Issue Tracker](https://github.com/HeyPuter/puter/issues)

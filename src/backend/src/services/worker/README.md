# Worker Service

This directory contains the worker service components for Puter's server-to-web (s2w) worker functionality.

## Build Process

The `res/workerPreamble.js` file is **generated** by webpack and should not be edited directly. Instead, edit the source files in the `src/` directory and rebuild.

### Building

To build the worker preamble:

```bash
# From this directory
npm install
npm run build
```

Or from the backend root:

```bash
npm run build:worker
```

### Development

For development with auto-rebuild:

```bash
npm run build:watch
```

This will watch for changes in the source files and automatically rebuild the `workerPreamble.js`.

## Source Files

- `src/puter-portable.js` - Puter portable API for worker environments
- `src/s2w-router.js` - Server-to-web router implementation
- `src/index.js` - Main entry point that combines both components

## Dependencies

- `path-to-regexp` - URL pattern matching library used by the s2w router

## Generated Output

The webpack build process creates `res/workerPreamble.js` which contains:
1. The bundled `path-to-regexp` library
2. The puter portable API
3. The s2w router with proper initialization
4. Initialization code that sets up both systems

This file is then read by `WorkerService.js` and injected into worker environments. 
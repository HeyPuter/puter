# Puter Kernel Documentation

## Overview

The **Puter Kernel** is the core runtime component of the Puter system. It provides the foundational infrastructure for:

- Initializing the runtime environment
- Managing internal and external modules (extensions)
- Setting up and booting core services
- Configuring logging and debugging utilities
- Integrating with third-party modules and performing dependency installs at runtime

This kernel is responsible for orchestrating the startup sequence and ensuring that all necessary services, modules, and environmental configurations are properly loaded before the application enters its operational state.

---

## Features

1. **Modular Architecture**:  
   The Kernel supports both internal and external modules:
   - **Internal Modules**: Provided to Kernel by an initializing script, such
     as `tools/run-selfhosted.js`, via the `add_module()` method.
   - **External Modules**: Discovered in configured module directories and installed
     dynamically. This includes resolving and executing `package.json` entries and
     running `npm install` as needed.

2. **Service Container & Registry**:  
   The Kernel initializes a service container that manages a wide range of services. Services can:
   - Register modules
   - Initialize dependencies
   - Emit lifecycle events (`boot.consolidation`, `boot.activation`, `boot.ready`) to
     orchestrate a stable and consistent environment.

3. **Runtime Environment Setup**:  
   The Kernel sets up a `RuntimeEnvironment` to determine configuration paths and environment parameters. It also provides global helpers like `kv` for key-value storage and `cl` for simplified console logging.

4. **Logging and Debugging**:  
   Uses a temporary `BootLogger` for the initialization phase until LogService is
   initialized, at which point it will replace the boot logger. Debugging features
   (`ll`, `xtra_log`) are enabled in development environments for convenience.

## Initialization & Boot Process

1. **Constructor**:  
   When a Kernel instance is created, it sets up basic parameters, initializes an empty
   module list, and prepares `useapi()` integration.

2. **Booting**:  
   The `boot()` method:
   - Parses CLI arguments using `yargs`.
   - Calls `_runtime_init()` to set up the `RuntimeEnvironment` and boot logger.
   - Initializes global debugging/logging utilities.
   - Sets up the service container (usually called `services`c instance of **Container**).
   - Invokes module installation and service bootstrapping processes.

3. **Module Installation**:  
   Internal modules are registered and installed first.  
   External modules are discovered, packaged, installed, and their code is executed.  
   External modules are given a special context with access to `useapi()`, a dynamic
   import mechanism for Puter modules and extensions.

4. **Service Bootstrapping**:  
   After modules and extensions are installed, services are initialized and activated.
   For more information about how this works, see [boot-sequence.md](./contributors/boot-sequence.md).


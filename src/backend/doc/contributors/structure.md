# Puter Backend - Directory Structure

## MFU - Most Frequently Used

These locations under `/src/backend/src` are the most important
to know about. Whether you're contributing a feature or fixing a bug,
you might only need to look at code in these locations.

### `modules` directory

The `modules` directory contains Puter backend kernel modules only.
Everything in here has a `<name of>Module.js` file and one or more
`<name of>Service.js` files.

> **Note:** A "backend kernel module" is simply a class understood by
  [`src/backend/src/Kernel.js`](../../src/Kernel.js)
  that registers a number of "Service" classes.
  You can look at [Puter's init file](../../../../tools/run-selfhosted.js)
  to see how modules are added to Puter.

The `README.md` file inside any module directory is generated with
the `module-docgen` script in the Puter repo's `/tools` directory.
The actual documentation for the module exists in jsdoc comments
in the source files.

Each module might contain these directories:
- `doc/` - additional module documentation, like sample requests
- `lib/` - utility code that isn't a Module or Service class.
  This utility code may be exposed by a service in the module
  to Puter's runtime import mechanism for extension support.

### `services` directory

This directory existed before the `modules` directory. Most of
the services here go on a module called **CoreModule**
(CoreModule.js is directly in `/src/backend/src`), but this
directory can be thought of as "services that are not yet
organized in a distinct module".

### `routers` directory

While routes are typically registered by Services, the implementation
of a route might be placed under `src/backend/src/routers` to keep the
service's code tidy or for legacy reasons.

These are some services that reference files under `src/backend/src/routers`:
- [PermissionAPIService](../../src/services/PermissionAPIService.js) - 
  This service registers routes that allow a user to configure permissions they
  grant to apps and groups. This is a relatively recent case of using files under the
  `routers` directory to clean up the service.
- [UserProtectedEndpointsService](../../src/services/web/UserProtectedEndpointsService.js) -
  This service follows a slightly different approach where files under
  `routers/user-protected` contain an "endpoint specification" instead of an express
  handler function. This might be good inspiration for future routes.
- [PuterAPIService](../../src/services/PuterAPIService.js) -
  This service is a catch-all for routes that existed before separation of concerns
  into backend kernel modules.
  
### `filesystem` directory

The filesystem is likely the most complex portion of Puter's source code. This code
is in its own directory as a matter of circumstance more than intention. Ideally the
filesystem's concerns will be split across a few modules as we prepare to add
support for mounting different file systems and improved cache behavior.
For example, Puter's native filesystem implementation should be mostly moved to
`src/backend/src/modules/puterfs` as we continue this development.

Since this directory is in flux, don't trust this documentation completely.
If you're contributing to filesystem,
[tag @KernelDeimos on the community Discord](https://discord.gg/PQcx7Teh8u)
if you have questions.

These are the key locations in the `filesystem` directory:
- `FSNodeContext.js` - When you have a reference to a file or directory in backend code,
  it is an instance of the FSNodeContext class.
- `ll_operations` - Runnables that implement the behavior of a filesystem operation.
  These used to include the behavior of Puter's filesystem, but they now delegate
  the actual behavior to the implementation in the `.provider` member of a
  FSNodeContext (filesystem node / a file or directory) so that we can eventually
  support "mountpoints" (multiple filesystem implementations).
- `hl_operations` - Runnables that implement the behavior of higher-level versions
  of filesystem operations. For example, the high-level mkdir operation might create
  multiple directories in chain; the high-level write might change the name of the
  file to avoid conflicts if you specify the `dedupe_name` flag.

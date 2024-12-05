# TemplateModule

This is a template module that you can copy and paste to create new modules.

This module is also included in `EssentialModules`, which means it will load
when Puter boots. If you're just testing something, you can add it here
temporarily.

## Services

### TemplateService

This is a template service that you can copy and paste to create new services.
You can also add to this service temporarily to test something.

#### Listeners

##### `install.routes`

TemplateService listens to this event to provide an example endpoint

##### `boot.consolidation`

TemplateService listens to this event to provide an example event

##### `boot.activation`

TemplateService listens to this event to show you that it's here

##### `start.webserver`

TemplateService listens to this event to show you that it's here

## Libraries

### hello_world

#### Functions

##### `hello_world`

This is a simple function that returns a string.
You can probably guess what string it returns.

## Notes

### Outside Imports

This module has external relative imports. When these are
removed it may become possible to move this module to an
extension.

**Imports:**
- `../../util/context.js`
- `../../services/BaseService` (use.BaseService)
- `../../util/expressutil`

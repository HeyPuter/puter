## 2025-10-21

### Moving PuterFSProvider to an Extension

PuterFSProvider is not trivial to move to an extension because of
relative imports (`require()`s) which represent dependencies on parts
of Puter's core which may not be available to extensions, or should
move with PuterFSProvider into an extension.

Dependencies of PuterFS provider will be placed into the following
categories:
- **Already OK** - this is already exposed to extensions
- **Export As-Is** - this needs to be exposed to extensions
- **Belongs to PuterFS** - this needs to be moved to an
  extension first or at the same time as PuterFSProvider
- **Create Extension API** - an API needs to be created or improved
  to use this dependency in the corrrect way for PuterFSProvider to
  be an extension
  
External dependencies (such as `uuid`) and dependencies treated like
external dependencies (such as `putility`) are not included here
because they're just updates to a `package.json` file.

#### Already OK
- Context
- APIError
- `DB_WRITE`, `DB_READ`
- streamutil
- config
- Actor
- UserActorType
- get_user
- metering service
- trace service

#### Export As-Is
- ~~filesystem selectors~~
- fsCapabilities
- UploadProgressTracker (utility)
- FSNodeContext
- ResourceService constants
- ParallelTasks
- FSNodeContext type context (`TYPE_FILE`, etc)
- operation frame status constants

#### Belongs to PuterFS
- FSLockService
- FSEntryFetcher
- FSEntryService
- `update_child_paths` [^1]
- SizeService
- `storage` object from **Context** [^2]

[^1]: FilesystemService belong's in Puter Core, but
      the `update_child_paths` method is an
      implementation detail of PuterFS
[^2]: LocalDiskStorageService registers this value
      in the `context` using the `context-init` service.
      PuterFS as an extension should emit an event where
      other extensions can register a PuterFS storage
      strategy.

#### Create Extension API

See notes below for details
- filesystem selectors
- access current operation frame
- getting/creating actors from user ID

### New Extension APIs

#### Filesystem Selectors

Filesystem selectors can be implied from strings instead
of having to instantiate classes and compose them.

Path: `"/just/a/string"`
UUID: `/^[^\/\.]/`
Child: `SOME-UUID/followed/by/a/path`

## Backend - Configuring Logs

### Log visibility specified by configuration file

The configuration file can define an array parameter called `logging`.
This configures the visibility of specific logs in core areas based on
which string flags are present.

For example, the following configuration will cause FileCacheService to
log information about cache hits and misses:
```json
{
    "logging": ['file-cache']
}
```

Sometimes "enabling" a log means moving its log level from `debug` to `info`.

#### Available logging flags:
- `file-cache`: file cache hits and misses
- `http`: http requests
- `fsentries-not-found`: information about files that were stat'd but weren't there

#### Service-level log configuration

Services can be configured to change their logging behavior. Services will have one of
two behaviors:

1. **info logging** - `log.info` can be used to create an `[INFO]` log message
2. **debug logging only** - `log.info` is redirected to `log.debug`

Services will have **info logging** enabled by default, unless the class definition
has the static member `static LOG_DEBUG = true` (in which case **debug logging only**
is the default).

In a service's configuration block the desired behavior can be specified by setting
either `"log_debug": true` or `"log_info": true`

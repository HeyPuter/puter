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

#### Other log options

- Setting `log_upcoming_alarms` to `true` will log alarms before they are created.
  This would be useful if AlarmService itself is failing.
- Setting `trace_logs` to `true` will display a stack trace below every log message.
  This can be useful if you don't know where a particular log is coming from and
  want to track it down.

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

# Core2Module

A replacement for CoreModule with as few external relative requires as possible.
This will eventually be the successor to CoreModule, the main module for Puter's backend.

## Services

### AlarmService

AlarmService class is responsible for managing alarms.
It provides methods for creating, clearing, and handling alarms.

#### Listeners

##### `boot.consolidation`

AlarmService registers its commands at the consolidation phase because
the '_init' method of CommandService may not have been called yet.

#### Methods

##### `create`

Method to create an alarm with the given ID, message, and fields.
If the ID already exists, it will be updated with the new fields
and the occurrence count will be incremented.

###### Parameters

- **id:** Unique identifier for the alarm.
- **message:** Message associated with the alarm.
- **fields:** Additional information about the alarm.

##### `clear`

Method to clear an alarm with the given ID.

###### Parameters

- **id:** The ID of the alarm to clear.

##### `get_alarm`

Method to get an alarm by its ID.

###### Parameters

- **id:** The ID of the alarm to get.

### LogService

The `LogService` class extends `BaseService` and is responsible for managing and 
orchestrating various logging functionalities within the application. It handles 
log initialization, middleware registration, log directory management, and 
provides methods for creating log contexts and managing log output levels.

#### Listeners

##### `boot.consolidation`

Registers logging commands with the command service.

#### Methods

##### `register_log_middleware`

Registers a custom logging middleware with the LogService.

###### Parameters

- **callback:** The callback function that modifies log parameters before delegation.

##### `create`

Create a new log context with the specified prefix

###### Parameters

- **prefix:** The prefix for the log context
- **fields:** Optional fields to include in the log context

##### `get_log_file`

Generates a sanitized file path for log files.

###### Parameters

- **name:** The name of the log file, which will be sanitized to remove any path characters.

##### `get_log_buffer`

Get the most recent log entries from the buffer maintained by the LogService.
By default, the buffer contains the last 20 log entries.

## Libraries

### core.util.identutil

#### Functions

##### `randomItem`

Select a random item from an array using a random number generator function.

###### Parameters

- **arr:** The array to select an item from

### core.util.logutil

#### Functions

##### `stringify_log_entry`

Stringifies a log entry into a formatted string for console output.

###### Parameters

- **logEntry:** The log entry object containing:

### stdio

#### Functions

##### `visible_length`

METADATA // {"ai-commented":{"service":"claude"}}

##### `split_lines`

Split a string into lines according to the terminal width,
preserving ANSI escape sequences, and return an array of lines.

###### Parameters

- **str:** The string to split into lines

### core.util.strutil

#### Functions

##### `quot`

METADATA // {"def":"core.util.strutil","ai-params":{"service":"claude"},"ai-commented":{"service":"claude"}}

##### `osclink`

Creates an OSC 8 hyperlink sequence for terminal output

###### Parameters

- **url:** The URL to link to

##### `format_as_usd`

Formats a number as a USD currency string with appropriate decimal places

###### Parameters

- **amount:** The amount to format

## Notes

### Outside Imports

This module has external relative imports. When these are
removed it may become possible to move this module to an
extension.

**Imports:**
- `../../services/BaseService.js`
- `../../util/context.js`
- `../../services/BaseService` (use.BaseService)
- `../../util/context`
- `../../services/BaseService` (use.BaseService)

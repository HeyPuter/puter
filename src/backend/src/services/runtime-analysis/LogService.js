// METADATA // {"ai-commented":{"service":"mistral","model":"mistral-large-latest"}}
/*
 * Copyright (C) 2024 Puter Technologies Inc.
 *
 * This file is part of Puter.
 *
 * Puter is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
const logSeverity = (ordinal, label, esc, winst) => ({ ordinal, label, esc, winst });
// Defines a function to create log severity objects used for logging
// The function is used to define various log levels and their properties
const LOG_LEVEL_ERRO = logSeverity(0, 'ERRO', '31;1', 'error');
// Defines the log level for error messages, used throughout the logging system.
const LOG_LEVEL_WARN = logSeverity(1, 'WARN', '33;1', 'warn');
// Defines the WARN log level, used for warning messages in the logging system.
const LOG_LEVEL_INFO = logSeverity(2, 'INFO', '36;1', 'info');
// Defines the log level constant for informational messages. Used throughout the code for logging informational events.
const LOG_LEVEL_TICK = logSeverity(10, 'TICK', '34;1', 'info');
// LOG_LEVEL_TICK is a constant defining a specific log level for tick events, used for periodic logging.
const LOG_LEVEL_DEBU = logSeverity(4, 'DEBU', '37;1', 'debug');
// Defines the debug log level used for detailed logging and debugging purposes.

```javascript
const LOG_LEVEL_DEBU = logSeverity(4, 'DEBU', '37;1', 'debug');
const LOG_LEVEL_NOTICEME = logSeverity(4, 'NOTICE_ME', '33;1', 'error');
// Defines a log level constant for special notifications, used in logging functions.
const LOG_LEVEL_SYSTEM = logSeverity(4, 'SYSTEM', '33;1', 'system');

const winston = require('winston');
const { Context } = require('../../util/context');
const BaseService = require('../BaseService');
require('winston-daily-rotate-file');

const WINSTON_LEVELS = {
    system: 0,
    error: 1,
    warn: 10,
    info: 20,
    http: 30,
    verbose: 40,
    debug: 50,
    silly: 60
};


/**
* @class LogContext
* @classdesc The LogContext class provides a structured way to handle logging within the application.
* It encapsulates the logging service, breadcrumbs for context, and fields for additional information.
* This class includes methods for different logging levels such as info, warn, debug, error, tick,
* and system logs. It also provides utility methods for sub-contexts, caching, and trace identification.
*/
class LogContext {
    constructor (logService, { crumbs, fields }) {
        this.logService = logService;
        this.crumbs = crumbs;
        this.fields = fields;
    }

    sub (name, fields = {}) {
        return new LogContext(
            this.logService,
            {
                crumbs: name ? [...this.crumbs, name] : [...this.crumbs],
                fields: {...this.fields, ...fields},
            }
        );
    }

    info  (message, fields, objects) { this.log(LOG_LEVEL_INFO, message, fields, objects); }
    warn  (message, fields, objects) { this.log(LOG_LEVEL_WARN, message, fields, objects); }
    debug (message, fields, objects) { this.log(LOG_LEVEL_DEBU, message, fields, objects); }
    error (message, fields, objects) { this.log(LOG_LEVEL_ERRO, message, fields, objects); }
    tick  (message, fields, objects) { this.log(LOG_LEVEL_TICK, message, fields, objects); }
    called (fields = {}) {
        this.log(LOG_LEVEL_DEBU, 'called', fields);
    }
    noticeme (message, fields, objects) {
        this.log(LOG_LEVEL_NOTICEME, message, fields, objects);
    }
    system (message, fields, objects) {
        this.log(LOG_LEVEL_SYSTEM, message, fields, objects);
    }

    cache (isCacheHit, identifier, fields = {}) {
        this.log(
            LOG_LEVEL_DEBU,
            isCacheHit ? 'cache_hit' : 'cache_miss',
            { identifier, ...fields },
        );
    }

    log (log_level, message, fields = {}, objects = {}) {
        fields = { ...this.fields, ...fields };
        {
            const x = Context.get(undefined, { allow_fallback: true });
            if ( x && x.get('trace_request') ) {
                fields.trace_request = x.get('trace_request');
            }
        }
        this.logService.log_(
            log_level,
            this.crumbs,
            message, fields, objects,
        );
    }

    // convenience method to get a trace id that isn't as difficult
    // for a human to read as a uuid.
    /**
    * Generates a human-readable trace ID.
    * This method creates a trace ID that is easier for humans to read compared to a UUID.
    * The trace ID is composed of two random alphanumeric strings joined by a hyphen.
    *
    * @returns {string} A human-readable trace ID.
    */
    mkid () {
        // generate trace id
        const trace_id = [];
        for ( let i = 0; i < 2; i++ ) {
            trace_id.push(Math.random().toString(36).slice(2, 8));
        }
        return trace_id.join('-');
    }

    // add a trace id to this logging context
    /**
    * Adds a trace ID to the logging context.
    * This method generates a new trace ID and assigns it to the logging context's fields.
    * It then returns the modified logging context.
    *
    * @returns {LogContext} The modified logging context with the trace ID added.
    */
    traceOn () {
        this.fields.trace_id = this.mkid();
        return this;
    }


    /**
    * Retrieves the current log buffer.
    *
    * @returns {Array} The current log buffer containing log entries.
    */
    get_log_buffer () {
        return this.logService.get_log_buffer();
    }
}

let log_epoch = Date.now();
/**
* Function to initialize the log epoch timestamp.
* This timestamp is used to calculate the time difference for log entries.
*/
const stringify_log_entry = ({ prefix, log_lvl, crumbs, message, fields, objects }) => {
    const { colorize } = require('json-colorizer');

    let lines = [], m;
    /**
    * Converts a log entry into a formatted string for display.
    *
    * This method formats log entries by combining the prefix, log level, crumbs (breadcrumbs),
    * message, fields, and objects into a readable string. It includes color coding for log levels
    * and timestamp information if available. The method processes each log entry into a multi-line
    * string for enhanced readability.
    *
    * @param {Object} entry - The log entry object to be stringified.
    * @param {string} entry.prefix - The optional prefix to prepend to the log message.
    * @param {Object} entry.log_lvl - The log level object containing label and escape sequences.
    * @param {Array} entry.crumbs - An array of breadcrumbs for context.
    * @param {string} entry.message - The main log message.
    * @param {Object} entry.fields - Additional fields to include in the log entry.
    * @param {Object} entry.objects - Additional objects to include in the log entry.
    * @returns {string} - The formatted log entry string.
    */
    const lf = () => {
        if ( ! m ) return;
        lines.push(m);
        m = '';
    }

    m = prefix ? `${prefix} ` : '';
    m += `\x1B[${log_lvl.esc}m[${log_lvl.label}\x1B[0m`;
    for ( const crumb of crumbs ) {
        m += `::${crumb}`;
    }
    m += `\x1B[${log_lvl.esc}m]\x1B[0m`;
    if ( fields.timestamp ) {
        // display seconds since logger epoch
        const n = (fields.timestamp - log_epoch) / 1000;
        m += ` (${n.toFixed(3)}s)`;
    }
    m += ` ${message} `;
    lf();
    for ( const k in fields ) {
        if ( k === 'timestamp' ) continue;
        let v; try {
            v = colorize(JSON.stringify(fields[k]));
        } catch (e) {
            v = '' + fields[k];
        }
        m += ` \x1B[1m${k}:\x1B[0m ${v}`;
        lf();
    }
    return lines.join('\n');
};



/**
* @class DevLogger
* @description The DevLogger class is responsible for handling logging operations in a development environment.
* It can delegate logging to another logger and manage log output to a file. This class provides methods for
* logging messages at different levels and managing the state of logging, such as turning logging on or off
* and recording log output to a file. It is particularly useful for debugging and development purposes.
*/
class DevLogger {
    // TODO: this should eventually delegate to winston logger
    constructor (log, opt_delegate) {
        this.log = log;
        this.off = false;
        this.recto = null;

        if ( opt_delegate ) {
            this.delegate = opt_delegate;
        }
    }
    onLogMessage (log_lvl, crumbs, message, fields, objects) {
        if ( this.delegate ) {
            this.delegate.onLogMessage(
                log_lvl, crumbs, message, fields, objects,
            );
        }

        if ( this.off ) return;

        const ld = Context.get('logdent', { allow_fallback: true })
        const prefix = globalThis.dev_console_indent_on
            ? Array(ld ?? 0).fill('    ').join('')
            : '';
        this.log_(stringify_log_entry({
            prefix,
            log_lvl, crumbs, message, fields, objects,
        }));
    }
    
    log_ (text) {
        if ( this.recto ) {
            const fs = require('node:fs');
            fs.appendFileSync(this.recto, text + '\n');
        }
        this.log(text);
    }
}


/**
* @class
* @classdesc The `NullLogger` class is a logging utility that does not perform any actual logging.
* It is designed to be used as a placeholder or for environments where logging is not desired.
* This class can be extended or used as a base for other logging implementations that need to
* delegate logging responsibilities to another logger.
*/
class NullLogger {
    // TODO: this should eventually delegate to winston logger
    constructor (log, opt_delegate) {
        this.log = log;

        if ( opt_delegate ) {
            this.delegate = opt_delegate;
        }
    }
    /**
    * Constructor for the NullLogger class.
    * This method initializes a new instance of the NullLogger class.
    * It optionally accepts a delegate logger to which it can pass log messages.
    *
    * @param {function} log - The logging function to use (e.g., console.log).
    * @param {Object} opt_delegate - An optional delegate logger to pass log messages to.
    */
    onLogMessage () {
    }
}


/**
* @class WinstonLogger
* @classdesc The WinstonLogger class is responsible for integrating the Winston logging library
* into the logging system. It handles forwarding log messages to Winston transports, which can
* include various logging destinations such as files, consoles, and remote logging services.
* This class is a key component in ensuring that log messages are appropriately recorded and
* managed, providing a structured and configurable logging mechanism.
*/
class WinstonLogger {
    constructor (winst) {
        this.winst = winst;
    }
    onLogMessage (log_lvl, crumbs, message, fields, objects) {
        this.winst.log({
            ...fields,
            label: crumbs.join('.'),
            level: log_lvl.winst,
            message,
        });
    }
}


/**
* @class LogContext
* @description The `LogContext` class provides a context for logging messages within the application.
* It encapsulates the log service, a list of breadcrumbs (contextual information for the logs),
* and fields that can be attached to log messages.
*
* This class includes methods for various log levels (info, warn, debug, error, etc.),
* allowing for structured logging with contextual information.
*
* It also provides methods for creating sub-contexts, generating trace IDs, and managing log buffers.
*/
/**
* @class DevLogger
* @description The `DevLogger` class is a simple logger that outputs log messages to the console.
* It is primarily used in development environments. This logger can also delegate log messages to another logger.
*
* The class includes methods for toggling log output, recording log messages to a file,
* and adding timestamps to log entries.
*/
/**
* @class NullLogger
* @description The `NullLogger` class is a logger that does not output any log messages.
* It is used when logging is disabled or when logging is not required.
*/
/**
* @class WinstonLogger
* @description The `WinstonLogger` class is a logger that integrates with the Winston logging library.
* It provides a structured way to log messages with different log levels and transports.
*
* This logger can be used to log messages to files, with options for daily rotation and compression.
*/
/**
* @class TimestampLogger
* @description The `TimestampLogger` class is a decorator logger that adds timestamps to log messages.
* It delegates the actual logging to another logger.
*
* This class ensures that each log message includes a timestamp, which can be useful for debugging and performance monitoring.
*/
/**
* @class BufferLogger
* @description The `BufferLogger` class is a logger that maintains a buffer of log messages.
* It delegates the actual logging to another logger.
*
* This logger can be used to keep a limited number of recent log messages in memory,
* which can be useful for debugging and troubleshooting.
*/
/**
* @class CustomLogger
* @description The `CustomLogger` class is a flexible logger that allows for custom log message processing.
* It delegates the actual logging to another logger.
*
* This logger can be used to modify log messages before they are logged,
* allowing for custom log message formatting and processing.
*/
/**
* @class LogService
* @description The `LogService` class is a service that provides logging functionality for the application.
* It manages a collection of loggers, a buffer of recent log messages, and log directories.
*
* This class includes methods for registering log middleware, creating log contexts,
* and logging messages at various log levels. It also ensures that log messages are only output if they are at or above the configured output level.
*
* The `LogService` class is responsible for initializing loggers based on the application's configuration,
* ensuring that log directories exist, and providing methods for retrieving log files and buffers.
*/
/**
* @class
* @description The `TimestampLogger` class is a logger that adds timestamps to log messages. It delegates the actual logging to another logger.
* This class ensures that each log message includes a timestamp, which can be useful for debugging and performance monitoring.
*/
/**
* @class BufferLogger
* @description The `BufferLogger` class is a logger that maintains a buffer of log messages. It delegates the actual logging to another logger.
* This logger can be used to keep a limited number of recent log messages in memory, which can be useful for debugging and troubleshooting.
*/
/**
* @class CustomLogger
* @description The `CustomLogger` class is a flexible logger that allows for custom log message processing. It delegates the actual logging to another logger.
* This logger can be used to modify log messages before they are logged, allowing for custom log message formatting and processing.
*/
/**
* @class
* @description The `LogService` class is a service that provides logging functionality for the application.
* It manages a collection of loggers, a buffer of recent log messages, and log directories.
* This class includes methods for registering log middleware, creating log contexts,
* and logging messages at various log levels. It also ensures that log messages are only output if they are at or above the configured output level.
* The `LogService` class is responsible for initializing loggers based on the application's configuration,
* ensuring that log directories exist, and providing methods for retrieving log files and buffers.
*/
/**
* @class
* @description The `TimestampLogger` class is a logger that adds timestamps to log messages. It delegates the actual logging to another logger.
* This class ensures that each log message includes a timestamp, which can be useful for debugging and performance monitoring.
*/
class TimestampLogger {
    constructor (delegate) {
        this.delegate = delegate;
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        fields = { ...fields, timestamp: new Date() };
        this.delegate.onLogMessage(log_lvl, crumbs, message, fields, ...a);
    }
}


/**
* The LogService class is a core service that manages logging across the application.
* It facilitates the creation and management of various logging middleware, such as
* DevLogger, NullLogger, WinstonLogger, and more. This class extends BaseService and
* includes methods for initializing and configuring loggers, ensuring log directories,
* and handling log messages. It also allows for the registration of custom log middleware
* via the register_log_middleware method.
*
* The LogService class supports multiple logging levels, each with its own file and
* transport mechanisms. It includes utility methods for creating new log contexts,
* logging messages, and getting the log buffer. This class is essential for tracking
* and monitoring application behavior, errors, and system events.
*/
class BufferLogger {
    constructor (size, delegate) {
        this.size = size;
        this.delegate = delegate;
        this.buffer = [];
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        this.buffer.push({ log_lvl, crumbs, message, fields, ...a });
        if ( this.buffer.length > this.size ) {
            this.buffer.shift();
        }
        this.delegate.onLogMessage(log_lvl, crumbs, message, fields, ...a);
    }
}


/**
* The `CustomLogger` class is a specialized logger that allows for custom
* logging behavior by applying a callback function to modify log entries
* before they are passed to the delegate logger. This class is part of the
* logging infrastructure, providing flexibility to alter log messages, fields,
* or other parameters dynamically based on the context in which the logging occurs.
*/
class CustomLogger {
    constructor (delegate, callback) {
        this.delegate = delegate;
        this.callback = callback;
    }
    onLogMessage (log_lvl, crumbs, message, fields, ...a) {
        // Logging is allowed to be performed without a context, but we
        // don't want log functions to be asynchronous which rules out
        // wrapping with Context.allow_fallback. Instead we provide a
        // context as a parameter.
        const context = Context.get(undefined, { allow_fallback: true });

        const {
            log_lvl: _log_lvl,
            crumbs: _crumbs,
            message: _message,
            fields: _fields,
            args,
        } = this.callback({
            context,
            log_lvl, crumbs, message, fields, args: a,
        });
        this.delegate.onLogMessage(
            _log_lvl ?? log_lvl,
            _crumbs ?? crumbs,
            _message ?? message,
            _fields ?? fields,
            ...(args ?? a ?? []),
        );
    }
}


/**
* The `LogService` class extends the `BaseService` and is responsible for managing logging operations.
* It handles the registration of log middleware, initializes various logging mechanisms, and provides
* methods to log messages at different severity levels. The class ensures that log directories are
* properly set up and manages the logging output levels based on configuration.
*/
class LogService extends BaseService {
    static MODULES = {
        path: require('path'),
    }
    /**
    * Initializes the log service by setting up the logging directory, configuring loggers,
    * and registering commands for log management.
    *
    * @async
    * @returns {Promise<void>} A promise that resolves when the initialization is complete.
    */
    async _construct () {
        this.loggers = [];
        this.bufferLogger = null;
    }
    register_log_middleware (callback) {
        this.loggers[0] = new CustomLogger(this.loggers[0], callback);
    }
    ['__on_boot.consolidation'] () {
        const commands = this.services.get('commands');
        commands.registerCommands('logs', [
            {
                id: 'show',
                description: 'toggle log output',
                handler: async (args, log) => {
                    this.devlogger && (this.devlogger.off = ! this.devlogger.off);
                }
            },
            {
                id: 'rec',
                description: 'start recording to a file via dev logger',
                handler: async (args, ctx) => {
                    const [name] = args;
                    const {log} = ctx;
                    if ( ! this.devlogger ) {
                        log('no dev logger; what are you doing?');
                    }
                    this.devlogger.recto = name;
                }
            },
            {
                id: 'stop',
                description: 'stop recording to a file via dev logger',
                handler: async ([name], log) => {
                    if ( ! this.devlogger ) {
                        log('no dev logger; what are you doing?');
                    }
                    this.devlogger.recto = null;
                }
            },
            {
                id: 'indent',
                description: 'toggle log indentation',
                handler: async (args, log) => {
                    globalThis.dev_console_indent_on =
                        ! globalThis.dev_console_indent_on;
                }
            }
        ]);
    }
    /**
    * Registers log-related commands for the service.
    *
    * This method defines a set of commands for managing log output,
    * such as toggling log visibility, starting/stopping log recording to a file,
    * and toggling log indentation.
    *
    * @param {Object} commands - The commands object to register commands to.
    */
    ```
    async _init () {
        const config = this.global_config;

        this.ensure_log_directory_();

        let logger;

        if ( ! config.no_winston )
        logger = new WinstonLogger(
            winston.createLogger({
                levels: WINSTON_LEVELS,
                transports: [
                    new winston.transports.DailyRotateFile({
                        filename: `${this.log_directory}/%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                    new winston.transports.DailyRotateFile({
                        level: 'error',
                        filename: `${this.log_directory}/error-%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                    new winston.transports.DailyRotateFile({
                        level: 'system',
                        filename: `${this.log_directory}/system-%DATE%.log`,
                        datePattern: 'YYYY-MM-DD',
                        zippedArchive: true,
                        maxSize: '20m',

                        // TODO: uncomment when we have a log backup strategy
                        // maxFiles: '14d',
                    }),
                ],
            }),
        );

        if ( config.env === 'dev' ) {
            logger = config.flag_no_logs // useful for profiling
                ? new NullLogger()
                : new DevLogger(console.log.bind(console), logger);
            
            this.devlogger = logger;
        }

        logger = new TimestampLogger(logger);

        logger = new BufferLogger(config.log_buffer_size ?? 20, logger);
        this.bufferLogger = logger;

        this.loggers.push(logger);

        this.output_lvl = LOG_LEVEL_INFO;
        if ( config.logger ) {
            // config.logger.level is a string, e.g. 'debug'

            // first we find the appropriate log level
            const output_lvl = Object.values({
                LOG_LEVEL_ERRO,
                LOG_LEVEL_WARN,
                LOG_LEVEL_INFO,
                LOG_LEVEL_DEBU,
                LOG_LEVEL_TICK,
            }).find(lvl => {
                return lvl.label === config.logger.level.toUpperCase() ||
                    lvl.winst === config.logger.level.toLowerCase() ||
                    lvl.ordinal === config.logger.level;
            });

            // then we set the output level to the ordinal of that level
            this.output_lvl = output_lvl.ordinal;
        }

        this.log = this.create('log-service');
        this.log.system('log service started', {
            output_lvl: this.output_lvl,
            log_directory: this.log_directory,
        });

        this.services.logger = this.create('services-container');
        globalThis.root_context.set('logger', this.create('root-context'));
    }

    create (prefix, fields = {}) {
        const logContext = new LogContext(
            this,
            {
                crumbs: [prefix],
                fields,
            },
        );

        return logContext;
    }

    log_ (log_lvl, crumbs, message, fields, objects) {
        try {
            // skip messages that are above the output level
            if ( log_lvl.ordinal > this.output_lvl ) return;

            for ( const logger of this.loggers ) {
                logger.onLogMessage(
                    log_lvl, crumbs, message, fields, objects,
                );
            }
        } catch (e) {
            // If logging fails, we don't want anything to happen
            // that might trigger a log message. This causes an
            // infinite loop and I learned that the hard way.
            console.error('Logging failed', e);

            // TODO: trigger an alarm either in a non-logging
            // context (prereq: per-context service overrides)
            // or with a cooldown window (prereq: cooldowns in AlarmService)
        }
    }


    /**
    * Ensures that the log directory exists by attempting to create it in several
    * predefined locations. If none of the locations are available, an error is thrown.
    *
    * @throws {Error} If the log directory cannot be created or found.
    */
    ensure_log_directory_ () {
        // STEP 1: Try /var/puter/logs/heyputer
        {
            const fs = require('fs');
            const path = '/var/puter/logs/heyputer';
            // Making this directory if it doesn't exist causes issues
            // for users running with development instructions
            if ( ! fs.existsSync('/var/puter') ) {
                return;
            }
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 2: Try /tmp/heyputer
        {
            const fs = require('fs');
            const path = '/tmp/heyputer';
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 3: Try working directory
        {
            const fs = require('fs');
            const path = './heyputer';
            try {
                fs.mkdirSync(path, { recursive: true });
                this.log_directory = path;
                return;
            } catch (e) {
                // ignore
            }
        }

        // STEP 4: Give up
        throw new Error('Unable to create or find log directory');
    }

    get_log_file (name) {
        // sanitize name: cannot contain path characters
        name = name.replace(/[^a-zA-Z0-9-_]/g, '_');
        return this.modules.path.join(this.log_directory, name);
    }


    /**
    * Retrieves the log buffer.
    *
    * This method returns the current log buffer, which is an array of log entries.
    * Each log entry contains details such as the log level, crumbs, message, and fields.
    *
    * @returns {Array} The log buffer containing log entries.
    */
    get_log_buffer () {
        return this.bufferLogger.buffer;
    }
}

module.exports = {
    LogService,
    stringify_log_entry
};
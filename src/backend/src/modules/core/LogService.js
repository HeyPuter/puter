// METADATA // {"ai-commented":{"service":"xai"}}
/*
 * Copyright (C) 2024-present Puter Technologies Inc.
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
const LOG_LEVEL_ERRO = logSeverity(0, 'ERRO', '31;1', 'error');
const LOG_LEVEL_WARN = logSeverity(1, 'WARN', '33;1', 'warn');
const LOG_LEVEL_INFO = logSeverity(2, 'INFO', '36;1', 'info');
const LOG_LEVEL_TICK = logSeverity(10, 'TICK', '34;1', 'info');
const LOG_LEVEL_DEBU = logSeverity(4, 'DEBU', '37;1', 'debug');
const LOG_LEVEL_NOTICEME = logSeverity(4, 'NOTICE_ME', '33;1', 'error');
const LOG_LEVEL_SYSTEM = logSeverity(4, 'SYSTEM', '33;1', 'system');

const winston = require('winston');
const { Context } = require('../../util/context');
const BaseService = require('../../services/BaseService');
const { stringify_log_entry } = require('./lib/log');
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
* Represents a logging context within the LogService.
* This class is used to manage logging operations with specific context information,
* allowing for hierarchical logging structures and dynamic field additions.
* @class LogContext
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
            if ( ! fields.actor && x && x.get('actor') ) {
                fields.actor = x.get('actor').uid;
            }
        }
        this.logService.log_(
            log_level,
            this.crumbs,
            message, fields, objects,
        );
    }

    /**
    * Generates a human-readable trace ID for logging purposes.
    * 
    * @returns {string} A trace ID in the format 'xxxxxx-xxxxxx' where each segment is a 
    *                   random string of six lowercase letters and digits.
    */
    mkid () {
        // generate trace id
        const trace_id = [];
        for ( let i = 0; i < 2; i++ ) {
            trace_id.push(Math.random().toString(36).slice(2, 8));
        }
        return trace_id.join('-');
    }

    /**
    * Adds a trace id to this logging context for tracking purposes.
    * @returns {LogContext} The current logging context with the trace id added.
    */
    traceOn () {
        this.fields.trace_id = this.mkid();
        return this;
    }


    /**
     * Gets the log buffer maintained by the LogService. This shows the most
     * recent log entries.
     * @returns {Array} An array of log entries stored in the buffer.
     */
    get_log_buffer () {
        return this.logService.get_log_buffer();
    }
}

/**
* Timestamp in milliseconds since the epoch, used for calculating log entry duration.
*/

/**
* @class DevLogger
* @classdesc
* A development logger class designed for logging messages during development. 
* This logger can either log directly to console or delegate logging to another logger. 
* It provides functionality to turn logging on/off, and can optionally write logs to a file.
* 
* @param {function} log - The logging function, typically `console.log` or similar.
* @param {object} [opt_delegate] - An optional logger to which log messages can be delegated.
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
* @class NullLogger
* @description A logger that does nothing, effectively disabling logging.
* This class is used when logging is not desired or during development
* to avoid performance overhead or for testing purposes.
*/
class NullLogger {
    // TODO: this should eventually delegate to winston logger
    constructor (log, opt_delegate) {
        this.log = log;

        if ( opt_delegate ) {
            this.delegate = opt_delegate;
        }
    }
    onLogMessage () {
    }
}


/**
* WinstonLogger Class
* 
* A logger that delegates log messages to a Winston logger instance.
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
* @class TimestampLogger
* @classdesc A logger that adds timestamps to log messages before delegating them to another logger.
* This class wraps another logger instance to ensure that all log messages include a timestamp,
* which can be useful for tracking the sequence of events in a system.
* 
* @param {Object} delegate - The logger instance to which the timestamped log messages are forwarded.
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
* The `BufferLogger` class extends the logging functionality by maintaining a buffer of log entries.
* This class is designed to:
* - Store a specified number of recent log messages.
* - Allow for retrieval of these logs for debugging or monitoring purposes.
* - Ensure that the log buffer does not exceed the defined size by removing older entries when necessary.
* - Delegate logging messages to another logger while managing its own buffer.
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
* Represents a custom logger that can modify log messages before they are passed to another logger.
* @class CustomLogger
* @extends {Object}
* @param {Object} delegate - The delegate logger to which modified log messages will be passed.
* @param {Function} callback - A callback function that modifies log parameters before delegation.
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
* The `LogService` class extends `BaseService` and is responsible for managing and 
* orchestrating various logging functionalities within the application. It handles 
* log initialization, middleware registration, log directory management, and 
* provides methods for creating log contexts and managing log output levels.
*/
class LogService extends BaseService {
    static MODULES = {
        path: require('path'),
    }
    /**
    * Defines the modules required by the LogService class.
    * This static property contains modules that are used for file path operations.
    * @property {Object} MODULES - An object containing required modules.
    * @property {Object} MODULES.path - The Node.js path module for handling and resolving file paths.
    */
    async _construct () {
        this.loggers = [];
        this.bufferLogger = null;
    }
    
    /**
     * Registers a custom logging middleware with the LogService.
     * @param {*} callback - The callback function that modifies log parameters before delegation.
     */
    register_log_middleware (callback) {
        this.loggers[0] = new CustomLogger(this.loggers[0], callback);
    }
    
    /**
     * Registers logging commands with the command service.
     */
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
    * Registers logging commands with the command service.
    * 
    * This method sets up various logging commands that can be used to
    * interact with the log output, such as toggling log display,
    * starting/stopping log recording, and toggling log indentation.
    * 
    * @memberof LogService
    */
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

    /**
     * Create a new log context with the specified prefix
     * 
     * @param {1} prefix - The prefix for the log context
     * @param {*} fields - Optional fields to include in the log context
     * @returns {LogContext} A new log context with the specified prefix and fields
     */
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
    * Ensures that a log directory exists for logging purposes.
    * This method attempts to create or locate a directory for log files,
    * falling back through several predefined paths if the preferred
    * directory does not exist or cannot be created.
    * 
    * @throws {Error} If no suitable log directory can be found or created.
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

    /**
    * Generates a sanitized file path for log files.
    * 
    * @param {string} name - The name of the log file, which will be sanitized to remove any path characters.
    * @returns {string} A sanitized file path within the log directory.
    */
    get_log_file (name) {
        // sanitize name: cannot contain path characters
        name = name.replace(/[^a-zA-Z0-9-_]/g, '_');
        return this.modules.path.join(this.log_directory, name);
    }


    /**
     * Get the most recent log entries from the buffer maintained by the LogService.
     * By default, the buffer contains the last 20 log entries.
     * @returns 
     */
    get_log_buffer () {
        return this.bufferLogger.buffer;
    }
}

module.exports = {
    LogService,
    stringify_log_entry
};